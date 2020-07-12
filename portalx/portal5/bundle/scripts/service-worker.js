// service-worker.js
// Copyright (C) 2020  Tony Wu <tony[dot]wu(at)nyu[dot]edu>
// /* {% if retain_comments %} */
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.
// /* {% endif %} */

/* eslint-env serviceworker */

/* {% set retain_comments = False %} */
/* {% set retain_import_exports = False %} */

/* {% if retain_comments %} */
/**
 * The require statements here are for local development only (for type hinting, etc).
 * They get parsed out by the template engine before the script is served to the client.
 *
 * Comments that contain quotations such as `{% set noop = False %}` and `{{ retain_comments }}`
 * are directives for the template engine.
 */
/* {% endif %} */
/* {% if retain_import_exports %} */
const { Rewriters } = require('./rewriter')
const { TranscientStorage, ClientRecordStorage, Utils } = require('./utils')
const { Portal5 } = require('./portal5')
// const _ = require('lodash')
/* {% endif %} */

importScripts('/~/scripts/injector.js', '/~/scripts/rewriter.js', '/~/scripts/portal5.js', '/~/scripts/utils.js')
// importScripts('/~/static/scripts/lodash.min.js')

function securityCheck(event) {
    /** @type {Request} */
    let request = event.request
    if (request.headers.get(Portal5.headerName)) event.respondWith(new Response(null, { status: 403 }))
}

class DefinedHandlers {
    static passthru(event) {
        return event.respondWith(fetch(event.request))
    }
    static restricted(event) {
        /** @type {Request} */
        let request = event.request
        if (request.mode != 'navigate')
            return event.respondWith(new Response(`Unacceptable request mode ${request.mode}`, { status: 403 }))
        if (request.destination != 'document')
            return event.respondWith(
                new Response(`Unacceptable request destination ${request.destination}`, { status: 403 })
            )

        let requestOpts = {
            method: request.method,
            headers: {},
            mode: 'same-origin',
            credentials: 'same-origin',
            redirect: 'manual',
        }

        let p5 = new Portal5(self.settings)
        p5.setDirective(self.directives)
        p5.writeHeader(requestOpts.headers, 'identity')

        return event.respondWith(
            (async () => {
                if (request.method == 'POST') requestOpts.body = await request.blob()
                return doFetch(new Request(request.url, requestOpts))
            })()
        )
    }
    static forbidden(event) {
        return event.respondWith(new Response('', { status: 403 }))
    }
    static disambiguate(event) {
        return event.respondWith(
            (async () => {
                let request = event.request
                let form
                switch (request.method) {
                    case 'GET':
                        form = new URL(request.url).searchParams
                        break
                    case 'POST':
                        form = new URLSearchParams(
                            await Utils.readBlob(await request.blob(), FileReader.prototype.readAsText)
                        )
                        break
                    default:
                        return new Response('', { status: 400 })
                }

                let requestOpts = self.requestOptsCache.remove(form.get('request_opts'), 'request')
                let resumeRequest = new Request(`/~deflect?to=/${encodeURIComponent(form.get('dest'))}`, requestOpts)

                let p5 = new Portal5(self.settings)
                p5.setReferrer(resumeRequest, form.get('referrer'), form.get('dest'))
                p5.writeHeader(requestOpts, 'regular')

                return fetch(resumeRequest)
            })()
        )
    }
}

function withDefinedHandlers(event) {
    /** @type {Request} */
    let request = event.request
    let url = new URL(request.url)
    if (!request.referrer && request.mode == 'navigate' && (request.method == 'GET' || request.method == 'POST')) {
        let handler = self.settings.endpoints[url.pathname]
        if (handler) return DefinedHandlers[handler](event)
    }
}

function noRewrite(event) {
    let request = event.request
    let requested = new URL(request.url)
    if (!(requested.protocol in { 'http:': 1, 'https:': 1 })) return event.respondWith(fetch(request.clone()))
    if (!self.settings.prefs.local['basic_rewrite_crosssite']) {
        if (self.server != requested.origin) return event.respondWith(fetch(request.clone()))
    }
}

function shouldPassthru(url) {
    return url.hostname in self.settings.passthru.domains || url.href in self.settings.passthru.urls
}

function makeRedirect(url) {
    return new Response('', { status: 307, headers: { Location: url } })
}

async function getLocations(event, savedClients) {
    var windows = []
    let client = await clients.get(event.clientId || event.replacesClientId)
    if (client) windows.push(client)
    else if ('matchAll' in clients)
        windows = windows.concat(
            windows,
            (await clients.matchAll({ type: 'window' })).filter(
                (w) => w.url == event.request.referrer || w.visibilityState == 'visible' || w.focused
            )
        )

    var locations = []
    for (let i = 0; i < windows.length; i++) {
        let windowClient = windows[i]
        let location = new URL(windowClient.url)

        let represented
        try {
            represented = new URL(location.pathname.substr(1))
        } catch (e) {
            if (savedClients) {
                let stored = savedClients.get(windowClient.id)
                if (stored) {
                    represented = new URL(stored.represented)
                    represented.pathname = location.pathname
                }
            }
        }
        if (represented) {
            represented.search = location.search
            represented.hash = location.hash
            locations.push(represented)
            if (savedClients) savedClients.add(windowClient.id, represented.href)
        }
    }
    return locations
}

