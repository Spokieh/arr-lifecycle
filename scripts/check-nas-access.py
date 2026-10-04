"""Run on Docker host. Verify forced-command key and read-only Zootopia 2 metadata."""
import json
import subprocess

DIRECTORY = "/home/pikachu/docker/compose/arr-lifecycle/secrets"
SSH = ["ssh", "-F", "/dev/null", "-T", "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
       "-o", "StrictHostKeyChecking=yes", "-o", "UserKnownHostsFile=" + DIRECTORY + "/nas_known_hosts",
       "-o", "GlobalKnownHostsFile=/dev/null", "-i", DIRECTORY + "/nas_key", "dpcloudAdmin@192.168.1.99"]
def request(command, body):
    return subprocess.run([*SSH, command], input=json.dumps(body), text=True, capture_output=True, timeout=15)

for command, body in [("id", {}), ("arr-lifecycle-inspect-v1", {"version": 1, "paths": ["/etc/passwd"]})]:
    rejected = request(command, body)
    assert rejected.returncode != 0 and "Inspection rejected" in rejected.stdout, "Restricted key failed rejection check"
print("PASS: arbitrary command and outside-root path rejected")
folder = "/data/torrents/movies/Zootopia.2.2025.MA.WEBRip.x264.HUN-FULCRUM/"
paths = ["/data/media/movies/Zootopia 2 (2025)/Zootopia.2.2025.MA.WEBRip.x264.HUN-FULCRUM.mkv",
         folder + "fulcrum-zootopia.2.2025.webrip.ma.mkv",
         folder + "Sample/fulcrum-zootopia.2.2025.webrip.ma-sample.mkv",
         folder + "fulcrum-zootopia.2.2025.webrip.ma.nfo",
         folder + "fulcrum-zootopia.2.2025.webrip.ma.sfv"]
result = request("arr-lifecycle-inspect-v1", {"version": 1, "paths": paths})
assert result.returncode == 0, "Native metadata read failed"
observations = json.loads(result.stdout)["observations"]
assert all(item["status"] == "observed" and item["filesystem"] == "zfs" for item in observations)
first, second = observations[:2]
assert (first["device"], first["inode"], first["bytes"]) == (second["device"], second["inode"], second["bytes"])
assert first["links"] == second["links"] == 2
print("PASS: Zootopia 2 library/torrent hardlink confirmed; all five paths observed on native ZFS")
inventory = request("arr-lifecycle-inspect-v2", {"version": 2, "roots": ["/data/media/movies/Zootopia 2 (2025)", folder.rstrip("/")]})
assert inventory.returncode == 0, "Bounded inventory failed"
scopes = json.loads(inventory.stdout)["inventories"]
assert all(scope["status"] == "present" and scope["filesystem"] == "zfs" for scope in scopes)
assert len(scopes[0]["files"]) >= 1 and len(scopes[1]["files"]) == 4
assert scopes[0]["device"] == scopes[1]["device"]
print("PASS: read-only V2 inventory of both selected movie locations")
