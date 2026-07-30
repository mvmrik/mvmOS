"""Generate a shared browser-extension shell for apps with extension.json."""

import io
import json
import os
import re
import zipfile
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response

from .auth import get_current_session
from .db import APPS_DIR

router = APIRouter(prefix="/api/extensions", tags=["extensions"])

_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
_VERSION_RE = re.compile(r"^[0-9]+(?:\.[0-9]+){0,3}$")
_TARGETS = {"chrome", "firefox"}
_PERMISSIONS = {
    "activeTab", "alarms", "clipboardRead", "clipboardWrite", "contextMenus",
    "notifications", "scripting", "storage", "tabs",
}
_TEMPLATES = os.path.join(os.path.dirname(__file__), "extension_templates")


def load_extension_metadata(app_id: str) -> dict | None:
    if not _ID_RE.fullmatch(app_id):
        return None
    app_dir = os.path.join(APPS_DIR, app_id)
    try:
        with open(os.path.join(app_dir, "manifest.json")) as file:
            manifest = json.load(file)
        with open(os.path.join(app_dir, "extension.json")) as file:
            extension = json.load(file)
    except (OSError, ValueError):
        return None
    if extension.get("enabled") is False:
        return None
    public_url = manifest.get("public_url")
    targets = [x for x in extension.get("targets", []) if x in _TARGETS]
    version = str(extension.get("version") or "1.0.0")
    permissions = extension.get("permissions") or ["storage"]
    if (
        not isinstance(public_url, str) or not public_url.startswith("/pub/")
        or not targets or not _VERSION_RE.fullmatch(version)
        or not isinstance(permissions, list)
        or any(permission not in _PERMISSIONS for permission in permissions)
    ):
        return None
    permissions = list(dict.fromkeys([*permissions, "storage"]))
    surface = extension.get("surface") or {}
    try:
        width = min(800, max(300, int(surface.get("width", 640))))
        height = min(800, max(360, int(surface.get("height", 620))))
    except (TypeError, ValueError):
        return None
    settings = extension.get("settings") or []
    distribution = extension.get("distribution") or {}
    icon_file = extension.get("icon")
    if (
        icon_file is not None
        and (
            not isinstance(icon_file, str)
            or not re.fullmatch(r"public/[a-zA-Z0-9_.-]+\.(?:png|jpg|jpeg)", icon_file)
        )
    ):
        return None
    if not isinstance(settings, list) or not isinstance(distribution, dict):
        return None
    return {
        "app_id": app_id,
        "name": manifest.get("name", app_id),
        "description": manifest.get("description", ""),
        "icon": manifest.get("icon", "🧩"),
        "icon_file": icon_file,
        "public_url": public_url,
        "version": version,
        "targets": targets,
        "permissions": permissions,
        "capabilities": extension.get("capabilities") or [],
        "surface": {"width": width, "height": height},
        "settings": settings,
        "distribution": {
            "chrome_store_url": distribution.get("chrome_store_url"),
            "firefox_store_url": distribution.get("firefox_store_url"),
        },
    }


def _server_url(value: str) -> str:
    parsed = urlparse(value.strip().rstrip("/"))
    if (
        parsed.scheme not in ("http", "https") or not parsed.netloc
        or parsed.username or parsed.password
    ):
        raise HTTPException(400, detail="invalid_server_url")
    return f"{parsed.scheme}://{parsed.netloc}"


def _template(name: str) -> str:
    try:
        with open(os.path.join(_TEMPLATES, name)) as file:
            return file.read()
    except OSError as exc:
        raise HTTPException(500, detail="extension_template_missing") from exc


def _manifest(metadata: dict, browser: str) -> dict:
    icons = {"16": "icon.png", "32": "icon.png", "48": "icon.png", "128": "icon.png"}
    result = {
        "manifest_version": 3,
        "name": metadata["name"],
        "version": metadata["version"],
        "description": metadata["description"][:132],
        "permissions": metadata["permissions"],
        "icons": icons,
        "action": {
            "default_title": metadata["name"],
            "default_popup": "popup.html",
            "default_icon": icons,
        },
        "options_ui": {"page": "options.html", "open_in_tab": True},
        "content_security_policy": {
            "extension_pages": "script-src 'self'; object-src 'self'; frame-src http: https:"
        },
    }
    if browser == "firefox":
        result["browser_specific_settings"] = {
            "gecko": {"id": f"{metadata['app_id']}@extensions.mvmos", "strict_min_version": "121.0"}
        }
    return result


def _package(metadata: dict, browser: str, initial_server: str) -> bytes:
    config = {
        "appId": metadata["app_id"], "appName": metadata["name"],
        "appIcon": metadata["icon"], "publicUrl": metadata["public_url"],
        "initialServer": initial_server, "surface": metadata["surface"],
        "capabilities": metadata["capabilities"], "settings": metadata["settings"],
        "browser": browser,
    }
    files = {
        "manifest.json": json.dumps(_manifest(metadata, browser), indent=2),
        "config.js": "globalThis.MVM_EXTENSION_CONFIG=" + json.dumps(
            config, ensure_ascii=False, separators=(",", ":")
        ) + ";\n",
        "popup.html": _template("popup.html"),
        "popup.js": _template("popup.js"),
        "options.html": _template("options.html"),
        "options.js": _template("options.js"),
    }
    icon_file = metadata.get("icon_file")
    if icon_file:
        icon_path = os.path.join(APPS_DIR, metadata["app_id"], icon_file)
    else:
        icon_path = os.path.join(os.path.dirname(__file__), "..", "frontend", "favicon-512.png")
    try:
        with open(icon_path, "rb") as file:
            icon_data = file.read(2 * 1024 * 1024 + 1)
        if len(icon_data) > 2 * 1024 * 1024:
            raise OSError
    except OSError as exc:
        raise HTTPException(500, detail="extension_icon_missing") from exc
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, content in files.items():
            archive.writestr(name, content)
        archive.writestr("icon.png", icon_data)
    return output.getvalue()


@router.get("/{app_id}")
async def info(app_id: str, _session=Depends(get_current_session)):
    metadata = load_extension_metadata(app_id)
    if metadata is None:
        raise HTTPException(404, detail="extension_not_found")
    return metadata


@router.get("/{app_id}/download")
async def download(
    app_id: str,
    request: Request,
    browser: str = Query(...),
    server_url: str | None = Query(default=None),
    _session=Depends(get_current_session),
):
    metadata = load_extension_metadata(app_id)
    if metadata is None or browser not in metadata["targets"]:
        raise HTTPException(404, detail="extension_not_found")
    initial_server = _server_url(server_url or str(request.base_url))
    content = _package(metadata, browser, initial_server)
    filename = f"{app_id}-{browser}-{metadata['version']}.zip"
    return Response(
        content,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
