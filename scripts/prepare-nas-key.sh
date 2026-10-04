#!/bin/sh
# Run as pikachu on the Docker host. Never overwrite an existing private key.
set -eu
dir=/home/pikachu/docker/compose/arr-lifecycle/secrets
test "$(id -un)" = pikachu
test -d /home/pikachu/docker/compose/arr-lifecycle
if [ ! -d "$dir" ]; then install -d -m 700 "$dir"; fi
test ! -L "$dir"
if [ ! -e "$dir/nas_key" ]; then
  ssh-keygen -q -t ed25519 -N '' -C arr-lifecycle-nas-app -f "$dir/nas_key"
fi
chmod 600 "$dir/nas_key"
ssh-keygen -lf "$dir/nas_key.pub"
cat "$dir/nas_key.pub"
