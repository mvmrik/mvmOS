import os
import subprocess
import pwd as _pwd
import secrets
import time
from fastapi import APIRouter, Request, HTTPException, Depends
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from pydantic import BaseModel
from typing import Optional
from .db import get_conn

_MAX_ATTEMPTS = 5
_BLOCK_SECONDS = 15 * 60
_login_attempts: dict[str, list[float]] = {}  # ip -> [timestamps]

def _check_rate_limit(ip: str) -> int:
    """Returns seconds remaining if blocked, 0 if allowed."""
    now = time.time()
    times = _login_attempts.get(ip, [])
    times = [t for t in times if now - t < _BLOCK_SECONDS]
    _login_attempts[ip] = times
    if len(times) >= _MAX_ATTEMPTS:
        return int(_BLOCK_SECONDS - (now - times[0]))
    return 0

def _record_attempt(ip: str):
    _login_attempts.setdefault(ip, []).append(time.time())

def _clear_attempts(ip: str):
    _login_attempts.pop(ip, None)


_XDG_DIRS = ["Desktop", "Downloads", "Documents", "Music", "Pictures", "Videos", "Public", "Templates"]
_TRASH_DIRS = [".Trash", ".Trash/files", ".Trash/info"]

router = APIRouter()


def _init_user_xdg(username: str):
    try:
        import pwd as _pwd
        home = _pwd.getpwnam(username).pw_dir
        prefix = [] if os.geteuid() == 0 else ["sudo"]
        for d in _XDG_DIRS + _TRASH_DIRS:
            path = os.path.join(home, d)
            subprocess.run(prefix + ["runuser", "-u", username, "--", "mkdir", "-p", path],
                           capture_output=True)
    except Exception:
        pass


def get_current_session(request: Request):
    token = request.cookies.get("session")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    with get_conn() as conn:
        row = conn.execute("SELECT token, effective_user FROM sessions WHERE token = ?", (token,)).fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="Invalid session")
    return {"token": row["token"], "effective_user": row["effective_user"]}


def require_root_session(session=Depends(get_current_session)):
    """Dependency for actions that only the root mvmOS user may perform.

    These are operations on mvmOS itself / the host (service restart, self-update)
    that have no per-user equivalent — a non-root session must not be able to run
    them. Commands that DO have a per-user form should instead run via runuser as
    session['effective_user'] (see backend/terminal.py, backend/files.py)."""
    if session.get("effective_user") != "root":
        raise HTTPException(status_code=403, detail="Root privileges required")
    return session


def verify_linux_password(username: str, password: str) -> bool:
    try:
        import pam
        return pam.pam().authenticate(username, password)
    except Exception:
        return False


