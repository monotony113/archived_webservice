# config.py
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

import os

# PORTAL_URL_FILTERS = [
#     dict(name='*', description='all URLs', test=lambda r: True),
#     dict(name='http://*', description='No plain-text HTTP', test=lambda r: urlsplit(r.url).scheme == 'http'),
# ]

SERVER_NAME = os.getenv('SERVER_NAME')

SECRET_KEY = os.getenv('SECRET_KEY')
JWT_SECRET_KEY = os.getenv('JWT_SECRET_KEY')
PORTAL5_SECRET_KEY = os.getenv('PORTAL5_SECRET_KEY')
PORTAL5_WORKER_CODENAME = os.getenv('PORTAL5_WORKER_CODENAME')

PORTAL5_PASSTHROUGH_DOMAINS = {'fonts.googleapis.com', 'fonts.gstatic.com'}
# PORTAL5_PASSTHROUGH_URLS = {}

LANGUAGES = ['en', 'zh_cn']

# JWT_SECRET_KEY = None

JWT_IDENTITY_CLAIM = 'sub'
