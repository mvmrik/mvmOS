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
# An app supplies its own extension scripts from apps/<id>/extension/. Core
# copies them in and wires them into the manifest without reading them, so a
# new app feature never needs a core change — which is the whole point of the
# split: nothing app-specific belongs in this repository.
_SCRIPT_RE = re.compile(r"^extension/[a-zA-Z0-9_-]+\.js$")
_MATCH_RE = re.compile(r"^(?:<all_urls>|(?:\*|https?)://(?:\*|\*\.[a-z0-9.-]+|[a-z0-9.-]+)(?::\d+)?/.*)$")
_RUN_AT = {"document_start", "document_end", "document_idle"}
_WORLDS = {"MAIN", "ISOLATED"}
_COMMAND_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,49}$")
# Generated Chrome entry point. The leading "mvm-" keeps it out of the way of
# any name an app might choose for its own background script.
_SERVICE_WORKER = "mvm-service-worker.js"
_TEMPLATES = os.path.join(os.path.dirname(__file__), "extension_templates")

def _script_path(app_dir: str, name: str) -> str:
    """Resolve an extension script from a current or legacy installed app."""
    path = os.path.join(app_dir, name)
    if os.path.isfile(path):
        return path
    return os.path.join(app_dir, "public", name)



def _app_scripts(app_dir: str, values, single: bool = False):
    """Validate a declared script list and confirm each file really exists."""
    if single and isinstance(values, str):
        values = [values]
    if values is None:
        return []
    if not isinstance(values, list) or not all(isinstance(x, str) for x in values):
        return None
    root = os.path.realpath(app_dir)
    for name in values:
        if not _SCRIPT_RE.fullmatch(name):
            return None
        # The name pattern already bars "..", but a symlink inside extension/
        # could still point out of the app, so resolve and confirm containment
        # rather than trusting the string.
        path = os.path.realpath(_script_path(app_dir, name))
        if os.path.commonpath([root, path]) != root or not os.path.isfile(path):
            return None
    return list(dict.fromkeys(values))


def _content_scripts(app_dir: str, values):
    if values is None:
        return []
    if not isinstance(values, list):
        return None
    result = []
    for entry in values:
        if not isinstance(entry, dict):
            return None
        scripts = _app_scripts(app_dir, entry.get("js"), single=True)
        matches = entry.get("matches") or ["<all_urls>"]
        run_at = entry.get("run_at", "document_idle")
        world = entry.get("world")
        if (
            not scripts
            or not isinstance(matches, list)
            or not all(isinstance(m, str) and _MATCH_RE.fullmatch(m) for m in matches)
            or run_at not in _RUN_AT
            or (world is not None and world not in _WORLDS)
        ):
            return None
        item = {"js": scripts, "matches": matches, "run_at": run_at}
        if entry.get("all_frames"):
            item["all_frames"] = True
        if world:
            item["world"] = world
        result.append(item)
    return result


