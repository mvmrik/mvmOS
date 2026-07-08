import os
import re
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
from .db import init_db, get_conn
from .auth import router as auth_router, get_current_session
from .terminal import router as terminal_router
from .files import router as files_router
from .desktop import router as desktop_router
from .settings import router as settings_router
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
from .startup import router as startup_router, _init_startup_db, run_startup_apps
from .apphub import router as apphub_router, _init_db as _init_apphub_db
from .notifications import router as notifications_router
from .db import APPS_DIR, WIDGETS_DIR, THEMES_DIR
from . import app_backends, public_loader, projects

app = FastAPI(title="mvmOS", redirect_slashes=False)

init_db()
_init_startup_db()
_init_apphub_db()

app.include_router(auth_router)
app.include_router(terminal_router)
app.include_router(files_router)
app.include_router(desktop_router)
app.include_router(settings_router)
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
app.include_router(startup_router)
app.include_router(apphub_router)
app.include_router(notifications_router)

app_backends.load_all(app)

@app.on_event("startup")
async def _run_startup_apps():
    await run_startup_apps()
public_loader.load_all(app)
projects.init(app)

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")




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
    if path in public or path.startswith("/api/scheduler/") or path.startswith("/static") or path.startswith("/pub/") or path.startswith("/api/pub/") or path.endswith((".js", ".css", ".ico", ".png", ".svg", ".woff", ".woff2", ".webmanifest")) or "/public/" in path or path.endswith("/public"):
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

    html = re.sub(r'"(/[^"]+\.(?:js|css))"', add_version, html)

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



app.mount("/apps", StaticFiles(directory=APPS_DIR, html=True), name="apps")
app.mount("/widgets", StaticFiles(directory=WIDGETS_DIR), name="widgets")
app.mount("/themes", StaticFiles(directory=THEMES_DIR), name="themes")
app.mount("/", _MvmStaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
