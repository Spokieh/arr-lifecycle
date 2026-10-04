"""Test-only SSH replacement; uses the production helper on temporary fixtures."""
import importlib.util
import json
import os
import pathlib
import sys
import tempfile

root = pathlib.Path(os.environ["ARR_TEST_NAS_ROOT"]).resolve()
if root.parent != pathlib.Path(tempfile.gettempdir()).resolve() or not root.name.startswith("arr-native-series-"):
    raise RuntimeError("Only test-created temporary roots are permitted")
module_path = pathlib.Path(__file__).resolve().parent.parent / "nas" / "inspector.py"
spec = importlib.util.spec_from_file_location("fixture_inspector", module_path)
inspector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inspector)
inspector.ROOT = str(root)
# The container has a temporary Linux filesystem, not the real NAS ZFS mount.
inspector.filesystem = lambda path: "zfs"
os.environ["SSH_ORIGINAL_COMMAND"] = sys.argv[1]
scenario = os.environ.get("ARR_TEST_SCENARIO", "normal")
if scenario == "legacy":
    original_main = inspector.main
    def legacy_main():
        if sys.argv[1] == "arr-lifecycle-delete-v4":
            raise ValueError("Legacy helper cannot accept v4")
        original_main()
    inspector.main = legacy_main
if scenario == "partial-cleanup":
    original_unlink = inspector.os.unlink
    count = 0
    def partial_unlink(*args, **kwargs):
        global count
        if count == 1:
            raise OSError("Injected failure after one unlink")
        original_unlink(*args, **kwargs)
        count += 1
    inspector.os.unlink = partial_unlink
try:
    inspector.main()
except Exception:
    print(json.dumps({"error": "Inspection rejected or unavailable"}))
    sys.exit(1)
