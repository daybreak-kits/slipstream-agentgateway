"""Single-port deployment: serve the built admin console (web/dist) from the control plane.

The console is a Vite SPA. In production the control plane owns port 3700 and serves
both /admin APIs and the static bundle, so operators open one URL (no separate 5173).
Deep links (/models, /settings, ...) must return index.html; unknown /admin paths must
stay JSON 404s instead of accidentally rendering the SPA shell.

Resolution order for the bundle directory:
1. explicit dist_dir argument (tests / embedding);
2. SLIPSTREAM_WEB_DIST setting (deployment override);
3. <repo>/web/dist (local build: cd web && npm run build).
No bundle -> the app still boots (API-only mode, e.g. pytest or a fresh checkout).
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from starlette.staticfiles import StaticFiles

from l01_core.settings import get_settings

_REPO_ROOT = Path(__file__).resolve().parents[3]
_DEFAULT_DIST = _REPO_ROOT / "web" / "dist"

#: API/文档前缀：这些路径绝不回退到 index.html，否则前端 fetch 会拿到 HTML。
_API_PREFIXES = ("admin", "api", "openapi.json", "docs", "redoc")


def resolve_web_dist(dist_dir: str | Path | None = None) -> Path | None:
    """Return the console build directory, or None when it has not been built."""
    if dist_dir is not None:
        candidates = [Path(dist_dir)]
    else:
        configured = get_settings().web_dist_dir.strip()
        candidates = [Path(configured).expanduser()] if configured else []
        candidates.append(_DEFAULT_DIST)
    for candidate in candidates:
        resolved = candidate.resolve()
        if (resolved / "index.html").is_file():
            return resolved
    return None


def mount_web_console(app: FastAPI, dist_dir: str | Path | None = None) -> bool:
    """Mount the built console at / with an SPA fallback; returns True when mounted."""
    dist = resolve_web_dist(dist_dir)
    if dist is None:
        return False
    assets = dist / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="web-assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def _spa_fallback(full_path: str):
        if _is_api_path(full_path):
            return JSONResponse({"code": "NOT_FOUND", "message": "not found"}, status_code=404)
        target = (dist / full_path).resolve() if full_path else None
        if target is not None and target.is_file() and target.is_relative_to(dist):
            # Hashed bundle files are immutable; everything else stays revalidated.
            headers = (
                {"Cache-Control": "public, max-age=31536000, immutable"}
                if full_path.startswith("assets/")
                else None
            )
            return FileResponse(target, headers=headers)
        # Unknown path == client-side route: return the shell, never cache it.
        return FileResponse(dist / "index.html", headers={"Cache-Control": "no-store"})

    return True


def _is_api_path(full_path: str) -> bool:
    return any(
        full_path == prefix or full_path.startswith(prefix + "/")
        for prefix in _API_PREFIXES
    )
