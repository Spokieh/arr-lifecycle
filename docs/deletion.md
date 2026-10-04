# Movie deletion

Movie deletion is enabled in the deployment-specific Compose and disabled by default in `.env.example`. It supports one Radarr movie, one complete torrent in `MoviesRR`, and the two native movie locations. Movie operations check Sonarr and Sonarr Anime for conflicting ownership but never modify them. Their separate whole-series workflow is documented in [series-deletion.md](series-deletion.md).

## Access control

`MOVIE_DELETION_ENABLED=true`, exact `APP_ORIGIN`, and an absolute persistent `DELETE_STATE_DIR` are required. The deployment mounts `./state` at `/app-state`. Requests check the exact Origin, require JSON, and bound the body. There is no user authentication or authorization: anyone who can access the app from the trusted origin can prepare and confirm a deletion. Keep the service on a trusted LAN until real authentication and authorization are added.

## Preparation and execution

1. Open a movie and choose **Prepare deletion**. This performs fresh GET requests and read-only NAS inspection. It does not delete anything.
2. Review every library and torrent file. A random confirmation token lasts two minutes. Type the exact `DELETE Title (Year)` phrase and acknowledge the live-file scope.
3. **Confirm delete** consumes the token once, acquires a persistent global operation lock, writes the journal, and repeats the uncached preflight. Any file identity, path, size, modification time, link count or service-configuration change stops execution.
4. Before any mutation, the app requires NAS cleanup protocol v4 and verifies the exact library snapshot. If the NAS still has the old read-only helper, it blocks without touching qBittorrent. The app then records `torrent: requested`, calls qBittorrent once, verifies that the torrent and its files are absent, and checks that library hardlink counts decreased exactly as expected.
5. The NAS helper revalidates every library path, device, inode, size, modification time and remaining hardlink count, unlinks only those exact regular files without following symlinks, and removes only the inventoried empty directories. After the app verifies the complete tree is absent, it rechecks ownership and the Radarr file identity, calls `DELETE /api/v3/movie/{id}?deleteFiles=false&addImportExclusion=false` to remove the Radarr record only, then verifies the record, torrent and all inventoried live paths are absent.
6. The app records `seerr: requested`, checks that the confirmed Seerr media/request/issue identifiers are unchanged, and removes that media record once. Seerr also removes its related requests, issues and watchlist entries. The app verifies the movie no longer has a Seerr media record and each confirmed request returns 404. If there was no Seerr record, no delete is sent. Successful completion releases the operation lock and invalidates the media read cache.

Seerr requires server-only `SEERR_URL` and `SEERR_API_KEY` with administrator access. Matching uses the Radarr TMDB ID and Seerr media type, verifies the Seerr Radarr configuration has the same API key, and checks the associated Radarr movie/server IDs. Duplicate TMDB movies, blocklisted records, another 4K variant, requests for another server, incomplete inventories, and Seerr failures block preparation before any deletion. Up to 200 requests/issues can be inspected. The preview lists Seerr IDs and explains the cascade to watchlist entries. Informational modal reads are cached for 30 seconds (status 60 seconds); deletion reads are always fresh. The Seerr detail page remains discoverable through TMDB after the local media/request record is removed. A media-server scan may recreate availability metadata until the media server rescans its removed files; external auto-request/watchlist sources can also request the title again.

The preparation accepts only exact unique hash matches in MoviesRR, completed torrents in upload states, explicit current Radarr file IDs, supported paths, an empty/disabled Radarr recycle-bin setting, complete hash-owner history, nonoverlapping libraries/torrents, and native ZFS inventories with no unaccounted hardlinks. Both Sonarr instances must be available for ownership checks. The current movie file must share an inode with a torrent file. Candidate matches and independent copies are blocked in this first version.

