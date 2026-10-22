"""
asset(url) — the one way to name a file that a browser loads.

Returns the URL with ?v=<time the file last changed>, so a changed file always
has a new address and no cache (browser, Electron, Cloudflare) can serve an old
copy of it, while an unchanged file keeps its address and stays cached. Nothing
in mvmOS or in a Store app names a script, stylesheet, image, font or data file
without it.

The same function exists in the browser (frontend/asset.js, window.asset), fed by
manifest(), so core, Store apps and public pages all version a file in exactly
one way.
"""

import json
import os
import re
import time

from .db import APPS_DIR, WIDGETS_DIR, THEMES_DIR

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
_FRONTEND = os.path.join(_ROOT, "frontend")
_PUB_DIRS = {"apphub": os.path.join(_ROOT, "backend", "apphub_pub")}
_PUB_FILES = {"/pub/automations/ui.js": os.path.join(_ROOT, "backend", "automations_pub", "automations-ui.js")}
_SKIP = re.compile(r"(^|/)(\.|__pycache__|[^/]*upload[^/]*/)")
_LOCAL = re.compile(r"^/[^/]")


def _file_of(path: str):
    """The file a URL path is served from, or None."""
    if path in _PUB_FILES:
        return _PUB_FILES[path]
    parts = path.lstrip("/").split("/")
    head, rest = parts[0], "/".join(parts[1:])
    if head in ("apps", "pub") and len(parts) > 2:
        if head == "pub" and parts[1] in _PUB_DIRS:
            base, rest = _PUB_DIRS[parts[1]], "/".join(parts[2:])
        else:
            base, rest = os.path.join(APPS_DIR, parts[1], "public"), "/".join(parts[2:])
    elif head == "widgets":
        base = WIDGETS_DIR
    elif head == "themes":
        base = THEMES_DIR
    else:
        base, rest = _FRONTEND, path.lstrip("/")
    full = os.path.abspath(os.path.join(base, rest))
    return full if full.startswith(os.path.abspath(base) + os.sep) else None


def asset(url: str) -> str:
    """url with ?v=<mtime>; an address that is not a local file (another site,
    an API route, a data: URL, a file that does not exist) is returned as is."""
    url = str(url or "")
    path, sep, query = url.partition("?")
    if not _LOCAL.match(path) or path.startswith("//"):
        return url
    file = _file_of(path)
    try:
        stamp = int(os.stat(file).st_mtime) if file else None
    except OSError:
        stamp = None
    if stamp is None or not os.path.isfile(file):
        return url
    query = "&".join(p for p in query.split("&") if p and not p.startswith("v="))
    return f"{path}?{query + '&' if query else ''}v={stamp}"


_ICON_FILE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_./-]{0,100}\.(svg|png|webp|jpe?g)$")
_ICON_MAX_BYTES = 400 * 1024


def icon_image(app_id: str, manifest: dict | None) -> str | None:
    """The URL of an app's own picture icon, or None to keep its emoji.

    An app names the file in its manifest.json ("icon_image": "icon.svg", a
    path inside its public/ folder). Only a file that is really there, of a
    picture type, not too large and inside public/ is accepted, so a manifest
    can never point the desktop at some other address. The emoji in "icon"
    stays the fallback everywhere a picture cannot be shown."""
    if not isinstance(app_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]+", app_id):
        return None
    name = (manifest or {}).get("icon_image")
    if not isinstance(name, str) or not _ICON_FILE.match(name) or ".." in name:
        return None
    url = f"/apps/{app_id}/{name}"
    file = _file_of(url)
    try:
        public = os.path.realpath(os.path.join(APPS_DIR, app_id, "public"))
        if (not file or not os.path.realpath(file).startswith(public + os.sep)
                or not os.path.isfile(file) or os.path.getsize(file) > _ICON_MAX_BYTES):
            return None
    except OSError:
        return None
    return asset(url)


_cache = {"at": 0.0, "body": "{}"}


def manifest() -> str:
    """JSON {url path: mtime} of every file the desktop and public pages can
    load, for window.asset in the browser. Rebuilt at most every 2 seconds."""
    now = time.time()
    if now - _cache["at"] < 2:
        return _cache["body"]
    out = {}

    def walk(base, prefix):
        for dirpath, dirs, files in os.walk(base):
            dirs[:] = [d for d in dirs if not _SKIP.search(d + "/")]
            rel = os.path.relpath(dirpath, base)
            for f in files:
                if f.startswith(".") or f.endswith((".py", ".pyc", ".db")):
                    continue
                url = prefix + ("" if rel == "." else rel.replace(os.sep, "/") + "/") + f
                try:
                    out[url] = int(os.stat(os.path.join(dirpath, f)).st_mtime)
                except OSError:
                    pass

    walk(_FRONTEND, "/")
    walk(WIDGETS_DIR, "/widgets/")
    walk(THEMES_DIR, "/themes/")
    walk(_PUB_DIRS["apphub"], "/pub/apphub/")
    for url, file in _PUB_FILES.items():
        try:
            out[url] = int(os.stat(file).st_mtime)
        except OSError:
            pass
    try:
        ids = os.listdir(APPS_DIR)
    except OSError:
        ids = []
    for app_id in ids:
        pub = os.path.join(APPS_DIR, app_id, "public")
        if os.path.isdir(pub):
            walk(pub, f"/apps/{app_id}/")
    _cache["at"], _cache["body"] = now, json.dumps(out, separators=(",", ":"))
    return _cache["body"]


_REF = re.compile(r"""\b(src|href)="([^"#:$'+{}<>\s]+)\"""")


def versioned_html(html: str, base: str = "") -> str:
    """An HTML page with every local src/href passed through asset(). base is
    the URL folder the page is served from ("/pub/<id>/"), so a relative
    reference ("main.js") is versioned too and stays written as relative."""
    def fix(m):
        ref = m.group(2)
        if ref.startswith("/"):
            return f'{m.group(1)}="{asset(ref)}"'
        if not base or ref.startswith("//"):
            return m.group(0)
        full = asset(base + ref)
        _, sep, query = full.partition("?")
        return f'{m.group(1)}="{ref.partition("?")[0]}{sep}{query}"'
    return _REF.sub(fix, html)
