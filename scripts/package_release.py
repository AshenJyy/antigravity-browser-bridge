"""Create npm-compatible DSH tarball and self-contained Antigravity ZIP.

Run `node scripts/build.mjs` first. No tests or installed-app changes are run.
"""
import argparse
import json
from pathlib import Path
import tarfile
import zipfile


def main():
    root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=root / "work" / "releases")
    args = parser.parse_args()
    destination = args.output.resolve()
    destination.mkdir(parents=True, exist_ok=True)
    metadata = json.loads((root / "package.json").read_text(encoding="utf-8"))
    version = metadata["version"]
    for name in ("mcp.mjs", "service.mjs", "cli.mjs"):
        if not (root / "runtime" / name).is_file():
            raise SystemExit("Missing bundled runtime; run node scripts/build.mjs first.")

    def files(entries):
        found = set()
        for entry in entries:
            path = root / entry
            for item in path.rglob("*") if path.is_dir() else [path]:
                if item.is_file() and "__pycache__" not in item.parts:
                    found.add(item.relative_to(root))
        return sorted(found)

    package_files = files(["package.json", *metadata["files"]])
    tgz = destination / f"dsh-browser-bridge-{version}.tgz"
    with tarfile.open(tgz, "w:gz", format=tarfile.PAX_FORMAT) as archive:
        for rel in package_files:
            info = archive.gettarinfo(str(root / rel), arcname="package/" + rel.as_posix())
            info.uid = info.gid = 0
            info.uname = info.gname = ""
            info.mode = 0o755 if rel.as_posix() == "scripts/cli.mjs" else 0o644
            with (root / rel).open("rb") as stream:
                archive.addfile(info, stream)

    plugin_files = files(["plugin.json", "mcp_config.json", "runtime", "extension", "skills", "docs",
                          "scripts/BrowserBridge.ps1", "scripts/Install-Antigravity.ps1", "scripts/Repair-Pairing.ps1", "README.md", "README.en.md", "CHANGELOG.md", "LICENSE",
                          "start_server.bat", "start_silent.vbs"])
    zipped = destination / f"browser-bridge-antigravity-{version}.zip"
    with zipfile.ZipFile(zipped, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for rel in plugin_files:
            archive.write(root / rel, "browser-bridge/" + rel.as_posix())
    print(tgz)
    print(zipped)


if __name__ == "__main__":
    main()
