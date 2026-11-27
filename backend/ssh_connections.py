"""Outgoing SSH connections that mvmOS itself manages.

Each connection owns a private key that mvmOS creates, a private known-hosts file
and a weekly schedule. Nothing in the system ``~/.ssh`` is read or written. A
connection shows up as a shared folder (``file_remote_folders`` with the origin
``self``) and is served by the same shared-folder protocol, so File Manager, the
file picker and every app use it like any other shared folder. While the
connection is disabled or outside its schedule every request is refused here.
"""
import base64
import json
import os
import re
import secrets
import shlex
import shutil
import sqlite3
import socket
import subprocess
import threading
import time
import hashlib
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .auth import get_current_session
from .db import get_conn
from .shared_files_worker import parts as relative_parts
from .ssh_access import _is_admin, _is_allowed, _validate_schedule, _verify_actor

router = APIRouter(prefix="/api/ssh-connections", tags=["ssh-connections"])

KEYS_DIR = Path(__file__).with_name("ssh_keys")
SELF_ORIGIN = "self"
_ALL = ["read", "upload", "edit", "delete"]
_HOST_RE = re.compile(r"^[A-Za-z0-9]([A-Za-z0-9.\-:\[\]]*[A-Za-z0-9\]])?$")
_USER_RE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.\-]{0,63}$")


def init_db():
    with get_conn() as c:
        c.execute("""
            CREATE TABLE IF NOT EXISTS ssh_connections (
                id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL,
                host TEXT NOT NULL, port INTEGER NOT NULL DEFAULT 22, username TEXT NOT NULL,
                base_path TEXT NOT NULL DEFAULT '', public_key TEXT NOT NULL,
                token_hash TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
                days TEXT NOT NULL DEFAULT '0,1,2,3,4,5,6',
                start_time TEXT NOT NULL DEFAULT '00:00', end_time TEXT NOT NULL DEFAULT '24:00',
                created REAL NOT NULL)""")


# ── Keys and the ssh command ────────────────────────────────────────────────

def _key_file(cid):
    return KEYS_DIR / cid


def _known_file(cid):
    return KEYS_DIR / (cid + ".known_hosts")


def _control_path(cid):
    return KEYS_DIR / ("c-" + cid[:12])


