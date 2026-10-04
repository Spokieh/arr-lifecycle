# Deployment

Deployment-specific Compose: `/home/pikachu/docker/compose/arr-lifecycle/compose.yaml` on `192.168.1.161`. The existing arr and qBittorrent Compose stacks are not modified.

The app binds only the host's LAN address, port 3210. No public reverse-proxy entry is installed. Browsing and deletion have no user authentication; deletion requires exact configured Origin, fresh preparation and typed confirmation. Keep this internal app off the internet. Add authentication/authorization and HTTPS before wider exposure.

The runtime is non-root (1000:1000), has a read-only root filesystem, drops Linux capabilities, and does not mount the Docker socket. `/tmp` and the dedicated `/app-state` operation journal are writable. Library and torrent mounts remain read-only; removal goes through the authenticated Radarr/qBittorrent APIs. Missing bind paths fail deployment. Network `arr_default` is reused for service DNS. qBittorrent retains its configured LAN URL/authentication; its configuration is never changed by this app.

Copy `.env.local` only to the verified deployment directory (directory 0700, file 0600), never into source control or a build archive. Docker excludes all `.env*` files from the build context. Runtime secrets are passed through Compose's env_file, never build arguments. Users with Docker/root access can still inspect container environment variables; this is not a secret vault.

Commands from that directory:

```sh
docker compose config --quiet
docker compose build app
docker compose up -d --no-deps app
docker compose ps
```

Stopping/removing this app requires only `docker compose stop app` / `docker compose down` **in this project's directory**. Do not run these commands in the other stacks. Preserve `./state` across restarts and upgrades: it holds operation journals and the interruption lock. Do not restart during an active deletion.

## Filesystem evidence limits

Host `/mnt/truenas-share/server/arr/data/media` → `/data/media:ro`.
Host `/mnt/truenas-share/server/arr/data/torrents` → `/data/torrents:ro`.
The known qBittorrent `/media` alias maps to `/data/media`; `/downloads` is deliberately unsupported.

On this host the media is SMB/CIFS from TrueNAS, not a local Linux filesystem. The preview reads metadata only (lstat/statfs), at most four API-derived paths, with a two-second response limit and four outstanding operations per process. Timeouts cannot cancel kernel filesystem operations; the concurrency slots stay occupied until those operations finish. Directory trees are never traversed, symlink paths are rejected, and no file contents are opened. More than four paths yields an explicit partial-inspection warning.

Reported SMB inode/device/link counts are observations, not hardlink proof or a deletion permit. CIFS inode uniqueness depends on server/export configuration: see [mount.cifs](https://www.man7.org/linux/man-pages/man8/mount.cifs.8.html). No other hardlinks are enumerated and no free-space estimate is claimed. This mount-level inspector is unsuitable as an execution-time deletion guard. Native ZFS evidence is a separate section described below.

Windows/local development keeps filesystem inspection disabled. Compose explicitly enables it at runtime. Metadata checks are streamed separately so a slow storage mount does not hold up the initial movie/show details.

## Native NAS metadata inspection

The deployment uses a separate app SSH key, not the operator's unrestricted key. It connects from the Docker host to `dpcloudAdmin@192.168.1.99`. The NAS host key is pinned to the independently verified ED25519 fingerprint `SHA256:HFTflaiLv9m9/vQrkkAr68p48nIjBlV2cO6iVNXJeXk`; never use `StrictHostKeyChecking=no`.

Runtime-only files (outside Git and the Docker image):

- `./secrets/nas_key` → `/run/secrets/nas_key:ro`, mode 0600, UID 1000.
- `./secrets/nas_known_hosts` → `/run/secrets/nas_known_hosts:ro`, mode 0600.
- Secrets directory: mode 0700. Compose refuses missing files. Do not copy the operator key here.

On TrueNAS the app public key is installed using the supported `user.update` middleware API, preserving other keys, with these authorized-key options:

```text
from="192.168.1.161",restrict,command="/usr/bin/python3 -I /mnt/storage/dpcloudAdmin/arr-lifecycle-inspector/inspector.py"
```

The source-controlled helper is `nas/inspector.py`. Its NAS copy and its own directory have mode 0555, owned by dpcloudAdmin. The forced-command key cannot modify them, run a shell, transfer files or forward ports. The existing administrator account/operator key still has its own privileges: this is command confinement, not a dedicated unprivileged NAS account. A dedicated account is desirable before broader use. `restrict` alone would **not** limit commands; the explicit forced command and protocol check are essential ([OpenSSH authorized keys](https://man.openbsd.com/sshd.8#AUTHORIZED_KEYS_FILE_FORMAT)). No sshd configuration or service changes are needed.

The helper accepts `arr-lifecycle-inspect-v1` for bounded file lists, V2 for two movie roots, and `arr-lifecycle-inspect-v3` for one series/anime library and up to 64 same-instance torrent roots. Protocol v4 adds an exact, inventory-bound unlink of one selected movie, Sonarr TV or anime library tree after all confirmed torrent roots have been removed. It refuses changed file identities, hardlink counts, directories, symlinks and special files. It cannot accept qBittorrent roots or arbitrary paths. This gives the app key narrowly scoped destructive filesystem authority; it must not be provisioned or enabled without reviewing the helper source and tests. The helper maps `/data` to `/mnt/storage/truenas-share/server/arr/data` and requires native ZFS. See [movie deletion](deletion.md) and [series deletion](series-deletion.md) for limits and recovery.

Limits: two concurrent SSH inspections per app process, four exact-matched torrents per preview, 64 distinct paths per inspection, bounded protocol input/output, 8-second NAS deadline and 10-second SSH process deadline. Unsupported paths or limits block comparison instead of silently providing truncated proof. No background polling or library-list NAS calls occur. `NAS_INSPECTION_ENABLED=false` is the local default; the deployment Compose explicitly enables it.

The app obtains torrent members with **GET `/api/v2/torrents/files?hash=…`** (30-second read cache), then compares API-derived library and torrent paths. Native metadata is freshly read. Equal device and inode on distinct library/torrent paths, consistent size/link counts and a sufficient link count confirm a hardlink group at observation time. Additional live links are reported by count, not discovered by a NAS-wide scan. Path names/titles alone never confirm a hardlink. Hash evidence can refer to an older download; a nonmatching inode therefore does not become proof of current-file provenance.

The basic V1 preview is not an atomic snapshot or deletion authorization. Movie deletion separately uses a fresh V2 folder inventory and ownership checks. ZFS snapshots and open handles remain outside the removal scope; no secure-erasure or immediate freed-space guarantee is made.

Validation:

- `npm test`, `npm run lint`, `npm run build`.
- On Linux: `python3 -B -m unittest discover -s nas` (temporary fixtures only).
- On the Docker host: run `scripts/check-nas-access.py` to verify command/path rejection and the selected Zootopia 2 metadata.
- `node scripts/check-deployment.mjs` checks the deployed movie/show UI and native Zootopia 2 proof read-only.

The one-time provisioning scripts in `scripts/` contain public identifiers only. `prepare-nas-key.sh` never overwrites an existing private key; `authorize-nas-app.py` refuses an existing app key with different restrictions. Review deployment-specific paths and public keys before using them on another installation. To disable this feature, set `NAS_INSPECTION_ENABLED=false` in Compose and recreate only the app container; revoke only the app key through the TrueNAS user UI/API if removing access entirely.
