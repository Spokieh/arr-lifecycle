"""Run on Linux with python3 -B -m unittest discover -s nas. Uses temporary fixtures only."""
import importlib.util
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest

MODULE = pathlib.Path(__file__).with_name("inspector.py")
spec = importlib.util.spec_from_file_location("inspector", MODULE)
inspector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inspector)

class InspectorTests(unittest.TestCase):
    def test_series_inventory_preserves_native_hardlinks_and_bounds_scope(self):
        previous_root, previous_fs = inspector.ROOT, inspector.filesystem
        with tempfile.TemporaryDirectory() as temp:
            try:
                inspector.ROOT = temp
                inspector.filesystem = lambda path: "zfs"
                library = pathlib.Path(temp) / "media" / "series" / "Fixture"
                torrent = pathlib.Path(temp) / "torrents" / "series" / "Fixture"
                library.mkdir(parents=True)
                torrent.mkdir(parents=True)
                for i in range(70):
                    (library / str(i)).write_bytes(b"fixture")
                    os.link(library / str(i), torrent / str(i))
                first = inspector.inventory("/data/media/series/Fixture", "series", 2048, 4096)
                second = inspector.inventory("/data/torrents/series/Fixture", "series", 2048, 4096)
                self.assertEqual(len(first["files"]), 70)
                self.assertEqual(first["files"][0]["inode"], second["files"][0]["inode"])
                self.assertEqual(first["files"][0]["links"], 2)
                with self.assertRaises(ValueError):
                    inspector.inventory("/data/media/series/Fixture", "anime")
                with self.assertRaises(ValueError):
                    inspector.inventory("/data/media/series/Fixture", "series", 64, 128)
            finally:
                inspector.ROOT, inspector.filesystem = previous_root, previous_fs

    def test_bounded_inventory_missing_paths_and_symlinks(self):
        previous_root, previous_fs = inspector.ROOT, inspector.filesystem
        with tempfile.TemporaryDirectory() as temp:
            try:
                inspector.ROOT = temp
                inspector.filesystem = lambda path: "zfs"
                folder = pathlib.Path(temp) / "media" / "movies" / "Fixture"
                folder.mkdir(parents=True)
                (folder / "movie.mkv").write_bytes(b"fixture")
                result = inspector.inventory("/data/media/movies/Fixture")
                self.assertEqual(len(result["files"]), 1)
                self.assertEqual(result["files"][0]["bytes"], "7")
                self.assertIn("modifiedNs", result["files"][0])
                self.assertEqual(inspector.inventory("/data/media/movies/Missing")["status"], "missing")
                (folder / "escape").symlink_to("/etc")
                with self.assertRaises(ValueError):
                    inspector.inventory("/data/media/movies/Fixture")
                for root in ["/data/media/movies", "/data/media/other/Fixture", "/data/torrents/movies", "/data/media/movies/../Fixture"]:
                    with self.assertRaises(ValueError):
                        inspector.inventory(root)
            finally:
                inspector.ROOT, inspector.filesystem = previous_root, previous_fs

    def test_paths(self):
        self.assertEqual(inspector.relative_path("/data/media/a.mkv"), "media/a.mkv")
        for path in ["/etc/passwd", "/data/media/../x", "/data/media/.zfs/snapshot/a", "/data/media/a\0", "/data/media-other/a", "C:\\foo"]:
            with self.assertRaises(ValueError):
                inspector.relative_path(path)

    def test_metadata_and_symlinks(self):
        with tempfile.TemporaryDirectory() as temp:
            root = pathlib.Path(temp)
            a, b = root / "a", root / "b"
            a.write_bytes(b"fixture")
            os.link(a, b)
            first, second = inspector.open_metadata(str(a)), inspector.open_metadata(str(b))
            self.assertEqual(first.st_ino, second.st_ino)
            self.assertEqual(first.st_nlink, 2)
            (root / "link").symlink_to(a)
            (root / "dirlink").symlink_to(root, target_is_directory=True)
            for path in [root / "link", root / "dirlink" / "a", root]:
                with self.assertRaises((OSError, ValueError)):
                    inspector.open_metadata(str(path))

    def test_forced_command_and_protocol(self):
        for command, body in [("id", {}), ("arr-lifecycle-inspect-v1", {"version": 1, "paths": ["/etc/passwd"]}), ("arr-lifecycle-inspect-v1", {"version": 1, "paths": ["/data/media/x"] * 65}), ("arr-lifecycle-inspect-v3", {"version": 3, "roots": ["/data/media/series/Test", "/data/torrents/anime/Test"]}), ("arr-lifecycle-inspect-v3", {"version": 3, "roots": ["/data/media/series/Test", "/data/torrents/series/Test", "/data/torrents/series/Test/a"]})]:
            result = subprocess.run([sys.executable, "-I", str(MODULE)], input=json.dumps(body), text=True, capture_output=True, env={**os.environ, "SSH_ORIGINAL_COMMAND": command})
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Inspection rejected", result.stdout)

    def test_exact_series_unlink_requires_identical_inventory_and_only_removes_listed_tree(self):
        previous_root, previous_fs = inspector.ROOT, inspector.filesystem
        with tempfile.TemporaryDirectory() as temp:
            try:
                inspector.ROOT = temp
                inspector.filesystem = lambda path: "zfs"
                tree = pathlib.Path(temp) / "media" / "anime" / "Fixture"
                nested = tree / "Season 01"
                nested.mkdir(parents=True)
                (nested / "episode.mkv").write_bytes(b"fixture")
                os.link(nested / "episode.mkv", nested / "episode-copy.mkv")
                before = inspector.inventory("/data/media/anime/Fixture", "anime", 2048, 4096)
                expected = {"device": before["device"], "files": before["files"], "directories": before["directories"]}
                changed = {**expected, "files": [{**expected["files"][0], "inode": "0"}]}
                with self.assertRaises(ValueError):
                    inspector.unlink_exact_tree("/data/media/anime/Fixture", changed)
                self.assertTrue((nested / "episode.mkv").exists())
                result = inspector.unlink_exact_tree("/data/media/anime/Fixture", expected)
                self.assertEqual(result, {"removedFiles": 2, "removedDirectories": 2})
                self.assertFalse(tree.exists())
            finally:
                inspector.ROOT, inspector.filesystem = previous_root, previous_fs

if __name__ == "__main__":
    unittest.main()