def _generate_key(cid, comment):
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    KEYS_DIR.mkdir(mode=0o700, exist_ok=True)
    os.chmod(KEYS_DIR, 0o700)
    key = Ed25519PrivateKey.generate()
    private = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.OpenSSH,
                                serialization.NoEncryption())
    public = key.public_key().public_bytes(serialization.Encoding.OpenSSH, serialization.PublicFormat.OpenSSH).decode()
    fd = os.open(_key_file(cid), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(private)
    return public + " " + comment


def _ssh_base(row):
    if not shutil.which("ssh"):
        raise HTTPException(501, "The ssh program is not installed on this server")
    cid = row["id"]
    return ["ssh", "-i", str(_key_file(cid)), "-p", str(row["port"]), "-l", row["username"],
            "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o", "PasswordAuthentication=no",
            "-o", "UserKnownHostsFile=" + str(_known_file(cid)), "-o", "StrictHostKeyChecking=accept-new",
            "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=15", "-o", "LogLevel=ERROR",
            "-o", "ControlMaster=auto", "-o", "ControlPath=" + str(_control_path(cid)), "-o", "ControlPersist=60",
            "-o", "ForwardAgent=no", "-o", "ForwardX11=no", "-o", "ClearAllForwardings=yes",
            "--", row["host"]]


def _remote(row, script, *args):
    """The ssh command that runs ``script`` with ``args`` on the other computer."""
    quoted = " ".join(shlex.quote(a) for a in ("sh", "-c", script, "sh", *args))
    return _ssh_base(row) + [quoted]


def _close_master(cid):
    ctl = _control_path(cid)
    if ctl.exists() and shutil.which("ssh"):
        subprocess.run(["ssh", "-o", "ControlPath=" + str(ctl), "-O", "exit", "x"],
                       capture_output=True, timeout=10)


def _error(stderr):
    text = (stderr or b"").decode("utf-8", "replace").strip().splitlines()
    return (text[-1] if text else "The connection failed")[:300]


# ── Access rules ────────────────────────────────────────────────────────────

def _load(cid):
    with get_conn() as c:
        row = c.execute("SELECT * FROM ssh_connections WHERE id=?", (cid,)).fetchone()
    return dict(row) if row else None


def allowed_now(row, now=None):
    return _is_allowed(row, now or datetime.now())


def grant(grant_id):
    """The shared-folder row of a connection, or None when this id is not one.
    Raises 403 while the connection is disabled or outside its hours."""
    row = _load(grant_id)
    if not row:
        return None
    if not allowed_now(row):
        raise HTTPException(403, "This SSH connection is not allowed at the moment")
    return {"id": row["id"], "owner": row["owner"], "name": row["name"], "root": row["base_path"],
            "device": None, "inode": None, "recipient": "", "permissions": json.dumps(_ALL),
            "token_hash": row["token_hash"], "kind": "ssh", "ssh": row}


def close_unallowed(now=None):
    """Called every minute: drop open links of connections that must be closed."""
    now = now or datetime.now()
    with get_conn() as c:
        rows = [dict(r) for r in c.execute("SELECT * FROM ssh_connections")]
    for row in rows:
        if not _is_allowed(row, now):
            try:
                _close_master(row["id"])
            except Exception:
                pass


# ── Port forwarding for apps (database tunnels) ─────────────────────────────

_tunnel_lock = threading.Lock()
_tunnels = {}  # (connection id, host, port) -> local port


def _master_alive(cid):
    ctl = _control_path(cid)
    if not ctl.exists():
        return False
    r = subprocess.run(["ssh", "-o", "ControlPath=" + str(ctl), "-O", "check", "x"], capture_output=True, timeout=10)
    return r.returncode == 0


def _port_open(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=2):
            return True
    except OSError:
        return False


def tunnel(cid, owner, host, port):
    """Local port on 127.0.0.1 that reaches ``host:port`` as seen from the other computer.

    Uses the connection's own link, so the connection's switch and weekly schedule
    apply: while it is not allowed this raises 403 and the link (with its forwards)
    is closed by ``close_unallowed``. Only the connection's owner may use it."""
    row = _load(cid)
    if not row or row["owner"] != owner:
        raise HTTPException(404, "SSH connection not found")
    if not allowed_now(row):
        raise HTTPException(403, "This SSH connection is not allowed at the moment")
    if not _HOST_RE.match(str(host or "")) or not isinstance(port, int) or not 0 < port < 65536:
        raise HTTPException(400, "Invalid database address")
    key = (cid, host, port)
    with _tunnel_lock:
        local = _tunnels.get(key)
        if local and _master_alive(cid) and _port_open(local):
            return local
        _tunnels.pop(key, None)
        if not _master_alive(cid):
            # Starts the shared link; ControlPersist keeps it in the background.
            work({"ssh": row}, "probe")
        ctl = _control_path(cid)
        with socket.socket() as probe_sock:
            probe_sock.bind(("127.0.0.1", 0))
            local = probe_sock.getsockname()[1]
        spec = "127.0.0.1:%d:%s:%d" % (local, host, port)
        try:
            r = subprocess.run(["ssh", "-o", "ControlPath=" + str(ctl), "-O", "forward", "-L", spec, "x"],
                               capture_output=True, timeout=15)
        except subprocess.TimeoutExpired:
            raise HTTPException(504, "The SSH tunnel timed out")
        if r.returncode:
            raise HTTPException(400, _error(r.stderr) if r.stderr else "The server does not allow port forwarding")
        _tunnels[key] = local
        return local


# ── Filesystem operations on the other computer ─────────────────────────────

_CD = ('R=$1; [ -n "$R" ] || R=$HOME; cd -- "$R" 2>/dev/null || { echo "The folder does not exist" >&2; exit 1; }; ')
_SCRIPTS = {
    "probe": _CD + 'ls >/dev/null 2>&1 || { echo "Permission denied" >&2; exit 1; }; echo mvmos-ok',
    "list": _CD + 'cd -- "${2:-.}" 2>/dev/null || { echo "The folder does not exist" >&2; exit 1; }; '
                  "find -L . -mindepth 1 -maxdepth 1 \\( -type f -o -type d \\) -printf '%y\\t%s\\t%T@\\t%f\\0'; exit 0",
    "stat": _CD + '[ -f "$2" ] || { echo "Not a regular file" >&2; exit 1; }; stat -L -c "%s %Y" -- "$2"',
    "read": _CD + '[ -f "$2" ] || { echo "Not a regular file" >&2; exit 1; }; tail -c +"$3" -- "$2" | head -c "$4"',
    "mkdir": _CD + 'mkdir -- "$2"',
    "delete": _CD + 'if [ -L "$2" ]; then echo "Symlinks cannot be modified" >&2; exit 1; '
                    'elif [ -d "$2" ]; then rmdir -- "$2"; elif [ -f "$2" ]; then rm -- "$2"; '
                    'else echo "Not found" >&2; exit 1; fi',
    "rename": _CD + 'd=$(dirname -- "$2"); [ -L "$2" ] && { echo "Symlinks cannot be modified" >&2; exit 1; }; '
                    '[ -e "$d/$3" ] && { echo "The name already exists" >&2; exit 1; }; mv -n -- "$2" "$d/$3"',
    "upload": _CD + 't="$3"; if [ "$4" = 0 ]; then (set -C; : > "$t") 2>/dev/null || { echo "Upload already in progress" >&2; exit 1; }; '
                    'else [ -f "$t" ] && [ "$(wc -c < "$t")" -eq "$4" ] || { echo "Upload offset mismatch" >&2; exit 1; }; fi; '
                    'cat >> "$t" || exit 1; if [ "$5" = 1 ]; then '
                    'if [ "$6" = 1 ]; then if [ -f "$2" ] && [ ! -L "$2" ]; then chmod --reference="$2" "$t" 2>/dev/null; '
                    'mv -f -- "$t" "$2" || { rm -f "$t"; exit 1; }; else rm -f "$t"; echo "Only regular files can be replaced" >&2; exit 1; fi; '
                    'else chmod 644 "$t"; '
                    'if ln "$t" "$2" 2>/dev/null; then rm -f "$t"; else rm -f "$t"; echo "The file already exists" >&2; exit 1; fi; fi; fi',
    "cancel": _CD + 'rm -f -- "$2"',
}


def _rel(path):
    try:
        names = relative_parts(path or "")
    except ValueError:
        raise HTTPException(400, "Invalid relative path")
    return "/".join(names) if names else "."


def _run(row, op, *args, data=None, timeout=30):
    ssh = row["ssh"]
    command = _remote(ssh, _SCRIPTS[op], ssh["base_path"], *args)
    try:
        r = subprocess.run(command, input=data, capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise HTTPException(504, "Filesystem operation timed out")
    if r.returncode:
        raise HTTPException(400, _error(r.stderr))
    return r.stdout


def work(row, op, **params):
    if op == "probe":
        if b"mvmos-ok" not in _run(row, "probe"):
            raise HTTPException(400, "The server did not run the command: shell access may be disabled for this account")
        return {"device": 0, "inode": 0}
    if op == "list":
        out = _run(row, "list", _rel(params.get("path", "")))
        entries = []
        for item in out.split(b"\0"):
            if not item:
                continue
            parts = item.decode("utf-8", "replace").split("\t", 3)
            if len(parts) != 4:
                raise HTTPException(400, "Unexpected answer from the server: " + item.decode("utf-8", "replace").strip()[:200])
            kind, size, modified, name = parts
            if name.startswith(".mvmos-share-upload-"):
                continue
            entries.append({"name": name, "type": "dir" if kind == "d" else "file", "size": int(size or 0),
                            "modified": datetime.fromtimestamp(float(modified)).isoformat()})
            if len(entries) > 10000:
                raise HTTPException(400, "Folder contains more than 10000 entries")
        entries.sort(key=lambda e: e["name"])
        return {"entries": entries}
    path = params.get("path", "")
    if not path:
        raise HTTPException(400, "The shared root cannot be modified or downloaded")
    rel = _rel(path)
    if op == "stat":
        size, modified = _run(row, "stat", rel).decode().split()
        return {"size": int(size), "modified": float(modified)}
    if op in ("mkdir", "delete"):
        _run(row, op, rel)
        return {"ok": True}
    if op == "rename":
        new = relative_parts(params.get("new_name", ""))
        if len(new) != 1:
            raise HTTPException(400, "Invalid name")
        _run(row, "rename", rel, new[0])
        return {"ok": True}
    if op in ("upload", "cancel"):
        upload_id = params["upload_id"]
        if len(upload_id) != 32 or any(ch not in "0123456789abcdef" for ch in upload_id):
            raise HTTPException(400, "Invalid upload")
        directory = rel.rsplit("/", 1)[0] + "/" if "/" in rel else ""
        temp = directory + ".mvmos-share-upload-" + upload_id
        if op == "cancel":
            _run(row, "cancel", temp)
            return {"ok": True}
        _run(row, "upload", rel, temp, str(params["offset"]), "1" if params["final"] else "0",
             "1" if params.get("replace") else "0",
             data=base64.b64decode(params["data"], validate=True), timeout=120)
        return {"ok": True}
    raise HTTPException(400, "Unknown operation")


def read_stream(row, path, offset, length):
    """Yield ``length`` bytes of a remote file; stops when the connection is no longer allowed."""
    ssh = row["ssh"]
    command = _remote(ssh, _SCRIPTS["read"], ssh["base_path"], _rel(path), str(int(offset) + 1), str(int(length)))
    proc = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    try:
        while True:
            chunk = proc.stdout.read(1024 * 1024)
            if not chunk:
                break
            current = _load(ssh["id"])
            if not current or not allowed_now(current):
                break
            yield chunk
    finally:
        proc.stdout.close()
        if proc.poll() is None:
            proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()


# ── Settings API ────────────────────────────────────────────────────────────

class ConnectionBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    host: str = Field(min_length=1, max_length=253)
    port: int = Field(default=22, ge=1, le=65535)
    username: str = Field(min_length=1, max_length=64)
    base_path: str = Field(default="", max_length=1024)
    enabled: bool = True
    days: list[int] = [0, 1, 2, 3, 4, 5, 6]
    start_time: str = "00:00"
    end_time: str = "24:00"
    password: str


class DeleteBody(BaseModel):
    password: str


def _validate(body):
    if not _HOST_RE.match(body.host.strip()) or body.host.strip().startswith("-"):
        raise HTTPException(400, "Invalid server address")
    if not _USER_RE.match(body.username.strip()):
        raise HTTPException(400, "Invalid user name")
    base = body.base_path.strip()
    if base and (not base.startswith("/") or "\0" in base or any(p == ".." for p in base.split("/"))):
        raise HTTPException(400, "The start folder must be an absolute path")
    _validate_schedule(body)
    return body.host.strip(), body.username.strip(), base.rstrip("/") if base != "/" else base


def _public(row, now):
    return {"id": row["id"], "name": row["name"], "host": row["host"], "port": row["port"],
            "username": row["username"], "base_path": row["base_path"], "public_key": row["public_key"],
            "enabled": bool(row["enabled"]), "days": [int(d) for d in row["days"].split(",") if d],
            "start_time": row["start_time"], "end_time": row["end_time"],
            "active_now": _is_allowed(row, now), "created": row["created"]}


def _owner(session):
    user = session.get("effective_user", "")
    if not user:
        raise HTTPException(401, "Invalid session")
    return user


def _own(cid, session):
    row = _load(cid)
    if not row or row["owner"] != _owner(session):
        raise HTTPException(404, "Connection not found")
    return row


@router.get("")
async def list_connections(session=Depends(get_current_session)):
    owner = _owner(session)
    now = datetime.now()
    with get_conn() as c:
        rows = [dict(r) for r in c.execute("SELECT * FROM ssh_connections WHERE owner=? ORDER BY created DESC", (owner,))]
    return JSONResponse({"connections": [_public(r, now) for r in rows], "can_admin": _is_admin(owner),
                         "available": bool(shutil.which("ssh"))},
                        headers={"Cache-Control": "private, no-store"})


@router.post("")
async def create_connection(body: ConnectionBody, session=Depends(get_current_session)):
    owner = _verify_actor(body.password, session)
    if not _is_admin(owner):
        raise HTTPException(403, "Administrator rights are required")
    host, username, base = _validate(body)
    cid = secrets.token_hex(16)
    public = _generate_key(cid, "mvmos-" + body.name.strip().replace(" ", "_")[:40])
    secret = secrets.token_urlsafe(32)
    try:
        with get_conn() as c:
            c.execute("INSERT INTO ssh_connections VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                      (cid, owner, body.name.strip(), host, body.port, username, base, public,
                       hashlib.sha256(secret.encode()).hexdigest(), int(body.enabled),
                       ",".join(map(str, sorted(set(body.days)))), body.start_time, body.end_time, time.time()))
            c.execute("INSERT INTO file_remote_folders VALUES (?,?,?,?,?,?,?)",
                      (secrets.token_hex(16), owner, body.name.strip(), SELF_ORIGIN, cid, secret, time.time()))
    except Exception:
        _key_file(cid).unlink(missing_ok=True)
        raise
    return _public(_load(cid), datetime.now())


@router.put("/{cid}")
async def update_connection(cid: str, body: ConnectionBody, session=Depends(get_current_session)):
    _verify_actor(body.password, session)
    row = _own(cid, session)
    host, username, base = _validate(body)
    with get_conn() as c:
        c.execute("UPDATE ssh_connections SET name=?,host=?,port=?,username=?,base_path=?,enabled=?,days=?,start_time=?,end_time=? WHERE id=?",
                  (body.name.strip(), host, body.port, username, base, int(body.enabled),
                   ",".join(map(str, sorted(set(body.days)))), body.start_time, body.end_time, cid))
        c.execute("UPDATE file_remote_folders SET name=? WHERE origin=? AND grant_id=?", (body.name.strip(), SELF_ORIGIN, cid))
    if (host, body.port, username) != (row["host"], row["port"], row["username"]):
        _known_file(cid).unlink(missing_ok=True)
    _close_master(cid)
    return _public(_load(cid), datetime.now())


@router.delete("/{cid}")
async def delete_connection(cid: str, body: DeleteBody, session=Depends(get_current_session)):
    _verify_actor(body.password, session)
    _own(cid, session)
    # The rows go first so no new request can use the connection while files are removed.
    with get_conn() as c:
        c.execute("DELETE FROM ssh_connections WHERE id=?", (cid,))
        c.execute("DELETE FROM file_remote_folders WHERE origin=? AND grant_id=?", (SELF_ORIGIN, cid))
        c.execute("DELETE FROM file_remote_uploads WHERE grant_id=?", (cid,))
    try:
        _close_master(cid)
    except Exception:
        pass
    for path in (_key_file(cid), _known_file(cid)):
        path.unlink(missing_ok=True)
    return {"ok": True}


@router.post("/{cid}/test")
def test_connection(cid: str, session=Depends(get_current_session)):
    row = _own(cid, session)
    now = datetime.now()
    if not _is_allowed(row, now):
        return {"ok": False, "error": "not_allowed"}
    try:
        work({"ssh": row}, "probe")
    except HTTPException as exc:
        return {"ok": False, "error": str(exc.detail)}
    return {"ok": True}
