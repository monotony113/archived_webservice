# blueprint.py
# Copyright (C) 2020  Tony Wu <tony[dot]wu(at)nyu[dot]edu>
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.

from flask import Blueprint, Response, jsonify, redirect, render_template, request, stream_with_context

_debug = Blueprint(
    '_debug', __name__,
    template_folder='templates', static_folder='static',
    subdomain='debug'
)


@_debug.route('/uninstall-worker')
def uninstall_worker():
    return render_template('_debug/_worker-uninstall.html')


@_debug.route('/info', methods=('GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'))
def info():
    def gen_info():
        yield '<pre><code>'
        yield request.url + '\n'
        yield request.host + '\n'
        yield request.scheme + '\n'
        yield '\n'
        for k, v in request.headers.items():
            yield f'{k}: {v}\n'
        yield '\n'
        for k, v in request.cookies.items():
            yield f'{k}: {v}\n'
        yield '\n'
        yield '</code></pre>'

    return Response(stream_with_context(gen_info()), mimetype='text/html')


@_debug.route('/redirect')
def test_redirect():
    return render_template('_debug/redirect.html')


@_debug.route('/307-1', methods=('GET', 'POST'))
def test_redirect_1():
    return redirect('/307-2', 307)


@_debug.route('/307-2', methods=('GET', 'POST'))
def test_redirect_2():
    return jsonify({
        'headers': {**request.headers},
        'cookies': {**request.cookies},
        'form': {**request.form},
    })


@_debug.route('/static.html')
def html():
    return Response('<html><head><link rel="stylesheet" href="/static.css"></head><body>Lorem ipsum</body></html>')


@_debug.route('/static.css')
def css():
    res = Response('*{font-family:Courier}', mimetype='text/css')
    res.headers['Cache-Control'] = 'public, max-age=31536000'
    res.add_etag()
    return res
