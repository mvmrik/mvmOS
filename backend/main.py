import html
import json
import os
import re
import subprocess
from fastapi import FastAPI, Request
from fastapi.responses import RedirectResponse, HTMLResponse, FileResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.responses import PlainTextResponse
from starlette.routing import Match


class _MvmStaticFiles(StaticFiles):
    """Frontend static files — blocked for externally-mapped domains."""
    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            host = ""
            for name, value in scope.get("headers", []):
                if name == b"host":
                    host = value.decode().split(":")[0].lower()
                    break
            if host:
                from .db import get_conn as _get_conn
                with _get_conn() as _conn:
                    _row = _conn.execute("SELECT id FROM domains WHERE domain = ?", (host,)).fetchone()
                if _row:
                    await PlainTextResponse("Not Found", status_code=404)(scope, receive, send)
                    return
        await super().__call__(scope, receive, send)


class _AppStaticFiles(StaticFiles):
    """An app folder is a project, not a document root: only apps/<id>/public/
    is reachable. /apps/<id>/main.js therefore reads apps/<id>/public/main.js,
    and everything sitting beside that folder — data.db, db.json, the app's own
    server code — has no URL that reaches it."""
    async def get_response(self, path, scope):
        app_id, _, rest = path.partition("/")
        if not rest:
            return PlainTextResponse("Not Found", status_code=404)
        response = await super().get_response(f"{app_id}/public/{rest}", scope)
        # App assets are revalidated, never cached blind. A ?v=<version> URL is
        # tempting to mark immutable, but the version only moves on a release
        # while the file changes with every edit — so an immutable answer means
        # a developer, and anyone mid-update, is served stale code with no way
        # to refresh short of clearing the cache. Revalidation keeps almost all
        # of the saving (an unchanged file answers 304, a few hundred bytes)
        # and can never hand back a file that no longer exists on disk.
        if response.status_code == 200:
            response.headers["cache-control"] = "no-cache"
        return response


from .db import init_db, get_conn
from .auth import router as auth_router, get_current_session
from .terminal import router as terminal_router
from .files import router as files_router
from .desktop import router as desktop_router
from .settings import router as settings_router
from .premium import router as premium_router
from .users import router as users_router
from .packages import router as packages_router
from .plugins import router as plugins_router
from .system import router as system_router
from .widgets import router as widgets_router
from .themes import router as themes_router
from .updates import router as updates_router
from .cron import router as cron_router
from .domains import router as domains_router
from .projects import router as projects_router
from .backup import router as backup_router
from .scheduler import router as scheduler_router
from .ssh_access import router as ssh_access_router, init_ssh_access_db
from .startup import router as startup_router, _init_startup_db, run_startup_apps
from .apphub import router as apphub_router, public_page_router as apphub_public_router, _init_db as _init_apphub_db, is_app_public
from .notifications import router as notifications_router
from .platform_api import router as platform_router
from .extensions import router as extensions_router
from .notfound import render_404_html
from .db import APPS_DIR, WIDGETS_DIR, THEMES_DIR
from . import app_backends, app_isolation, public_loader, projects

app = FastAPI(title="mvmOS", redirect_slashes=False)

init_db()
init_ssh_access_db()
_init_startup_db()
_init_apphub_db()

app.include_router(auth_router)
app.include_router(terminal_router)
app.include_router(files_router)
app.include_router(desktop_router)
app.include_router(settings_router)
app.include_router(premium_router)
app.include_router(users_router)
app.include_router(packages_router)
app.include_router(plugins_router)
app.include_router(system_router)
app.include_router(widgets_router)
app.include_router(themes_router)
app.include_router(updates_router)
app.include_router(cron_router)
app.include_router(domains_router)
app.include_router(projects_router)
app.include_router(backup_router)
app.include_router(scheduler_router)
app.include_router(ssh_access_router)
app.include_router(startup_router)
app.include_router(apphub_router)
app.include_router(apphub_public_router, prefix="/pub/apphub")
app.include_router(notifications_router)
app.include_router(platform_router)
app.include_router(extensions_router)

app_backends.load_all(app)

@app.on_event("startup")
async def _run_startup_apps():
    await run_startup_apps()


@app.on_event("startup")
async def _premium_heartbeat():
    import asyncio

    from .premium import heartbeat_loop

    asyncio.create_task(heartbeat_loop())