The NAS helper's v2 inspection reads the selected movie folder and torrent content location (including sidecars), refuses symlinks/special files/cross-device traversal and bounds files/directories/depth. Its v4 unlink mode accepts only the exact movie library root and an inventory-bound file set; torrent roots are never eligible for this command. The torrent inventory must exactly match qBittorrent's members and sizes. The media mount's device identity is preserved through verification so an unavailable/replaced mount cannot be mistaken for deleted files. The forced SSH key now has deliberately narrow filesystem removal capability; see [deployment](deployment.md#native-nas-metadata-inspection) and review the helper before enabling deletion.

## APIs

- Application: `POST /api/movies/{id}/deletion`, action `prepare`, `execute` or `status`; only the configured Origin is accepted.
- qBittorrent: **POST `/api/v2/torrents/delete`**, one validated hash, `deleteFiles=true`. [qBittorrent API](<https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-5.0)#delete-torrents>).
- Radarr: **DELETE `/api/v3/movie/{id}?deleteFiles=false&addImportExclusion=false`** removes only the record after the NAS file tree has already been removed and verified. No import-list exclusion is added. [Radarr controller](https://github.com/Radarr/Radarr/blob/develop/src/Radarr.Api.V3/Movies/MovieController.cs).
- Seerr: **DELETE `/api/v1/media/{mediaId}`**, after qBittorrent and Radarr removal verification. This is the Seerr record endpoint; the `/file` endpoint, which would issue another arr deletion, is not used. Read endpoints: `/api/v1/status`, `/api/v1/auth/me`, `/api/v1/settings/radarr`, `/api/v1/movie/{tmdbId}`, and `/api/v1/request/{requestId}`. [Seerr 3.4.1 media controller](https://github.com/seerr-team/seerr/blob/v3.4.1/server/routes/media.ts).
- Fresh reads: Radarr movie/list/movie history/media-management config; both Sonarr series lists; all three histories filtered by `downloadId` with complete pagination and both hash cases; qBittorrent torrent/member lists; native NAS inventories. Read caches are bypassed, while qBittorrent authentication sessions can be reused.

## Partial failure and recovery

Writes are never retried automatically, including timeout/HTTP errors. Status polling performs reads only. A timeout can mean an upstream action already happened: a `requested` journal step is deliberately not treated as failure or success without verification.

Each operation has a UUID and an atomically replaced, flushed JSON journal in `./state`. A file created with exclusive access serializes deletion across app processes and survives restart. If a write was requested and the outcome is uncertain, the operation is `needs-attention` and `deletion.lock` remains. A crash may leave `running`; treat it as interrupted and review it. The UI supports **Check operation status** by operation ID after reconnecting. It never resumes an interrupted mutation.

For recovery, first disable movie deletion and inspect the journal plus fresh Radarr/qBittorrent/NAS state. Reconcile only that exact movie/hash/path set. Preserve the journal. Release only the matching lock after an operator has established the outcome; do not delete journals/locks as a blanket reset. No automatic rollback can restore removed files, and no automatic resume endpoint is provided.

If Seerr removal fails after the file deletion steps, Radarr and qBittorrent remain deleted, the operation becomes `needs-attention`, and the lock stays in place. The Seerr write is never retried automatically. Historical journals without a Seerr stage remain readable; adding this integration does not retroactively delete their Seerr records.

There is no transaction spanning these external services. Another application/operator can still alter paths between a check and a service call. Do not concurrently move, import or edit the selected media while deleting. This feature removes listed live paths, not snapshots, backups or retained open handles; it does not promise secure erasure or immediate free space. Empty folders may remain. Import lists or another tool can re-add a record later because no exclusion or external request state is modified.

## Verification

The deletion checks use fake `.invalid` APIs and temporary journal files to cover guarded plans, stale/one-use confirmation, origin checks, write ordering, partial failure, no mutation retry, and durable locking. Linux `nas/test_inspector.py` uses temporary files for native hardlinks, bounded inventories and symlink rejection. Real-service verification calls preparation only; no production delete is performed by tests.