LOGIN_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>mvmOS &mdash; Login</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0f0f0f;color:#e0e0e0;font-family:'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;height:100vh}
  .card{background:#1a1a1a;border:1px solid #333;border-radius:10px;padding:2.2rem 2rem;width:360px;box-shadow:0 8px 32px #000a}
  h1{font-size:1.4rem;margin-bottom:.25rem;letter-spacing:.05em}
  p.sub{color:#666;font-size:.85rem;margin-bottom:1.6rem}
  .users{display:flex;flex-direction:column;gap:6px;margin-bottom:1.2rem}
  .user-btn{display:flex;align-items:center;gap:10px;background:#111;border:2px solid #333;border-radius:8px;padding:.6rem .9rem;cursor:pointer;transition:border-color .15s,background .15s;text-align:left;color:#e0e0e0;width:100%}
  .user-btn:hover{background:#1e1e1e;border-color:#555}
  .user-btn.active{border-color:#2a6ee0;background:#0d1a30}
  .user-avatar{width:36px;height:36px;border-radius:50%;background:#2a6ee0;display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0}
  .user-info{display:flex;flex-direction:column}
  .user-name{font-size:.92rem;font-weight:600}
  .user-uid{font-size:.72rem;color:#666}
  .pass-wrap{display:none;flex-direction:column;gap:.5rem;margin-bottom:1rem}
  .pass-wrap.show{display:flex}
  label{font-size:.8rem;color:#aaa}
  input{width:100%;background:#111;border:1px solid #333;border-radius:5px;color:#e0e0e0;padding:.5rem .75rem;font-size:.95rem;outline:none;transition:border-color .2s}
  input:focus{border-color:#2a6ee0}
  button.submit{width:100%;background:#2a6ee0;color:#fff;border:none;border-radius:5px;padding:.6rem;font-size:.95rem;cursor:pointer;transition:background .2s;display:none}
  button.submit.show{display:block}
  button.submit:hover{background:#1a5ec0}
  .error{color:#e05555;font-size:.83rem;margin-bottom:.7rem;display:none}
  .error.show{display:block}
  .other-link{margin-top:.8rem;font-size:.8rem;color:#555;text-align:center;cursor:pointer}
  .other-link:hover{color:#aaa}
</style>
</head>
<body>
<div class="card">
  <h1>mvmOS</h1>
  <p class="sub">Select your account</p>
  <div class="error" id="err"></div>
  <div class="users" id="user-list"></div>
  <div class="pass-wrap" id="pass-wrap">
    <label for="password">Password for <strong id="sel-name"></strong></label>
    <input id="password" type="password" autocomplete="current-password" placeholder="Enter password" autofocus>
  </div>
  <button class="submit" id="submit-btn">Sign in</button>
  <div class="other-link" id="other-link" style="display:none">← Choose a different user</div>
</div>
<script>
let selectedUser = null;

async function loadUsers() {
  const res = await fetch('/api/auth/login-users');
  const data = await res.json();
  const list = document.getElementById('user-list');
  const lastUser = data.last_user;

  data.users.forEach(u => {
    const btn = document.createElement('button');
    btn.className = 'user-btn';
    btn.dataset.username = u.username;
    btn.innerHTML = `
      <div class="user-avatar">👤</div>
      <div class="user-info">
        <span class="user-name">${u.username}</span>
        <span class="user-uid">uid: ${u.uid}</span>
      </div>`;
    btn.addEventListener('click', () => selectUser(u.username));
    list.appendChild(btn);
    if (u.username === lastUser) selectUser(u.username);
  });
}

function selectUser(username) {
  selectedUser = username;
  document.querySelectorAll('.user-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.username === username));
  document.getElementById('sel-name').textContent = username;
  document.getElementById('pass-wrap').classList.add('show');
  document.getElementById('submit-btn').classList.add('show');
  document.getElementById('other-link').style.display = 'block';
  document.getElementById('password').focus();
  document.getElementById('err').classList.remove('show');
}

document.getElementById('other-link').addEventListener('click', () => {
  selectedUser = null;
  document.querySelectorAll('.user-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('pass-wrap').classList.remove('show');
  document.getElementById('submit-btn').classList.remove('show');
  document.getElementById('other-link').style.display = 'none';
  document.getElementById('password').value = '';
});

async function doLogin() {
  if (!selectedUser) return;
  const password = document.getElementById('password').value;
  const err = document.getElementById('err');
  const res = await fetch('/login', {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: `username=${encodeURIComponent(selectedUser)}&password=${encodeURIComponent(password)}`,
    redirect: 'manual',
  });
  if (res.type === 'opaqueredirect' || res.status === 303 || res.ok) {
    window.location.href = '/';
  } else if (res.status === 429) {
    const msg = await res.text();
    err.textContent = msg;
    err.classList.add('show');
    document.getElementById('password').value = '';
    document.getElementById('submit-btn').disabled = true;
  } else {
    err.textContent = 'Invalid password. Please try again.';
    err.classList.add('show');
    document.getElementById('password').value = '';
    document.getElementById('password').focus();
  }
}

document.getElementById('submit-btn').addEventListener('click', doLogin);
document.getElementById('password').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
loadUsers();
</script>
</body>
</html>"""


@router.get("/login", response_class=HTMLResponse)
async def login_page():
    return LOGIN_HTML


def _login_users():
    nologin = {'/usr/sbin/nologin', '/sbin/nologin', '/bin/false', '/dev/null'}
    users = []
    for pw in _pwd.getpwall():
        if pw.pw_shell in nologin:
            continue
        if pw.pw_uid != 0 and pw.pw_uid < 500:
            continue
        users.append({"username": pw.pw_name, "uid": pw.pw_uid})
    return sorted(users, key=lambda u: u["uid"])


@router.get("/api/auth/login-users")
async def login_users():
    with get_conn() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key='last_login_user'").fetchone()
    last = row["value"] if row else None
    return JSONResponse({"users": _login_users(), "last_user": last})


@router.post("/login")
async def login(request: Request):
    ip = request.headers.get("X-Real-IP") or request.client.host
    wait = _check_rate_limit(ip)
    if wait > 0:
        mins = (wait + 59) // 60
        return HTMLResponse(content=f"Too many attempts. Try again in {mins} minute{'s' if mins != 1 else ''}.", status_code=429)

    form = await request.form()
    username = form.get("username", "")
    password = form.get("password", "")

    if not verify_linux_password(username, password):
        _record_attempt(ip)
        remaining = _MAX_ATTEMPTS - len(_login_attempts.get(ip, []))
        if remaining <= 0:
            return HTMLResponse(content=f"Too many attempts. Try again in 15 minutes.", status_code=429)
        return HTMLResponse(content="Unauthorized", status_code=401)

    _clear_attempts(ip)
    _init_user_xdg(username)
    token = secrets.token_hex(32)
    with get_conn() as conn:
        conn.execute("INSERT INTO sessions (token, effective_user) VALUES (?, ?)", (token, username))
        conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('last_login_user', ?)", (username,))

    resp = RedirectResponse(url="/", status_code=303)
    resp.set_cookie("session", token, httponly=True, samesite="lax", max_age=30*24*3600)
    return resp


@router.get("/api/auth/whoami")
async def whoami(session=Depends(get_current_session)):
    return JSONResponse({"effective_user": session["effective_user"]})


class VerifyRequest(BaseModel):
    password: str
    username: Optional[str] = None


@router.get("/api/auth/can-sudo")
async def can_sudo(session=Depends(get_current_session)):
    import grp
    username = session["effective_user"]
    if username == "root":
        return JSONResponse({"ok": True, "is_root": True})
    try:
        sudo_group = grp.getgrnam("sudo")
        if username in sudo_group.gr_mem:
            return JSONResponse({"ok": True})
    except KeyError:
        pass
    try:
        wheel_group = grp.getgrnam("wheel")
        if username in wheel_group.gr_mem:
            return JSONResponse({"ok": True})
    except KeyError:
        pass
    return JSONResponse({"ok": False})


@router.post("/api/auth/verify")
async def verify_password(body: VerifyRequest, request: Request, session=Depends(get_current_session)):
    ip = request.headers.get("X-Real-IP") or request.client.host
    wait = _check_rate_limit(ip)
    if wait > 0:
        mins = (wait + 59) // 60
        raise HTTPException(status_code=429, detail=f"Too many attempts. Try again in {mins} minute{'s' if mins != 1 else ''}.")
    username = body.username if body.username else session["effective_user"]
    if not verify_linux_password(username, body.password):
        _record_attempt(ip)
        raise HTTPException(status_code=403, detail="Wrong password")
    _clear_attempts(ip)
    return JSONResponse({"ok": True})


class SwitchUserRequest(BaseModel):
    username: str
    password: str


@router.post("/api/auth/switch")
async def switch_user(body: SwitchUserRequest, request: Request):
    token = request.cookies.get("session")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    if not verify_linux_password(body.username, body.password):
        raise HTTPException(status_code=403, detail="Invalid username or password")

    with get_conn() as conn:
        conn.execute("UPDATE sessions SET effective_user = ? WHERE token = ?", (body.username, token))

    return JSONResponse({"ok": True, "effective_user": body.username})


@router.post("/logout")
async def logout(request: Request):
    token = request.cookies.get("session")
    if token:
        with get_conn() as conn:
            conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
    resp = RedirectResponse(url="/login", status_code=303)
    resp.delete_cookie("session")
    return resp