@app.exception_handler(404)
async def _not_found_handler(request: Request, exc):
    accept = request.headers.get("accept", "")
    if "text/html" in accept:
        return HTMLResponse(render_404_html(), status_code=404)
    return PlainTextResponse("Not Found", status_code=404)

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")


_PWA_APP_ID_RE = re.compile(r"^[a-zA-Z0-9_-]+$")


def _public_pwa_meta(app_id: str):
    """Metadata for a public app's standalone PWA, or None when unavailable."""
    if app_id == "apphub" or not _PWA_APP_ID_RE.fullmatch(app_id):
        return None
    if public_loader._source_path(app_id) is None or not is_app_public(app_id):
        return None
    mpath = os.path.join(APPS_DIR, app_id, "manifest.json")
    try:
        with open(mpath, encoding="utf-8") as f:
            manifest = json.load(f)
    except (OSError, ValueError):
        return None
    if manifest.get("public_directory") is False:
        return None
    return {
        "id": app_id,
        "name": str(manifest.get("name") or app_id),
        "icon": str(manifest.get("icon") or "📦"),
    }


@app.get("/pub/{app_id}/manifest.webmanifest", include_in_schema=False)
async def public_app_manifest(app_id: str):
    meta = _public_pwa_meta(app_id)
    if not meta:
        return Response(status_code=404)
    base = f"/pub/{app_id}"
    payload = {
        "id": f"{base}/",
        "name": meta["name"],
        "short_name": meta["name"][:30],
        "start_url": f"{base}/",
        "scope": f"{base}/",
        "display": "standalone",
        "background_color": "#1e1e2e",
        "theme_color": "#1e1e2e",
        "icons": [
            {"src": f"{base}/pwa-icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable"},
            {"src": f"{base}/pwa-icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable"},
            {"src": f"{base}/pwa-icon.svg", "sizes": "any", "type":"image/svg+xml", "purpose": "any"},
        ],
    }
    return Response(json.dumps(payload, ensure_ascii=False), media_type="application/manifest+json")


def _public_pwa_icon_svg(meta: dict) -> str:
    icon = html.escape(meta["icon"])
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<rect width="512" height="512" fill="#89b4fa"/>
<text x="256" y="365" text-anchor="middle" font-size="350" font-family="Apple Color Emoji,Segoe UI Emoji,Noto Color Emoji,sans-serif">{icon}</text>
</svg>'''


@app.get("/pub/{app_id}/pwa-icon.svg", include_in_schema=False)
async def public_app_icon(app_id: str):
    meta = _public_pwa_meta(app_id)
    if not meta:
        return Response(status_code=404)
    return Response(_public_pwa_icon_svg(meta), media_type="image/svg+xml")


@app.get("/pub/{app_id}/pwa-icon-{size}.png", include_in_schema=False)
async def public_app_icon_png(app_id: str, size: int):
    meta = _public_pwa_meta(app_id)
    if not meta or size not in (192, 512):
        return Response(status_code=404)
    prepared = os.path.join(
        os.path.dirname(__file__), "apphub_pub", "pwa-icons", f"{app_id}-{size}.png"
    )
    if os.path.isfile(prepared):
        return FileResponse(prepared, media_type="image/png", headers={"Cache-Control": "public, max-age=86400"})
    try:
        image = subprocess.run(
            ["convert", "-background", "none", "svg:-", "-resize", f"{size}x{size}", "png:-"],
            input=_public_pwa_icon_svg(meta).encode(), stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, check=True, timeout=5,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return Response(status_code=500)
    return Response(image, media_type="image/png", headers={"Cache-Control": "public, max-age=86400"})


@app.get("/pub/{app_id}/pwa-sw.js", include_in_schema=False)
async def public_app_service_worker(app_id: str):
    if not _public_pwa_meta(app_id):
        return Response(status_code=404)
    # A fetch listener is required for installability; deliberately do not
    # cache user-specific app data or Apps Hub tokens.
    worker = "self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',()=>{});"
    return Response(worker, media_type="application/javascript", headers={"Cache-Control": "no-cache"})


def _public_pwa_snippet(app_id: str) -> str:
    """Head and body additions that offer a native PWA install for public apps."""
    meta = _public_pwa_meta(app_id)
    if not meta:
        return ""
    base = f"/pub/{app_id}"
    name_js = json.dumps(meta["name"], ensure_ascii=False)
    return f'''<link rel="manifest" href="{base}/manifest.webmanifest">
