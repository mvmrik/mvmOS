import os
from fastapi import FastAPI, Request
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from .db import init_db
from .auth import router as auth_router, get_current_session
from .terminal import router as terminal_router
from .files import router as files_router
from .desktop import router as desktop_router
from .settings import router as settings_router

app = FastAPI(title="VirtualOS")

init_db()

app.include_router(auth_router)
app.include_router(terminal_router)
app.include_router(files_router)
app.include_router(desktop_router)
app.include_router(settings_router)

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    public = {"/login", "/favicon.ico"}
    if request.url.path in public or request.url.path.startswith("/static"):
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


app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
