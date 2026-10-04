"""Read-only integration inventory; never print API keys or write to services."""
import json
import pathlib
import urllib.request

env = dict(line.split('=', 1) for line in pathlib.Path('/home/pikachu/docker/compose/arr-lifecycle/.env.local').read_text().splitlines() if '=' in line and not line.startswith('#'))
def get(url, key=None):
    req = urllib.request.Request(url, headers={'X-Api-Key': key} if key else {})
    with urllib.request.urlopen(req, timeout=10) as response:
        return json.load(response)
servers = get(env['SEERR_URL'] + '/api/v1/settings/sonarr', env['SEERR_API_KEY'])
for instance, port, prefix, category in [('tv', 8989, 'SONARR', 'SeriesRR'), ('anime', 8787, 'SONARR_ANIME', 'AnimeRR')]:
    url = 'http://192.168.1.161:' + str(port)
    rows = get(url + '/api/v3/series', env[prefix + '_API_KEY'])
    print(json.dumps({'instance': instance, 'incompleteIdentities': [{k: row.get(k) for k in ['id', 'title', 'tvdbId', 'tmdbId']} for row in rows if not row.get('tvdbId') or not row.get('tmdbId')]}))
    samples = sorted(rows, key=lambda row: row.get('statistics', {}).get('episodeFileCount', 0))
    samples = [row for row in samples if row.get('statistics', {}).get('episodeFileCount', 0) > 0][:3]
    settings = get(url + '/api/v3/config/mediamanagement', env[prefix + '_API_KEY'])
    torrents = get(env['QBIT_URL'].rstrip('/') + '/api/v2/torrents/info?category=' + category)
    print(json.dumps({'instance': instance, 'count': len(rows), 'recycleBinDisabled': settings.get('recycleBin') == '', 'samples': [{k: row.get(k) for k in ['id', 'title', 'path', 'tvdbId', 'tmdbId', 'statistics']} for row in samples], 'torrentPaths': [t.get('content_path') for t in torrents[:3]], 'seerrServers': [{'id': s.get('id'), 'name': s.get('name'), 'is4k': s.get('is4k'), 'sameApiKey': s.get('apiKey') == env[prefix + '_API_KEY']} for s in servers]}))