async function doDisambiguation(request, destinations) {
    let requestInfo = await Utils.makeRequestOptions(request)
    let metadata = {
        request: requestInfo,
        candidates: destinations,
    }

    let requestId = Date.now() + '.' + Math.random()
    self.requestOptsCache.add(requestId, requestInfo, 'request')
    metadata.id = requestId

    return fetch('/~disambiguate', {
        method: 'POST',
        body: JSON.stringify(metadata),
        headers: {
            'Content-Type': 'application/json',
        },
    })
}

async function interceptFetch(event) {
    var request = event.request
    var destinations = await resolveFetch(event)

    let referrer = undefined
    let dest = undefined
    if (destinations.length == 1) {
        let synthesized = destinations[0]
        referrer = synthesized.ref
        dest = synthesized.dest
    } else {
        let deduped = [...new Set(destinations.map((tuple) => tuple.dest.href))]
        if (deduped.length == 1) {
            dest = new URL(deduped[0])
            for (let i = 0; i < destinations.length; i++) {
                let ref = destinations[i].ref
                if (ref.origin == dest.origin) referrer = ref
            }
        } else if (request.mode == 'navigate') {
            return doDisambiguation(request, destinations)
        }
    }

    if (!dest) {
        dest = new URL(request.url)
    }

    if (shouldPassthru(dest)) {
        return fetch(request.clone())
    }

    let final
    if (dest.origin != self.server) {
        final = new URL(self.server + '/' + dest.href)
    } else {
        final = dest
    }

    if (final.href != request.url && request.destination in self.destinationRequiresRedirect) {
        return makeRedirect(final.href)
    }

    let outbound = await makeFetch(request, referrer, final)
    return doFetch(outbound, {
        injection_dom_hijack: {
            run: Portal5.rewriteResponse,
            args: [self.server, dest],
        },
    })
}

async function resolveFetch(event) {
    /** @type {Request} */
    let request = event.request

    let requested = new URL(request.url)
    let referrer
    try {
        referrer = new URL(request.referrer)
    } catch (e) {
        ;() => {}
    }

    var locations = await getLocations(event, self.clientRecords)
    var destinations = []
    if (locations.length) {
        for (let i = 0; i < locations.length; i++) {
            let represented = locations[i]
            destinations.push(Rewriters.synthesizeURL(represented, referrer, requested, self.server))
        }
    } else {
        destinations.push(Rewriters.synthesizeURL(null, referrer, requested, self.server))
    }

    return destinations
}

async function makeFetch(request, referrer, destination) {
    let p5 = new Portal5(self.settings)
    let requestOpts = await Utils.makeRequestOptions(request)
    p5.setReferrer(request, referrer, destination)
    if (request.method == 'GET' && request.mode == 'navigate') {
        p5.setDirective(self.directives)
    }
    p5.writeHeader(requestOpts.headers, 'regular')

    let outbound = new Request(destination.href, requestOpts)
    return outbound
}

async function doFetch(request, useFeatures = null) {
    let response = await fetch(request)

    let directives = Portal5.parseDirectives(response)
    for (let k in directives) self.directives[k] = directives[k]

    let prefs = self.settings.prefs.local
    if (useFeatures != null) {
        let featureNames = Object.keys(useFeatures)
        for (let i = 0; i < featureNames.length; i++) {
            let name = featureNames[i]
            if (!prefs[name]) continue
            let options = useFeatures[name]
            response = await options.run(response, ...options.args)
        }
    }
    return response
}

self.destinationRequiresRedirect = {
    document: true,
    embed: true,
    object: true,
    script: true,
    style: true,
    worker: true,
}

self.settings = JSON.parse('{{ settings|default(dict())|tojson }}')
self.server = self.settings.origin
self.directives = {}

self.clientRecords = new ClientRecordStorage()
self.requestOptsCache = new TranscientStorage()

self.addEventListener('install', (event) => {
    event.waitUntil(skipWaiting())
})

self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim())
})

self.addEventListener('fetch', securityCheck)
self.addEventListener('fetch', withDefinedHandlers)
self.addEventListener('fetch', noRewrite)
self.addEventListener('fetch', (event) => {
    event.respondWith(interceptFetch(event))
})

/* {% if requires_bundle %} */
importScripts('/~/static/scripts/bundle.min.js')
/* {% endif %} */