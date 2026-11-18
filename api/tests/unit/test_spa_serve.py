"""单端口部署：构建产物托管与 SPA 回退。"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from l06_api.spa import mount_web_console


def _build_dist(tmp_path: Path) -> Path:
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "assets" / "index-abc123.js").write_text("console.log('ok');", encoding="utf-8")
    (dist / "index.html").write_text("<!doctype html><div id=\"root\"></div>", encoding="utf-8")
    return dist


def test_mount_serves_shell_assets_and_deep_links(tmp_path: Path) -> None:
    dist = _build_dist(tmp_path)
    app = FastAPI()
    assert mount_web_console(app, dist_dir=dist) is True
    client = TestClient(app)

    root = client.get("/")
    assert root.status_code == 200
    assert "id=\"root\"" in root.text

    deep_link = client.get("/models")
    assert deep_link.status_code == 200
    assert 'id="root"' in deep_link.text
    assert deep_link.headers["cache-control"] == "no-store"

    # /assets 由 StaticFiles 直接托管（命中挂载后不再进入 SPA 回退）；生产环境如需
    # 长缓存，应在反向代理层为 /assets/ 增加 immutable。
    asset = client.get("/assets/index-abc123.js")
    assert asset.status_code == 200
    assert "console.log" in asset.text


def test_unknown_admin_path_stays_json_404(tmp_path: Path) -> None:
    dist = _build_dist(tmp_path)
    app = FastAPI()
    assert mount_web_console(app, dist_dir=dist) is True
    client = TestClient(app)

    response = client.get("/admin/definitely-not-a-route")
    assert response.status_code == 404
    assert response.json()["code"] == "NOT_FOUND"


def test_framework_owned_routes_win_over_spa_fallback(tmp_path: Path) -> None:
    dist = _build_dist(tmp_path)
    app = FastAPI()
    assert mount_web_console(app, dist_dir=dist) is True
    client = TestClient(app)

    assert client.get("/openapi.json").status_code == 200


def test_mount_skipped_without_bundle(tmp_path: Path) -> None:
    empty = tmp_path / "empty"
    empty.mkdir()
    app = FastAPI()
    assert mount_web_console(app, dist_dir=empty) is False
    assert TestClient(app).get("/").status_code == 404
