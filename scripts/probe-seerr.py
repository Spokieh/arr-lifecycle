"""Read-only deployed Seerr identity/shape probe; credentials never printed."""
import json
import pathlib
import urllib.request

env = dict(line.split('=', 1) for line in pathlib.Path('/home/pikachu/docker/compose/arr-lifecycle/.env.local').read_text().splitlines() if '=' in line and not line.startswith('#'))
def get(url, key):
    req = urllib.request.Request(url, headers={'X-Api-Key': key})
    with urllib.request.urlopen(req, timeout=10) as response:
        return json.load(response)
movie = get('http://192.168.1.161:7878/api/v3/movie/148', env['RADARR_API_KEY'])
data = get(env['SEERR_URL'] + '/api/v1/movie/' + str(movie['tmdbId']), env['SEERR_API_KEY'])
info = data.get('mediaInfo') or {}
print(json.dumps({'tmdbId': movie['tmdbId'], 'movieId': movie['id'], 'mediaId': info.get('id'), 'keys': sorted(info.keys()), 'status': info.get('status'), 'status4k': info.get('status4k'), 'serviceId': info.get('serviceId'), 'externalServiceId': info.get('externalServiceId'), 'requests': [{key: r.get(key) for key in ['id', 'type', 'is4k', 'serverId', 'status']} for r in info.get('requests', [])], 'requestShapes': [sorted(r.keys()) for r in info.get('requests', [])], 'issues': [i.get('id') for i in info.get('issues', [])]}))
