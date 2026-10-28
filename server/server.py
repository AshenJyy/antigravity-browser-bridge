"""Compatibility entry point; Browser Bridge v2 uses the bundled Node runtime."""
import os
from pathlib import Path
import shutil
import subprocess
import sys

root = Path(__file__).resolve().parent.parent
node = shutil.which("node")
if not node:
    candidate = Path(os.environ.get("USERPROFILE", str(Path.home()))) / ".dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node.exe"
    if candidate.is_file():
        node = str(candidate)
if not node:
    sys.exit("Browser Bridge v2 requires Node.js 22+ (or the DSH Desktop Node runtime).")
entry = root / "runtime/service.mjs"
if not entry.is_file():
    entry = root / "core/service.mjs"
sys.exit(subprocess.call([node, str(entry), *sys.argv[1:]]))
