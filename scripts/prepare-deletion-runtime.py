"""Docker-host provisioning: app-owned persistent deletion journal directory."""
import os
import pathlib

base = pathlib.Path("/home/pikachu/docker/compose/arr-lifecycle")
assert base.is_dir() and base.resolve() == base and os.getuid() == 1000
for directory in (base / "state", base / "secrets"):
    assert not directory.is_symlink()
    directory.mkdir(mode=0o700, exist_ok=True)
    assert directory.resolve().parent == base
    directory.chmod(0o700)
print("Persistent deletion journal directory ready.")
