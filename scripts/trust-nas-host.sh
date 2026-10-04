#!/bin/sh
# Run on the Docker host. Fingerprint supplied out-of-band from the NAS console.
set -eu
expected='SHA256:HFTflaiLv9m9/vQrkkAr68p48nIjBlV2cO6iVNXJeXk'
host=192.168.1.99
known=/home/pikachu/.ssh/known_hosts
key=$(ssh-keyscan -T 5 -t ed25519 "$host" 2>/dev/null)
actual=$(printf '%s\n' "$key" | ssh-keygen -lf - | awk '{print $2}')
if [ "$actual" != "$expected" ]; then
  printf '%s\n' 'Host fingerprint mismatch; nothing changed.' >&2
  exit 1
fi
if [ -f "$known" ] && ssh-keygen -F "$host" -f "$known" >/dev/null; then
  printf '%s\n' 'An entry already exists; leaving it unchanged.'
else
  umask 077
  printf '%s\n' "$key" >> "$known"
  printf '%s\n' "Verified and saved NAS host key: $actual"
fi
