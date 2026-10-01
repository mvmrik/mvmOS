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
