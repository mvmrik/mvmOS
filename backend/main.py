import os
import re
from fastapi import FastAPI, Request
from fastapi.responses import RedirectResponse, HTMLResponse, FileResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.responses import PlainTextResponse

_MVMOS_HOST = os.environ.get("MVMOS_HOST", "mvmos.mvmrik.com")
_IP_RE = re.compile(r"^\d{1,3}(\.\d{1,3}){3}$")

def _is_local_host(host: str) -> bool:
    return host in ("localhost", "127.0.0.1", "testserver") or bool(_IP_RE.match(host)) or (bool(_MVMOS_HOST) and host == _MVMOS_HOST)


class _MvmStaticFiles(StaticFiles):
    """Frontend static files — only served for the mvmOS host, not external domains."""
    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            host = ""
            for name, value in scope.get("headers", []):
                if name == b"host":
                    host = value.decode().split(":")[0].lower()
                    break
            if host and not _is_local_host(host):
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
from .db import APPS_DIR, WIDGETS_DIR, THEMES_DIR
from . import app_backends, public_loader, projects

app = FastAPI(title="mvmOS", redirect_slashes=False)

init_db()

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

app_backends.load_all(app)
public_loader.load_all(app)
projects.init(app)

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")




@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    # External domain requests skip auth entirely — handled by domain_middleware
    host = request.headers.get("host", "").split(":")[0].lower()
    if not _is_local_host(host):
        return await call_next(request)

    public = {"/login", "/favicon.ico", "/api/auth/login-users"}
    path = request.url.path
    # Check if path is a registered subpath site
    with get_conn() as conn:
        subpath_rows = conn.execute("SELECT path FROM domains WHERE path IS NOT NULL").fetchall()
    for row in subpath_rows:
        prefix = row["path"].rstrip("/")
        if path == prefix or path.startswith(prefix + "/"):
            return await call_next(request)

    if path in public or path.startswith("/static") or path.startswith("/pub/") or path.endswith((".js", ".css", ".ico", ".png", ".svg", ".woff", ".woff2")):
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
    if _is_local_host(host):
        # Check subpath-mapped sites for mvmOS host
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
        return await call_next(request)

    # Block .py files always
    if request.url.path.endswith(".py"):
        return Response(status_code=404)

    # Look up domain mapping
    with get_conn() as conn:
        row = conn.execute("SELECT app_id FROM domains WHERE domain = ?", (host,)).fetchone()
    if not row:
        return Response("Domain not configured", status_code=404)

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
    return html


@app.get("/")
async def serve_index(request: Request):
    host = request.headers.get("host", "").split(":")[0].lower()
    if not _is_local_host(host):
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



app.mount("/apps", StaticFiles(directory=APPS_DIR), name="apps")
app.mount("/widgets", StaticFiles(directory=WIDGETS_DIR), name="widgets")
app.mount("/themes", StaticFiles(directory=THEMES_DIR), name="themes")
app.mount("/", _MvmStaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