<meta name="theme-color" content="#1e1e2e">
<link rel="apple-touch-icon" href="{base}/pwa-icon-192.png">
<script>(function(){{let p;const b=document.createElement('button');b.hidden=true;b.type='button';b.textContent=((navigator.language||'').startsWith('bg')?'Инсталирай ':'Install ')+{name_js};b.style.cssText='position:fixed;right:16px;bottom:16px;z-index:2147483647;border:0;border-radius:999px;padding:10px 16px;background:#89b4fa;color:#1e1e2e;font:700 14px system-ui;box-shadow:0 4px 16px #0008;cursor:pointer';window.addEventListener('beforeinstallprompt',e=>{{e.preventDefault();p=e;b.hidden=false;}});b.onclick=async()=>{{if(!p)return;p.prompt();await p.userChoice;p=null;b.hidden=true;}};window.addEventListener('appinstalled',()=>b.remove());if('serviceWorker'in navigator)navigator.serviceWorker.register('{base}/pwa-sw.js').catch(()=>{{}});document.addEventListener('DOMContentLoaded',()=>document.body.appendChild(b));}})();</script>'''




_IS_PUBLIC_SERVER = os.environ.get("MVMOS_PUBLIC") == "1"

@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    host = request.headers.get("host", "").split(":")[0].lower()
    with get_conn() as conn:
        is_external = conn.execute("SELECT id FROM domains WHERE domain = ?", (host,)).fetchone()
    if is_external:
        return await call_next(request)

    path = request.url.path

    # Check if path is a registered subpath site
    with get_conn() as conn:
        subpath_rows = conn.execute("SELECT path FROM domains WHERE path IS NOT NULL").fetchall()
    for row in subpath_rows:
        prefix = row["path"].rstrip("/")
        if path == prefix or path.startswith(prefix + "/"):
            return await call_next(request)

    # Public server mode — only /pub/* is allowed, everything else is 404
    if _IS_PUBLIC_SERVER:
        if path.startswith("/pub/"):
            return await call_next(request)
        return Response(status_code=404)

    public = {"/login", "/login/totp", "/favicon.ico", "/api/auth/login-users"}
    # /api/platform/ is reachable with an Apps Hub token instead of a desktop
    # session — a public page has no session cookie at all. Each endpoint
    # checks the identity it needs and 401s on its own.
    if path in public or path.startswith("/api/scheduler/") or path.startswith("/api/platform/") or path.startswith("/static") or path.startswith("/pub/") or path.startswith("/api/pub/") or path.endswith((".js", ".css", ".ico", ".png", ".svg", ".woff", ".woff2", ".webmanifest")) or "/public/" in path or path.endswith("/public"):
        return await call_next(request)

    # Generic opt-out for app-backend routes that are already protected by
    # their own secret (e.g. webhook callbacks from a third-party server that
    # can never carry an mvmOS session cookie). See app_backends.py.
    for route in request.app.routes:
        if getattr(getattr(route, "endpoint", None), "no_session_auth", False):
            match, _ = route.matches(request.scope)
            if match == Match.FULL:
                return await call_next(request)
    token = request.cookies.get("session")
    if not token:
        return RedirectResponse(url="/login")
    with get_conn() as conn:
        row = conn.execute("SELECT token FROM sessions WHERE token = ?", (token,)).fetchone()
    if not row:
        return RedirectResponse(url="/login")
    return await call_next(request)


@app.middleware("http")
async def domain_middleware(request: Request, call_next):
    host = request.headers.get("host", "").split(":")[0].lower()

    # Check subpath-mapped sites first
    req_path = request.url.path
    if not req_path.endswith((".js", ".css", ".ico", ".png", ".svg", ".woff", ".woff2", ".json", ".html", ".txt", ".map")):
        with get_conn() as conn:
            rows = conn.execute(
                "SELECT app_id, path FROM domains WHERE path IS NOT NULL ORDER BY length(path) DESC"
            ).fetchall()
        for row in rows:
            prefix = row["path"].rstrip("/")
            if req_path == prefix or req_path.startswith(prefix + "/"):
                subpath = req_path[len(prefix):]
                return await _dispatch_public(row["app_id"], subpath, request)

    # Check external domain mapping
    with get_conn() as conn:
        row = conn.execute("SELECT app_id FROM domains WHERE domain = ?", (host,)).fetchone()
    if not row:
        return await call_next(request)

    # Block .py files always
    if request.url.path.endswith(".py"):
        return Response(status_code=404)

    app_id = row["app_id"]
    path = request.url.path.rstrip("/") or "/"

    # Serve static files from public/
    public_dir = public_loader.get_app_public_dir(app_id)
    return await _dispatch_public(app_id, path, request)


_PUB_APP_RE = re.compile(r"^/pub/([a-zA-Z0-9_-]+)/")
_APPS_PUBLIC_RE = re.compile(r"^/apps/[a-zA-Z0-9_-]+/public(/|$)")


def _app_wants_public_chrome(app_id: str) -> bool:
    """Manifest opt-out: an app can set "public_chrome": false to render fully
    standalone public pages (own header/footer/identity) with no injected
    Apps Hub chrome — e.g. an app whose public pages are end-user-owned sites,
    not the app's own public interface."""
    import json
    mpath = os.path.join(APPS_DIR, app_id, "manifest.json")
    try:
        with open(mpath) as f:
            m = json.load(f)
    except Exception:
        return True
    return m.get("public_chrome", True) is not False


_PUBLIC_THEME_BOOTSTRAP = """<script>(function(){try{var r=document.documentElement,t=localStorage.getItem('apphub_theme'),f=localStorage.getItem('apphub_font_size')||'md',s={sm:'90%',md:'100%',lg:'112%',xl:'125%',xxl:'140%',xxxl:'155%'};if(t==='auto')t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';r.style.fontSize=s[f]||s.md;if(t==='light'){r.style.cssText+=';--bg:#f6f8fa;--surface1:#ffffff;--surface2:#eaeef2;--border:#d0d7de;--fg:#1f2328;--fg2:#656d76;--accent:#0969da;--green:#1a7f37;--red:#cf222e;--yellow:#9a6700;--pub-bg:#f6f8fa;--pub-surface1:#ffffff;--pub-surface2:#eaeef2;--pub-border:#d0d7de;--pub-fg:#1f2328;--pub-fg2:#656d76;--pub-dim:#8c959f;--pub-crust:#eef1f4;--pub-accent:#0969da;--pub-accent-hover:#0860ca;--pub-green:#1a7f37;--pub-red:#cf222e;--pub-yellow:#9a6700;--pub-warning:#9a6700'}}catch(e){}})();</script>"""

_LANG_BOOTSTRAP_CACHE: dict = {}

def _public_lang_bootstrap(browser_only: bool = False) -> str:
    """Runs before /i18n/i18n.js (included later, in <body>) so that loader
    sees window.mvmOS.pubLang already set and never touches the desktop-only
    /api/settings endpoint (401s with no OS session — see
    frontend/i18n/i18n.js). Mirrors the theme bootstrap above: last-known
    preference is cached in localStorage by apphub_pub/index.html's Settings
    tab, 'auto' resolved here from navigator.language against whatever
    languages core actually ships (frontend/i18n/*.js) rather than a
    hardcoded pair, so a newly added language file is picked up for real
    per-visitor detection with no change needed here. A recipient-facing
    mvmShare link is deliberately browser-only: it must not inherit an Apps
    Hub profile or a previous visitor's preference from this shared origin."""
    cache_key = "browser_only" if browser_only else "default"
    i18n_dir = os.path.join(os.path.dirname(__file__), "..", "frontend", "i18n")
    # Cached on the directory's own mtime instead of listed per request: this
    # runs for every public HTML response, while the listing only changes when a
    # language file is added or removed — which still takes effect at once, with
    # no reload needed.
    try:
        stamp = os.stat(i18n_dir).st_mtime
    except OSError:
        stamp = None
    cached = _LANG_BOOTSTRAP_CACHE.get(cache_key)
    if cached and cached.get("stamp") == stamp:
        return cached["html"]
    try:
        entries = sorted(
            (f[:-3], int(os.path.getmtime(os.path.join(i18n_dir, f))))
            for f in os.listdir(i18n_dir) if f.endswith(".js") and f != "i18n.js"
        )
    except OSError:
        entries = [("en", 0)]
    langs_js  = json.dumps([code for code, _ in entries])
    stamps_js = json.dumps({code: mt for code, mt in entries})
    # document.write is deliberate. The language is only knowable on the client
    # (localStorage, then navigator.language), so the server cannot put a plain
    # <script src> here — and every other way of loading it is asynchronous,
    # which means the page paints before the table exists. That is what made the
    # header render "Home"/"Profile" from layout.js's English fallbacks and then
    # visibly flip to Bulgarian a moment later. Written during head parsing this
    # blocks until the table is in place, so the first paint is already
    # translated. The stamp is each file's mtime rather than Date.now(), so the
    # browser really caches it instead of re-fetching ~80 KB on every page.
    html = (
        "<script>(function(){try{window.mvmOS=window.mvmOS||{};"
        "var avail=" + langs_js + ",stamps=" + stamps_js + ";"
        "window.mvmOS.availableLangs=avail;"
        "window.mvmOS.langStamps=stamps;"
        "window.mvmOS.browserLanguageOnly=" + ("true" if browser_only else "false") + ";"
        "window.mvmOS.publicSharePage=" + ("true" if browser_only else "false") + ";"
        "var l=" + ("'auto'" if browser_only else "localStorage.getItem('apphub_language')||'auto'") + ";"
        "if(l==='auto'){"
        "var nav=(navigator.language||'en').toLowerCase();"
        "l=avail.find(function(x){return nav.indexOf(x)===0})||'en';"
        "}"
        "window.mvmOS.pubLang=l;"
        "document.write('<scr'+'ipt src=\"/i18n/'+l+'.js?v='+(stamps[l]||0)+'\"><\\/scr'+'ipt>');"
        "}catch(e){}})();</script>"
    )
    _LANG_BOOTSTRAP_CACHE[cache_key] = {"stamp": stamp, "html": html}
    return html


@app.middleware("http")
async def block_apps_public_middleware(request: Request, call_next):
    """/apps/<id>/public/... is a static-file backdoor into the same pages
    served properly at /pub/<id>/ (auth checks, layout injection). Block it
    so /pub/<id>/ is the only real entry point."""
    if _APPS_PUBLIC_RE.match(request.url.path):
        return Response(status_code=404)
    return await call_next(request)



@app.middleware("http")
async def layout_inject_middleware(request: Request, call_next):
    """Auto-inject the shared header/footer chrome (backend/apphub_pub/layout.js)
    into every /pub/<app>/ HTML page. Apps never include this themselves — it's
    added centrally here so every public app gets it for free, including future ones."""
    response = await call_next(request)
    m = _PUB_APP_RE.match(request.url.path)
    if not m or not response.headers.get("content-type", "").startswith("text/html"):
        return response
    app_id = m.group(1)
    # A received mvmShare link is a tiny decrypt-and-open page, not an Apps
    # Hub destination. Its URL is replaced as soon as the browser decrypts it.
    is_mvmshare_recipient = (
        app_id == "mvmshare"
        and request.url.path.startswith("/pub/mvmshare/s/")
    )
    wants_public_chrome = _app_wants_public_chrome(app_id)
    # A browser-extension popup embeds this page as its whole interface, so the
    # Apps Hub header, footer and navigation have nothing to offer there — the
    # popup already shows the app name and its own settings button, and the
    # chrome only costs a visible extra load. The same page opened normally is
    # untouched: the flag is set by the extension shell, not by the app.
    if request.query_params.get("ext") == "1":
        return response

    body = b""
    async for chunk in response.body_iterator:
        body += chunk if isinstance(chunk, bytes) else chunk.encode()

    html = body.decode("utf-8", errors="ignore")
    keyboard_path = os.path.join(os.path.dirname(__file__), "..", "frontend", "keyboard-preference.js")
    try:
        keyboard_version = int(os.path.getmtime(keyboard_path))
    except OSError:
        keyboard_version = 0
    keyboard_snippet = f'<script src="/keyboard-preference.js?v={keyboard_version}" data-mvm-keyboard-scope="public"></script>'
    html = html.replace("</head>", keyboard_snippet + "</head>", 1) if "</head>" in html else keyboard_snippet + html

    if is_mvmshare_recipient or not wants_public_chrome or "/pub/apphub/layout.js" in html:
        snippet = ""
    else:
        layout_js_path = os.path.join(os.path.dirname(__file__), "apphub_pub", "layout.js")
        try:
            v = int(os.path.getmtime(layout_js_path))
        except OSError:
            v = 0
        snippet = f'<script src="/pub/apphub/layout.js?v={v}" data-mvm-app="{app_id}"></script>'
    if snippet:
        html = html.replace("</body>", snippet + "</body>", 1) if "</body>" in html else html + snippet
    pwa = None if is_mvmshare_recipient or not wants_public_chrome else _public_pwa_snippet(app_id)
    if pwa:
        html = html.replace("</head>", pwa + "</head>", 1) if "</head>" in html else pwa + html
    html = html.replace("</head>", _PUBLIC_THEME_BOOTSTRAP + "</head>", 1) if "</head>" in html else _PUBLIC_THEME_BOOTSTRAP + html
    browser_language_only = is_mvmshare_recipient
    lang_bootstrap = _public_lang_bootstrap(browser_only=browser_language_only)
    html = html.replace("</head>", lang_bootstrap + "</head>", 1) if "</head>" in html else lang_bootstrap + html

    headers = dict(response.headers)
    for h in ("content-length", "etag", "last-modified", "accept-ranges"):
        headers.pop(h, None)
    return Response(content=html, status_code=response.status_code, headers=headers, media_type="text/html")


def _versioned_html():
    index_path = os.path.join(FRONTEND_DIR, "index.html")
    html = open(index_path).read()

    def add_version(m):
        src = m.group(1)
        filepath = os.path.join(FRONTEND_DIR, src.lstrip("/"))
        if os.path.isfile(filepath):
            mtime = int(os.path.getmtime(filepath))
            return f'"{src}?v={mtime}"'
        return m.group(0)

    html = re.sub(r'"(/[^"?]+\.(?:js|css))(?:\?[^"]*)?"', add_version, html)

    # Inject mvmOS version as meta tag
    try:
        version_path = os.path.join(os.path.dirname(FRONTEND_DIR), "version.txt")
        mvmos_version = open(version_path).read().strip()
        html = html.replace('<meta charset="UTF-8">', f'<meta charset="UTF-8">\n<meta name="mvmos-version" content="{mvmos_version}">')
    except Exception:
        pass

    return html


@app.get("/")
async def serve_index(request: Request):
    host = request.headers.get("host", "").split(":")[0].lower()
    with get_conn() as conn:
        is_external = conn.execute("SELECT id FROM domains WHERE domain = ?", (host,)).fetchone()
    if is_external:
        return Response(status_code=404)
    return HTMLResponse(_versioned_html())


async def _dispatch_public(app_id: str, subpath: str, request: Request) -> Response:
    """Serve a public app — static files first, then API routes, then SPA fallback."""
    import httpx
    path = "/" + subpath.lstrip("/") if subpath else "/"
    public_dir = public_loader.get_app_public_dir(app_id)

    # Block .py files
    if path.endswith(".py"):
        return Response(status_code=404)

    # Exact static file
    if public_dir:
        rel = path.lstrip("/")
        exact = os.path.join(public_dir, rel)
        if rel and os.path.isfile(exact) and not exact.endswith(".py"):
            return FileResponse(exact)
        index = os.path.join(public_dir, rel, "index.html") if rel else os.path.join(public_dir, "index.html")
        if os.path.isfile(index):
            return FileResponse(index)

    # API route via httpx ASGI
    pub_path = f"/pub/{app_id}{path}"
    qs = request.scope.get("query_string", b"")
    url = f"http://testserver{pub_path}"
    if qs:
        url += f"?{qs.decode()}"
    body_bytes = await request.body()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver") as client:
        r = await client.request(
            method=request.method,
            url=url,
            content=body_bytes,
            headers={k: v for k, v in request.headers.items()
                     if k.lower() not in ("host", "content-length")},
        )

    if r.status_code == 404 and public_dir:
        index = os.path.join(public_dir, "index.html")
        if os.path.isfile(index):
            return FileResponse(index)

    skip = {"content-encoding", "transfer-encoding", "content-length"}
    return Response(content=r.content, status_code=r.status_code,
                    headers={k: v for k, v in r.headers.items() if k.lower() not in skip})



# Confine apps/<id>/ server code to its own folder before any of it is loaded.
# Core and backend/apps/<id>/ are unaffected — only an app's own module and
# routes run confined, so an app cannot open core data.db or a sibling app's
# files. Anything it legitimately needs goes through /api/platform/.
app_isolation.install()

# Load app-specific public routes after the core public PWA routes above.
# This keeps /pub/<app>/manifest.webmanifest and its worker from being
# swallowed by an app's optional SPA catch-all route.
public_loader.load_all(app)
projects.init(app)

app.mount("/apps", _AppStaticFiles(directory=APPS_DIR, html=True), name="apps")
app.mount("/widgets", StaticFiles(directory=WIDGETS_DIR), name="widgets")
app.mount("/themes", StaticFiles(directory=THEMES_DIR), name="themes")
app.mount("/", _MvmStaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
