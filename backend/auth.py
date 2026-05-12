import secrets
from fastapi import APIRouter, Request, Response, HTTPException, Depends
from fastapi.responses import HTMLResponse, RedirectResponse
from passlib.hash import bcrypt
from .db import get_conn, load_config

router = APIRouter()


def get_current_session(request: Request):
    token = request.cookies.get("session")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    with get_conn() as conn:
        row = conn.execute("SELECT token FROM sessions WHERE token = ?", (token,)).fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="Invalid session")
    return token


LOGIN_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>VirtualOS &mdash; Login</title>
<style>
  *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{
    background: #0f0f0f;
    color: #e0e0e0;
    font-family: 'Segoe UI', sans-serif;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
  }}
  .card {{
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 8px;
    padding: 2.5rem 2rem;
    width: 340px;
    box-shadow: 0 8px 32px #000a;
  }}
  h1 {{ font-size: 1.4rem; margin-bottom: 0.3rem; letter-spacing: 0.05em; }}
  p.sub {{ color: #666; font-size: 0.85rem; margin-bottom: 1.8rem; }}
  label {{ display: block; font-size: 0.8rem; color: #aaa; margin-bottom: 0.3rem; }}
  input {{
    width: 100%;
    background: #111;
    border: 1px solid #333;
    border-radius: 4px;
    color: #e0e0e0;
    padding: 0.55rem 0.75rem;
    font-size: 0.95rem;
    margin-bottom: 1rem;
    outline: none;
    transition: border-color 0.2s;
  }}
  input:focus {{ border-color: #555; }}
  button {{
    width: 100%;
    background: #2a6ee0;
    color: #fff;
    border: none;
    border-radius: 4px;
    padding: 0.65rem;
    font-size: 1rem;
    cursor: pointer;
    transition: background 0.2s;
  }}
  button:hover {{ background: #1a5ec0; }}
  .error {{ color: #e05555; font-size: 0.85rem; margin-bottom: 0.8rem; }}
</style>
</head>
<body>
<div class="card">
  <h1>VirtualOS</h1>
  <p class="sub">Sign in to continue</p>
  {error}
  <form method="POST" action="/login">
    <label for="username">Username</label>
    <input id="username" name="username" type="text" autocomplete="username" required autofocus>
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required>
    <button type="submit">Sign in</button>
  </form>
</div>
</body>
</html>"""


@router.get("/login", response_class=HTMLResponse)
async def login_page():
    return LOGIN_HTML.format(error="")


@router.post("/login")
async def login(request: Request, response: Response):
    form = await request.form()
    username = form.get("username", "")
    password = form.get("password", "")

    cfg = load_config()
    expected_user = cfg.get("auth", "username", fallback="admin")
    expected_hash = cfg.get("auth", "password_hash", fallback="")

    if username != expected_user or not bcrypt.verify(password, expected_hash):
        html = LOGIN_HTML.format(error='<p class="error">Invalid username or password.</p>')
        return HTMLResponse(content=html, status_code=401)

    token = secrets.token_hex(32)
    with get_conn() as conn:
        conn.execute("INSERT INTO sessions (token) VALUES (?)", (token,))

    resp = RedirectResponse(url="/", status_code=303)
    resp.set_cookie("session", token, httponly=True, samesite="lax")
    return resp


@router.post("/logout")
async def logout(request: Request):
    token = request.cookies.get("session")
    if token:
        with get_conn() as conn:
            conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
    resp = RedirectResponse(url="/login", status_code=303)
    resp.delete_cookie("session")
    return resp
