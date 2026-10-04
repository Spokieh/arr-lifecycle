"""Forced-command NAS inventory and explicitly scoped deletion helper."""
import datetime
import json
import os
import signal
import stat
import sys

ROOT = "/mnt/storage/truenas-share/server/arr/data"
MAX_PATHS = 64

def relative_path(path):
    if not isinstance(path, str) or len(path) > 4096 or "\\" in path or "\0" in path:
        raise ValueError("Invalid path")
    parts = path.split("/")
    if any(part in (".", "..", ".zfs") for part in parts) or "//" in path or path.endswith("/"):
        raise ValueError("Invalid path")
    if not (path.startswith("/data/media/") or path.startswith("/data/torrents/")):
        raise ValueError("Outside permitted roots")
    return path[len("/data/"):]

def open_handle(path):
    # Traverse directory descriptors, never following symlinks, including ancestors.
    fd = os.open("/", os.O_PATH | os.O_DIRECTORY)
    try:
        parts = path.lstrip("/").split("/")
        for index, part in enumerate(parts):
            flags = os.O_PATH | os.O_NOFOLLOW
            if index < len(parts) - 1:
                flags |= os.O_DIRECTORY
            child = os.open(part, flags, dir_fd=fd)
            os.close(fd)
            fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise

def open_metadata(path):
    fd = open_handle(path)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode):
            raise ValueError("Not a regular file")
        return info
    finally:
        os.close(fd)

def inventory(root, scope="movies", max_files=64, max_nodes=128):
    relative_path(root)
    if scope not in ("movies", "series", "anime") or not (root.startswith("/data/media/" + scope + "/") or root.startswith("/data/torrents/" + scope + "/")):
        raise ValueError("Unsupported deletion root")
    native = ROOT + "/" + relative_path(root)
    if filesystem(native) != "zfs":
        raise ValueError("Native ZFS required")
    anchor = open_handle(ROOT)
    try:
        anchor_info = os.fstat(anchor)
        if not stat.S_ISDIR(anchor_info.st_mode):
            raise ValueError("Media mount unavailable")
        device = anchor_info.st_dev
    finally:
        os.close(anchor)
    result = {"root": root, "device": str(device), "status": "present", "filesystem": "zfs", "files": [], "directories": []}
    try:
        fd = open_handle(native)
    except FileNotFoundError:
        return {**result, "status": "missing"}
    visited = 0
    def walk(handle, path, depth):
        nonlocal visited
        visited += 1
        if visited > max_nodes or depth > 16:
            raise ValueError("Inventory limit exceeded")
        info = os.fstat(handle)
        if info.st_dev != device:
            raise ValueError("Cross-filesystem inventory rejected")
        if stat.S_ISREG(info.st_mode):
            if len(result["files"]) >= max_files:
                raise ValueError("File limit exceeded")
            result["files"].append({"path": path, "device": str(info.st_dev), "inode": str(info.st_ino),
                                    "links": info.st_nlink, "bytes": str(info.st_size), "modifiedNs": str(info.st_mtime_ns)})
        elif stat.S_ISDIR(info.st_mode):
            result["directories"].append(path)
            directory = os.open(".", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=handle)
            try:
                for name in sorted(os.listdir(directory)):
                    relative_path(path + "/" + name)
                    child = os.open(name, os.O_PATH | os.O_NOFOLLOW, dir_fd=directory)
                    try:
                        walk(child, path + "/" + name, depth + 1)
                    finally:
                        os.close(child)
                if os.fstat(directory).st_mtime_ns != info.st_mtime_ns:
                    raise ValueError("Directory changed during inventory")
            finally:
                os.close(directory)
        else:
            raise ValueError("Symlink or special file rejected")
    try:
        walk(fd, root, 0)
    finally:
        os.close(fd)
    result["files"].sort(key=lambda item: item["path"])
    result["directories"].sort()
    return result