def _commands(values):
    if values is None:
        return {}
    if not isinstance(values, dict):
        return None
    result = {}
    for name, entry in values.items():
        if not _COMMAND_RE.fullmatch(str(name)) or not isinstance(entry, dict):
            return None
        description = str(entry.get("description") or "")[:100]
        key = entry.get("suggested_key")
        item = {"description": description}
        if key is not None:
            if not isinstance(key, dict) or not all(isinstance(v, str) for v in key.values()):
                return None
            item["suggested_key"] = key
        result[name] = item
    return result


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
    # Width only. An app does not get to declare a popup height: the browser caps
    # a popup at 600px and enforces it silently, so a declared height is either
    # ignored or, worse, written onto the document and believed — which puts the
    # surplus off-screen with no viewport left to scroll it back. The shell gives
    # the frame the largest height a popup can actually show and nothing states a
    # height anywhere else. A "height" left in an extension.json is ignored.
    try:
        width = min(800, max(300, int(surface.get("width", 640))))
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

    content_scripts = _content_scripts(app_dir, extension.get("content_scripts"))
    background = _app_scripts(app_dir, extension.get("background"), single=True)
    popup_scripts = _app_scripts(app_dir, extension.get("popup_scripts"), single=True)
    commands = _commands(extension.get("commands"))
    host_permissions = extension.get("host_permissions") or []
    min_browser = extension.get("min_browser_version") or {}
    if (
        content_scripts is None or background is None or popup_scripts is None
        or commands is None
        or not isinstance(host_permissions, list)
        or not all(isinstance(x, str) and _MATCH_RE.fullmatch(x) for x in host_permissions)
        or not isinstance(min_browser, dict)
        or any(
            key not in _TARGETS or not _VERSION_RE.fullmatch(str(value))
            for key, value in min_browser.items()
        )
    ):
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
        "host_permissions": host_permissions,
        "content_scripts": content_scripts,
        "background": background,
        "popup_scripts": popup_scripts,
        "commands": commands,
        "min_browser_version": {k: str(v) for k, v in min_browser.items()},
        "surface": {"width": width},
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
        # Anything needing a newer Gecko than the shell's own baseline says so
        # in its extension.json — for instance a "world": "MAIN" content script,
        # which Firefox only supports from 128. Core does not need to know why.
        result["browser_specific_settings"] = {
            "gecko": {
                "id": f"{metadata['app_id']}@extensions.mvmos",
                "strict_min_version": metadata["min_browser_version"].get("firefox", "121.0"),
            }
        }
    if metadata["host_permissions"]:
        result["host_permissions"] = metadata["host_permissions"]
    if metadata["content_scripts"]:
        result["content_scripts"] = [
            {**entry, "js": _flat_names(entry["js"])} for entry in metadata["content_scripts"]
        ]
    if metadata["commands"]:
        result["commands"] = metadata["commands"]
    if metadata["background"]:
        # config.js must load first — every background script reads
        # MVM_EXTENSION_CONFIG for the app id and target browser. Firefox takes
        # a script list, Chrome a single service worker file, so for Chrome a
        # generated entry point pulls the rest in with importScripts(). The app
        # writes plain scripts either way and never sees the difference.
        result["background"] = (
            {"scripts": ["config.js", *_flat_names(metadata["background"])]}
            if browser == "firefox"
            else {"service_worker": _SERVICE_WORKER}
        )
    return result


def _flat_names(scripts: list[str]) -> list[str]:
    """apps/<id>/extension/foo.js is packaged flat, as app-foo.js.

    The prefix is not decoration: an app is free to call its script popup.js or
    options.js, and without it that file would silently overwrite the shell's
    own — leaving an extension whose popup is missing half of itself.
    """
    return ["app-" + os.path.basename(name) for name in scripts]


def _package(metadata: dict, browser: str, initial_server: str) -> bytes:
    config = {
        "appId": metadata["app_id"], "appName": metadata["name"],
        "appIcon": metadata["icon"], "publicUrl": metadata["public_url"],
        "initialServer": initial_server, "surface": metadata["surface"],
        "settings": metadata["settings"],
        "browser": browser,
    }
    app_dir = os.path.join(APPS_DIR, metadata["app_id"])
    popup_scripts = _flat_names(metadata["popup_scripts"])
    files = {
        "manifest.json": json.dumps(_manifest(metadata, browser), indent=2),
        "config.js": "globalThis.MVM_EXTENSION_CONFIG=" + json.dumps(
            config, ensure_ascii=False, separators=(",", ":")
        ) + ";\n",
        "popup.html": _template("popup.html").replace(
            "<!--APP_SCRIPTS-->",
            "".join(f'<script src="{name}"></script>' for name in popup_scripts),
        ),
        "popup.js": _template("popup.js"),
        "options.html": _template("options.html"),
        "options.js": _template("options.js"),
    }
    # Everything the app supplies, copied in verbatim and packaged flat. Core
    # does not parse these files or care what they do.
    for name in [
        *metadata["popup_scripts"], *metadata["background"],
        *[js for entry in metadata["content_scripts"] for js in entry["js"]],
    ]:
        try:
            with open(_script_path(app_dir, name), encoding="utf-8") as file:
                files[_flat_names([name])[0]] = file.read()
        except OSError as exc:
            raise HTTPException(500, detail="extension_script_missing") from exc
    if metadata["background"] and browser == "chrome":
        imports = ", ".join(
            json.dumps(name) for name in ["config.js", *_flat_names(metadata["background"])]
        )
        files[_SERVICE_WORKER] = (
            "// Generated: an MV3 service worker takes a single entry file, so the\n"
            "// shared config and the app's own background scripts are pulled in here.\n"
            f"importScripts({imports});\n"
        )
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
