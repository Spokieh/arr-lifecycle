# Whole-series deletion

Sonarr TV and Sonarr Anime share the movie deletion UI but have separate instance-scoped plans. `SERIES_DELETION_ENABLED=true` enables this feature; it is disabled by default. Authentication is not implemented: keep the app on a trusted LAN. Origin checks are not user authorization.

Preparation is read-only. It requires fresh Sonarr episodes, current episode files and history; completed torrents in `SeriesRR` or `AnimeRR`; and native NAS device/inode proof for every current episode file. It prefers exact history download hashes. When Sonarr history lacks hashes, it can bind a current file only when that file's current Sonarr ID, exact recorded import destination, exact recorded source path, the qBittorrent member path and byte size all agree. A title match is never enough. Partial series can be removed if every currently downloaded episode is covered. Historical torrents without a current episode hardlink, independent copies, overlapping folders, shared hashes, extra hardlinks, conflicting series identities, 4K Seerr variants and unavailable services block the plan.

The preview includes every library file, every selected torrent and its downloaded files, and Seerr media/request/issue identifiers. Confirmation expires after two minutes and is one-use, bound to the instance, series and service configuration. The confirmation phrase includes Sonarr TV or Sonarr Anime. Full-series deletion is supported; individual season/episode deletion is not.

Execution repeats the fresh preflight and, before the first mutation, requires NAS cleanup protocol v4 and verifies the exact library snapshot. If the NAS still has the old read-only helper, the operation blocks with no torrent or file changes. It then journals and removes torrents one at a time with `POST /api/v2/torrents/delete` (`deleteFiles=true`), verifying absence and exact hardlink-count changes after each. Once all torrent links are gone, the NAS helper rechecks every library file's path, device, inode, size, modification time, and remaining hardlink count against the plan, unlinks only those exact regular files without following symlinks, and removes only the inventoried empty directories. The app verifies the library tree is absent, then calls `DELETE /api/v3/series/{id}?deleteFiles=false&addImportListExclusion=false` to remove the Sonarr record only. Finally it removes the exact Seerr TV media record using `DELETE /api/v1/media/{id}` and verifies the media and confirmed requests are absent. It does not use Seerr's `/file` endpoint.

The v4 `expected` payload contains only `device`, `files`, and `directories`. Inventory-only fields such as `root`, `status`, and `filesystem` must be stripped at serialization; a TypeScript `Pick` does not remove them at runtime.

## Isolated deletion regression tests

```sh
docker build -f tests/deletion.Dockerfile -t arr-lifecycle:deletion-test .
docker run --rm --network none --read-only --tmpfs /tmp:rw,nosuid,nodev,size=128m arr-lifecycle:deletion-test
```

The image contains source code and dependencies, with no production environment file, credentials, media mounts, or Docker socket. Its TypeScript service runs against simulated qBittorrent/Sonarr/Seerr responses; the NAS transport invokes the actual Python helper against disposable Linux files, hardlinks and trickplay directories. The filesystem label is stubbed as ZFS, so this verifies the protocol and file operations, not a production ZFS deployment.

Both TV and anime cover successful cleanup, an unsupported NAS helper, a failure after the first library unlink, and lost responses after accepted Sonarr/Seerr removals. Tests assert the order of operations, durable journal states, preservation of unrelated files, retained locks after partial failure, and rejection of replayed confirmation tokens.

Seerr matching requires the exact TMDB/TVDB pair and the selected Sonarr server's API key. Read endpoints include Sonarr series, episode, episodefile, history and media-management config; Seerr TV details, Sonarr settings, auth/me and requests; and qBittorrent torrent/member lists. Keys remain server-only. Informational views are cached; execution never relies on cached safety evidence.

The NAS helper's `arr-lifecycle-inspect-v3` accepts only the selected series/anime library root and same-instance download roots. Protocol v4 adds a narrowly scoped exact-tree unlink for the one confirmed library root; it does not accept torrent roots or arbitrary paths. It rejects symlinks, special files, cross-device traversal and changed inventories. Limits are 64 torrents, 2,048 files per root, 4,096 files and 2,048 directories in total, with bounded depth and duration. Library cleanup is performed on native ZFS after qBittorrent's torrent data is gone; Sonarr is asked to remove its record without deleting files.

Protocol v4 increases the app key's authority: it can unlink only a freshly revalidated, explicitly confirmed series/anime library tree. Review `nas/inspector.py` and install it with `scripts/update-nas-inspector.sh` before enabling series deletion. The app capability check is deliberately before any qBittorrent mutation. Do not enable series deletion until the NAS helper and app are both upgraded.

`POST /api/shows/{tv|anime}/{id}/deletion` supports `prepare`, `execute` and read-only `status`. Movie and series operations share a durable global lock and persistent UUID journals. Writes are never automatically retried. Any uncertain result after a write leaves `needs-attention` and retains the lock; inspect the journal and actual service/filesystem state before operator recovery. Disable both deletion flags during recovery. Snapshots, backups and open handles are outside the live-file plan; this is not secure erasure.

Automated tests use fake APIs and temporary files only. Live verification must use preparation, not execution, unless a specific disposable target is explicitly approved.