def filesystem(path):
    candidates = []
    with open("/proc/self/mountinfo", encoding="utf-8") as stream:
        for line in stream:
            left, right = line.split(" - ", 1)
            mount = left.split()[4].replace("\\040", " ").replace("\\134", "\\")
            if path == mount or path.startswith(mount.rstrip("/") + "/"):
                candidates.append((len(mount), right.split()[0]))
    return max(candidates)[1] if candidates else "unknown"

def expected_inventory_matches(root, expected):
    if not isinstance(expected, dict) or set(expected) != {"device", "files", "directories"}:
        raise ValueError("Invalid expected inventory")
    scope = "movies" if root.startswith("/data/media/movies/") else "series" if root.startswith("/data/media/series/") else "anime"
    current = inventory(root, scope, 2048, 4096)
    if current["status"] != "present" or current["device"] != expected["device"]:
        raise ValueError("NAS root identity changed")
    if current["directories"] != expected["directories"]:
        raise ValueError("NAS directory inventory changed")
    if not isinstance(expected["files"], list) or len(expected["files"]) != len(current["files"]):
        raise ValueError("NAS file inventory changed")
    by_path = {entry["path"]: entry for entry in expected["files"]}
    for entry in current["files"]:
        wanted = by_path.get(entry["path"])
        if not wanted or any(entry[key] != wanted[key] for key in ("device", "inode", "bytes", "modifiedNs", "links")):
            raise ValueError("NAS file identity or hardlink count changed")
    return current

def unlink_exact_tree(root, expected):
    current = expected_inventory_matches(root, expected)
    by_path = {entry["path"]: entry for entry in expected["files"]}
    # Validate every target before the first unlink; never recurse or follow links.
    for entry in current["files"]:
        relative_path(entry["path"])
    removed_links = {}
    for entry in current["files"]:
        parent, name = entry["path"].rsplit("/", 1)
        parent_fd = open_handle(ROOT + "/" + relative_path(parent))
        try:
            info = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
            wanted = by_path[entry["path"]]
            inode_key = (wanted["device"], wanted["inode"])
            expected_links_now = wanted["links"] - removed_links.get(inode_key, 0)
            if (not stat.S_ISREG(info.st_mode) or str(info.st_dev) != wanted["device"] or
                    str(info.st_ino) != wanted["inode"] or str(info.st_size) != wanted["bytes"] or
                    str(info.st_mtime_ns) != wanted["modifiedNs"] or info.st_nlink != expected_links_now):
                raise ValueError("NAS file changed immediately before unlink")
            os.unlink(name, dir_fd=parent_fd)
            removed_links[inode_key] = removed_links.get(inode_key, 0) + 1
        finally:
            os.close(parent_fd)
    for directory in sorted(expected["directories"], key=lambda path: (path.count("/"), path), reverse=True):
        parent, name = directory.rsplit("/", 1)
        parent_fd = open_handle(ROOT + "/" + relative_path(parent))
        try:
            os.rmdir(name, dir_fd=parent_fd)
        finally:
            os.close(parent_fd)
    return {"removedFiles": len(current["files"]), "removedDirectories": len(expected["directories"])}

def inspect(path):
    result = {"path": path, "status": "unavailable"}
    try:
        native = ROOT + "/" + relative_path(path)
        if filesystem(native) != "zfs":
            return {**result, "status": "unsupported-filesystem"}
        info = open_metadata(native)
        return {"path": path, "status": "observed", "filesystem": "zfs",
                "device": str(info.st_dev), "inode": str(info.st_ino),
                "links": info.st_nlink, "bytes": str(info.st_size)}
    except (OSError, ValueError):
        return result

