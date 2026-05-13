import os
import re
from fastapi import FastAPI, Request
from fastapi.responses import RedirectResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from .db import init_db
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
from .db import APPS_DIR, WIDGETS_DIR, THEMES_DIR

app = FastAPI(title="mvmOS")

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

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    public = {"/login", "/favicon.ico", "/api/auth/login-users"}
    path = request.url.path
    if path in public or path.startswith("/static") or path.endswith((".js", ".css", ".ico", ".png", ".svg", ".woff", ".woff2")):
        return await call_next(request)
    token = request.cookies.get("session")
    if not token:
        return RedirectResponse(url="/login")
    from .db import get_conn
    with get_conn() as conn:
        row = conn.execute("SELECT token FROM sessions WHERE token = ?", (token,)).fetchone()
    if not row:
        return RedirectResponse(url="/login")
    return await call_next(request)


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
async def serve_index():
    return HTMLResponse(_versioned_html())


app.mount("/apps", StaticFiles(directory=APPS_DIR), name="apps")
app.mount("/widgets", StaticFiles(directory=WIDGETS_DIR), name="widgets")
app.mount("/themes", StaticFiles(directory=THEMES_DIR), name="themes")
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
