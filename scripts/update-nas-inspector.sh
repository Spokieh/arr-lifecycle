#!/bin/sh
# Replace only our own forced-command helper; preserve the previous version.
set -eu
nas() {
  ssh -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -i /home/pikachu/.ssh/arr-lifecycle-nas dpcloudAdmin@192.168.1.99 "$@"
}
target=/mnt/storage/dpcloudAdmin/arr-lifecycle-inspector
nas test -f "$target/inspector.py"
nas test ! -L "$target"
nas test ! -L "$target/inspector.py"
nas test ! -e "$target/inspector.py.new"
nas chmod 755 "$target"
trap 'nas chmod 555 "$target"' EXIT
nas cp -n -- "$target/inspector.py" "$target/inspector.before-v4.py"
scp -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -i /home/pikachu/.ssh/arr-lifecycle-nas /home/pikachu/docker/compose/arr-lifecycle/nas/inspector.py dpcloudAdmin@192.168.1.99:/mnt/storage/dpcloudAdmin/arr-lifecycle-inspector/inspector.py.new
nas chmod 555 "$target/inspector.py.new"
nas mv -T -- "$target/inspector.py.new" "$target/inspector.py"
nas sha256sum "$target/inspector.py"
