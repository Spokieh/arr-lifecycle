"""Read-only metadata check for the explicitly selected sample movie on TrueNAS."""
import json
import os
import stat

base = "/mnt/storage/truenas-share/server/arr/data"
library = base + "/media/movies/Zootopia 2 (2025)/Zootopia.2.2025.MA.WEBRip.x264.HUN-FULCRUM.mkv"
torrent_dir = base + "/torrents/movies/Zootopia.2.2025.MA.WEBRip.x264.HUN-FULCRUM"
paths = [library] + [torrent_dir + "/" + suffix for suffix in [
    "fulcrum-zootopia.2.2025.webrip.ma.mkv",
    "Sample/fulcrum-zootopia.2.2025.webrip.ma-sample.mkv",
    "fulcrum-zootopia.2.2025.webrip.ma.nfo",
    "fulcrum-zootopia.2.2025.webrip.ma.sfv",
]]
results = []
for path in paths:
    current = "/"
    for part in path.split("/")[1:]:
        current = os.path.join(current, part)
        if stat.S_ISLNK(os.lstat(current).st_mode):
            raise RuntimeError("Symlink in selected path; inspection stopped")
    info = os.lstat(path)
    results.append({"path": path, "regularFile": stat.S_ISREG(info.st_mode),
                    "size": info.st_size, "device": info.st_dev,
                    "inode": info.st_ino, "links": info.st_nlink})
print(json.dumps(results, indent=2))
same = os.path.samestat(os.lstat(paths[0]), os.lstat(paths[1]))
print(json.dumps({"libraryAndTorrentSameInode": same,
                  "scope": "Live file metadata only; no deletion, no snapshot or open-handle audit"}))
