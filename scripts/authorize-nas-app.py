"""One-time TrueNAS middleware update. Preserve existing SSH keys."""
import json
import pathlib
import subprocess

PUBLIC = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEfMJbHuyby/Ne48rC+G7R7X1foyp6gCyhUGFXRMwLLf arr-lifecycle-nas-app"
HELPER = pathlib.Path("/mnt/storage/dpcloudAdmin/arr-lifecycle-inspector/inspector.py")
if not HELPER.is_file() or HELPER.is_symlink() or HELPER.stat().st_mode & 0o222:
    raise SystemExit("Helper must be installed read-only first")
def api(*args):
    return json.loads(subprocess.check_output(["midclt", "call", *args], text=True))
user = api("user.query", '[["username","=","dpcloudAdmin"]]', '{"get":true,"select":["id","sshpubkey"]}')
existing = user.get("sshpubkey") or ""
entry = 'from="192.168.1.161",restrict,command="/usr/bin/python3 -I ' + str(HELPER) + '" ' + PUBLIC
if PUBLIC.split()[1] in existing:
    if entry not in existing.splitlines():
        raise SystemExit("App public key already has different permissions; refusing")
else:
    subprocess.run(["midclt", "call", "user.update", str(user["id"]), json.dumps({"sshpubkey": existing.rstrip() + "\n" + entry + "\n"})], check=True, stdout=subprocess.DEVNULL)
verified = api("user.query", '[["username","=","dpcloudAdmin"]]', '{"get":true,"select":["sshpubkey"]}')
assert entry in verified["sshpubkey"].splitlines()
print("App key authorized: source-restricted, forced metadata command only; existing keys preserved.")
