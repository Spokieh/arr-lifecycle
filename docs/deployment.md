# Read-only deployment

Deployment-specific Compose: `/home/pikachu/docker/compose/arr-lifecycle/compose.yaml` on `192.168.1.161`. The existing arr and qBittorrent Compose stacks are not modified.

The app binds only the host's LAN address, port 3210. No public reverse-proxy entry is installed. This is an unauthenticated read-only internal app; keep it off the internet. Authentication/authorization must be added before implementing destructive operations.

The runtime is non-root (1000:1000), has a read-only root filesystem, drops Linux capabilities, and does not mount the Docker socket. Only `/tmp` is writable. Library and torrent mounts are separately read-only; missing host paths cause deployment to fail instead of creating empty directories. Network `arr_default` is reused for service DNS. qBittorrent retains its configured LAN URL/authentication; its configuration is never changed by this app.

Copy `.env.local` only to the verified deployment directory (directory 0700, file 0600), never into source control or a build archive. Docker excludes all `.env*` files from the build context. Runtime secrets are passed through Compose's env_file, never build arguments. Users with Docker/root access can still inspect container environment variables; this is not a secret vault.

Commands from that directory:

```sh
docker compose config --quiet
docker compose build app
docker compose up -d --no-deps app
docker compose ps
```

Stopping/removing this app requires only `docker compose stop app` / `docker compose down` **in this project's directory**. Do not run these commands in the other stacks. The app has no persistent data volume and no cleanup/delete operations.

## Filesystem evidence limits

Host `/mnt/truenas-share/server/arr/data/media` → `/data/media:ro`.
Host `/mnt/truenas-share/server/arr/data/torrents` → `/data/torrents:ro`.
The known qBittorrent `/media` alias maps to `/data/media`; `/downloads` is deliberately unsupported.

On this host the media is SMB/CIFS from TrueNAS, not a local Linux filesystem. The preview reads metadata only (lstat/statfs), at most four API-derived paths, with a two-second response limit and four outstanding operations per process. Timeouts cannot cancel kernel filesystem operations; the concurrency slots stay occupied until those operations finish. Directory trees are never traversed, symlink paths are rejected, and no file contents are opened. More than four paths yields an explicit partial-inspection warning.

Reported inode/device/link counts are observations, not hardlink proof or a deletion permit. CIFS inode uniqueness depends on server/export configuration: see [mount.cifs](https://www.man7.org/linux/man-pages/man8/mount.cifs.8.html). No other hardlinks are enumerated, no complete torrent contents are verified, and no free-space estimate is claimed. Native filesystem verification on the storage server remains future work. This inspector is unsuitable as an execution-time deletion guard.

Windows/local development keeps filesystem inspection disabled. Compose explicitly enables it at runtime. Metadata checks are streamed separately so a slow storage mount does not hold up the initial movie/show details.
