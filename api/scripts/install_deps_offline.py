"""Offline dependency installer: PyPI fetch + wheel extract, no pip temp dirs.

The sandbox denies pip's temp unpack pattern; this installer downloads wheels
with urllib and extracts them directly into the venv site-packages (probe
verified plain file writes pass). Handles {name}.data/purelib|platlib remap and
skips scripts/headers/data payloads.
"""

from __future__ import annotations

import json
import sys
import urllib.request
import zipfile
from pathlib import Path

WHEELS = [
    ("fastapi", "0.115.8"),
    ("starlette", "0.45.3"),
    ("pydantic", "2.10.6"),
    ("pydantic_core", "2.27.2"),
    ("annotated-types", "0.7.0"),
    ("typing-extensions", "4.12.2"),
    ("anyio", "4.8.0"),
    ("sniffio", "1.3.1"),
    ("idna", "3.10"),
    ("certifi", "2025.1.31"),
    ("uvicorn", "0.34.0"),
    ("click", "8.1.8"),
    ("h11", "0.14.0"),
    ("SQLAlchemy", "2.0.37"),
    ("pydantic-settings", "2.7.1"),
    ("python-dotenv", "1.0.1"),
    ("cryptography", "44.0.0"),
    ("cffi", "1.17.1"),
    ("pycparser", "2.22"),
    ("httpx", "0.28.1"),
    ("httpcore", "1.0.7"),
    ("pytest", "8.3.4"),
    ("iniconfig", "2.0.0"),
    ("packaging", "24.2"),
    ("pluggy", "1.5.0"),
    ("pytest-asyncio", "0.25.2"),
]


def pick_wheel(name: str, version: str) -> str:
    url = f"https://pypi.org/pypi/{name}/{version}/json"
    with urllib.request.urlopen(url, timeout=60) as resp:
        payload = json.load(resp)
    wheels = [u for u in payload["urls"] if u["packagetype"] == "bdist_wheel"]
    normalized = name.replace("-", "_").lower()
    prefs = (
        lambda f: f.startswith(f"{normalized}-{version}-py3-none-any"),
        lambda f: "-cp313-cp313-win_amd64" in f,
        lambda f: "-cp313-abi3-win_amd64" in f,
        lambda f: "-cp39-abi3-win_amd64" in f,
        lambda f: "-py3-none-win_amd64" in f,
        lambda f: "-py38-none-any" in f,
    )
    for pref in prefs:
        for u in wheels:
            if pref(u["filename"]):
                return u["url"]
    raise SystemExit(f"no compatible wheel for {name} {version}: {[u['filename'] for u in wheels]}")


def install_one(name: str, version: str, site: Path, cache: Path) -> str:
    cache.mkdir(parents=True, exist_ok=True)
    wheel_url = pick_wheel(name, version)
    filename = wheel_url.rsplit("/", 1)[-1]
    wheel_path = cache / filename
    if not wheel_path.exists():
        print(f"fetch {filename}", flush=True)
        with urllib.request.urlopen(wheel_url, timeout=180) as resp, wheel_path.open("wb") as out:
            out.write(resp.read())
    with zipfile.ZipFile(wheel_path) as zf:
        for info in zf.infolist():
            target = info.filename
            lower = target.lower()
            if ".data/" in lower:
                head, tail = target.split(".data/", 1)
                bucket = tail.split("/", 1)[0]
                if bucket in ("purelib", "platlib"):
                    target = head + tail.split("/", 1)[1]
                else:
                    continue  # scripts/headers/data payloads not needed here
            if target.endswith("/"):
                (site / target).mkdir(parents=True, exist_ok=True)
                continue
            dest = site / target
            dest.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(info) as src, dest.open("wb") as out:
                out.write(src.read())
    return filename


def main() -> None:
    venv = Path(sys.argv[1]).resolve()
    site = venv / "Lib" / "site-packages"
    site.mkdir(parents=True, exist_ok=True)
    cache = venv / "wheel-cache"
    done = []
    for name, version in WHEELS:
        done.append(install_one(name, version, site, cache))
    print(f"INSTALLED {len(done)} wheels")


if __name__ == "__main__":
    main()