def main():
    command = os.environ.get("SSH_ORIGINAL_COMMAND")
    if command not in ("arr-lifecycle-inspect-v1", "arr-lifecycle-inspect-v2", "arr-lifecycle-inspect-v3", "arr-lifecycle-delete-v4"):
        raise ValueError("Unsupported command")
    raw = sys.stdin.buffer.read(2_000_001 if command == "arr-lifecycle-delete-v4" else 65537)
    if len(raw) > (2_000_000 if command == "arr-lifecycle-delete-v4" else 65536):
        raise ValueError("Request too large")
    signal.alarm(60 if command == "arr-lifecycle-delete-v4" else 8)
    request = json.loads(raw)
    if command == "arr-lifecycle-delete-v4":
        if not isinstance(request, dict) or request.get("version") != 4:
            raise ValueError("Invalid deletion protocol")
        if request.get("mode") == "capabilities" and set(request) == {"version", "mode"}:
            print(json.dumps({"version": 4, "exactSeriesTreeUnlink": True}))
            return
        if request.get("mode") not in ("check", "delete") or set(request) != {"version", "mode", "root", "expected"}:
            raise ValueError("Invalid deletion request")
        root = request["root"]
        if not isinstance(root, str) or not (root.startswith("/data/media/movies/") or root.startswith("/data/media/series/") or root.startswith("/data/media/anime/")):
            raise ValueError("Unsupported library root")
        relative_path(root)
        expected = request["expected"]
        if request["mode"] == "check":
            expected_inventory_matches(root, expected)
            print(json.dumps({"version": 4, "checked": True}))
        else:
            result = unlink_exact_tree(root, expected)
            print(json.dumps({"version": 4, **result}))
        return
    if command == "arr-lifecycle-inspect-v3":
        if not isinstance(request, dict) or set(request) != {"version", "roots"} or request["version"] != 3:
            raise ValueError("Invalid series inventory request")
        roots = request["roots"]
        if not isinstance(roots, list) or not 2 <= len(roots) <= 65 or not all(isinstance(root, str) for root in roots):
            raise ValueError("Invalid series roots")
        scope = "series" if roots[0].startswith("/data/media/series/") else "anime" if roots[0].startswith("/data/media/anime/") else None
        if not scope or any(not root.startswith("/data/torrents/" + scope + "/") for root in roots[1:]):
            raise ValueError("Cross-scope roots rejected")
        for i, root in enumerate(roots):
            relative_path(root)
            if any(root == other or root.startswith(other + "/") or other.startswith(root + "/") for other in roots[i + 1:]):
                raise ValueError("Overlapping roots")
        results = []
        for root in roots:
            results.append(inventory(root, scope, max_files=2048, max_nodes=4096))
            if sum(len(result["files"]) for result in results) > 4096 or sum(len(result["directories"]) for result in results) > 2048:
                raise ValueError("Total series inventory limit exceeded")
        print(json.dumps({"version": 3, "inventories": results}))
        return
    if command == "arr-lifecycle-inspect-v2":
        if not isinstance(request, dict) or set(request) != {"version", "roots"} or request["version"] != 2:
            raise ValueError("Invalid inventory request")
        roots = request["roots"]
        if not isinstance(roots, list) or len(roots) != 2 or not all(isinstance(root, str) for root in roots) or roots[0] == roots[1]:
            raise ValueError("Invalid roots")
        print(json.dumps({"version": 2, "inventories": [inventory(root) for root in roots]}))
        return
    if not isinstance(request, dict) or set(request) != {"version", "paths"} or request["version"] != 1:
        raise ValueError("Invalid request")
    paths = request["paths"]
    if not isinstance(paths, list) or not 1 <= len(paths) <= MAX_PATHS:
        raise ValueError("Invalid path count")
    for path in paths:
        relative_path(path)
    if len(set(paths)) != len(paths):
        raise ValueError("Duplicate paths")
    print(json.dumps({"version": 1, "checkedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                      "observations": [inspect(path) for path in paths]}))

if __name__ == "__main__":
    try:
        main()
    except Exception:
        print('{"error":"Inspection rejected or unavailable"}')
        sys.exit(1)
