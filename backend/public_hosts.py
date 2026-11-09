"""Domains that show only Apps Hub or only one app's public page.

A row in `domains` with `public_mode` set is such a host. Everything the
public pages need (shared scripts, the app's /pub/ routes, the Apps Hub
login and API) is reachable on it; the desktop, the login and every other
route of the installation answer 404, so nothing there reveals that the same
installation also has a desktop.

  hub  - Apps Hub and every public app opened from it
  app  - one app's public page; Apps Hub stays reachable for the profile login
"""

import re

MODES = ("hub", "app")

# Shared files every public page loads (frontend/ root).
_SHARED_FILES = {
    "/asset.js", "/accent-contrast.js", "/datetime-picker.js", "/file-picker.js", "/uploader.js",
    "/extension-bridge.js", "/keyboard-preference.js", "/logo.png",
    "/favicon.ico", "/sw.js", "/manifest.webmanifest",
}
# Shared API the public header and pages call with an Apps Hub token: the bell,
# the display format and API tokens. Each route checks the token itself.
_SHARED_API = {"/api/settings/display", "/api/notifications"}
_SHARED_PREFIXES = ("/i18n/", "/pub/apphub/", "/api/pub/apphub/", "/api/pub/extapi/", "/api/platform/", "/api/notifications/")

_APP_ID = r"[a-zA-Z0-9_-]+"
# An app's icon, shown on the Apps Hub shelf next to apps the host does not open.
_ICON_RE = re.compile(rf"^/apps/{_APP_ID}/icon\.(?:svg|png|webp)$")
_HUB_RE = re.compile(rf"^/(?:pub|apps)/{_APP_ID}(?:/|$)")


def _clean(path: str) -> bool:
    return ".." not in path and "\\" not in path and "//" not in path and "%" not in path


def shared_file(path: str) -> bool:
    """Frontend files a public page loads; the only ones such a host may serve."""
    return _clean(path) and (path in _SHARED_FILES or path.startswith("/i18n/"))


def allows(mode: str | None, app_id: str, path: str) -> bool:
    if mode not in MODES or not _clean(path):
        return False
    if path in _SHARED_FILES or path in _SHARED_API or path.startswith(_SHARED_PREFIXES):
        return True
    if _ICON_RE.match(path):
        return True
    if mode == "hub":
        return bool(_HUB_RE.match(path))
    prefixes = (f"/pub/{app_id}", f"/apps/{app_id}")
    return any(path == p or path.startswith(p + "/") for p in prefixes)


async def only_app(response, app_id: str):
    """Keeps just one app in the Apps Hub app list a single-app host returns."""
    import json
    from starlette.responses import Response
    body = b"".join([chunk async for chunk in response.body_iterator])
    headers = {k: v for k, v in response.headers.items() if k.lower() not in ("content-length", "content-encoding")}
    headers["X-Mvm-Single-App"] = "1"
    try:
        data = json.loads(body)
        if isinstance(data, list):
            data = [a for a in data if isinstance(a, dict) and a.get("id") == app_id]
        elif isinstance(data, dict) and isinstance(data.get("apps"), list):
            data["apps"] = [a for a in data["apps"] if isinstance(a, dict) and a.get("id") == app_id]
        body = json.dumps(data).encode()
    except ValueError:
        pass
    return Response(content=body, status_code=response.status_code, headers=headers)
