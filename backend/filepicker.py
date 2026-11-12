"""Server side of the shared file picker (frontend/file-picker.js).

The picker only lets a person choose. Whatever an app accepts from it must be
checked again here, because a browser can send any path. Apps load this module
with ``sys.modules["backend.filepicker"]`` and call the helpers below with the
desktop session of the person who chose the files:

* ``resolve_server_path`` turns a chosen path into a real path that stays
  inside the roots the app allows, or refuses it.
* ``copy_server_file`` / ``read_server_chunks`` read the file as that Linux
  user, so the picker can never reach more than File Manager could.
* ``shared_file_url`` returns a short-lived direct link to a file in a folder
  shared from another mvmOS. The bytes then flow from that server to the
  listener's browser; this server only signs the link and never fetches it.
"""
import os
import subprocess

from fastapi import HTTPException

from . import shared_files
from .db import get_conn
from .files import home_for, run_as

_CHUNK = 1024 * 1024


def _user(session):
    # Apps never inherit a temporary administrator key from File Manager.
    return session["effective_user"]


def expand_roots(session, roots=None):
    """Real paths of the allowed roots; ``~`` is the person's home folder."""
    home = home_for(_user(session))
    result = []
    for root in roots or ["~"]:
        root = home if root == "~" else (os.path.join(home, root[2:]) if root.startswith("~/") else root)
        if not os.path.isabs(root):
            raise ValueError("Roots must be absolute paths")
        result.append(os.path.realpath(root))
    return result


def resolve_server_path(session, path, roots=None, *, kind="file", extensions=None, max_bytes=None):
    """Return the real path of a chosen file or folder, or raise 400/403/404.

    The check is made on the resolved path, so a symlink inside an allowed root
    that leads elsewhere is refused. ``kind`` is ``file`` or ``dir``.
    """
    if not isinstance(path, str) or not path or "\0" in path or not os.path.isabs(path):
        raise HTTPException(400, "Invalid path")
    real = os.path.realpath(path)
    allowed = expand_roots(session, roots)
    if not any(real == r or real.startswith(r.rstrip("/") + "/") for r in allowed):
        raise HTTPException(403, "This location is not allowed here")
    user = _user(session)
    if run_as(user, ["test", "-d" if kind == "dir" else "-f", real]).returncode != 0:
        raise HTTPException(404, "Not found")
    # Existing is not enough: the signed-in user must be able to read it.
    readable = ["test", "-r", real] if kind == "file" else ["test", "-r", real, "-a", "-x", real]
    if run_as(user, readable).returncode != 0:
        raise HTTPException(403, "Permission denied")
    if kind == "file":
        if extensions and os.path.splitext(real)[1].lower() not in {e.lower() for e in extensions}:
            raise HTTPException(400, "This file type is not allowed here")
        size = server_file_size(session, real)
        if max_bytes and size > max_bytes:
            raise HTTPException(413, "The file is too large")
    return real


def server_file_size(session, real):
    r = run_as(_user(session), ["stat", "-c", "%s", real])
    if r.returncode != 0:
        raise HTTPException(403, "Permission denied")
    return int(r.stdout.strip())


def read_server_chunks(session, real, chunk=_CHUNK):
    """Yield the bytes of a file read as the session's Linux user."""
    user = _user(session)
    cmd = ["cat", real]
    if user != "root":
        cmd = ([] if os.geteuid() == 0 else ["sudo"]) + ["runuser", "-u", user, "--"] + cmd
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    try:
        while True:
            part = proc.stdout.read(chunk)
            if not part:
                break
            yield part
        if proc.wait() != 0:
            raise HTTPException(403, "Permission denied")
    finally:
        proc.stdout.close()
        if proc.poll() is None:
            proc.terminate()
        proc.wait()


def copy_server_file(session, real, destination, max_bytes=None):
    """Copy a resolved file to ``destination`` (a new file) and return its size."""
    total = 0
    with open(destination, "xb") as out:
        for part in read_server_chunks(session, real):
            total += len(part)
            if max_bytes and total > max_bytes:
                raise HTTPException(413, "The file is too large")
            out.write(part)
    return total


def shared_folder(session, folder_id):
    """The connected shared folder (without its key) that belongs to this person."""
    with get_conn() as c:
        row = c.execute("SELECT id,name,origin,grant_id FROM file_remote_folders WHERE id=? AND owner=?",
                        (folder_id, _user(session))).fetchone()
    if not row:
        raise HTTPException(404, "Shared folder not found")
    return dict(row)


def shared_file_url(owner, folder_id, path, ttl=3600):
    """Short-lived direct URL of a file in a shared folder that ``owner`` connected."""
    import hashlib
    try:
        shared_files.relative_parts(path)
    except ValueError:
        raise HTTPException(400, "Invalid relative path")
    with get_conn() as c:
        row = c.execute("SELECT origin,grant_id,secret FROM file_remote_folders WHERE id=? AND owner=?",
                        (folder_id, owner)).fetchone()
    if not row:
        raise HTTPException(404, "Shared folder is no longer connected")
    from urllib.parse import quote
    ticket = shared_files.sign_ticket(hashlib.sha256(row["secret"].encode()).hexdigest(), path, ttl)
    return f"{row['origin']}{shared_files.PREFIX}/{row['grant_id']}/file?ticket={quote(ticket, safe='')}"


# ── Reading a whole folder in place (a library of files that stay where they are) ──
#
# An app that keeps a library does not copy files: it remembers the folder and
# the Linux user who added it, and acts as that user whenever it lists, reads or
# writes beside a file. ``root`` and ``real`` must already be resolved with
# ``resolve_server_path``; every call below checks again that the path is still
# inside the folder, so a later symlink swap cannot lead out of it.

def _inside(real, root):
    root = os.path.realpath(root).rstrip("/")
    return real == root or real.startswith(root + "/")


def folder_files(user, root, extensions=None, limit=50000):
    """Regular files under ``root`` as the Linux ``user`` sees them.

    Symlinks are not followed. Returns ``[{"rel", "size", "mtime"}]`` with ``rel``
    relative to ``root`` (``/`` separated), or raises 403/404 when ``root`` is
    not readable. ``extensions`` filters by lower-case suffix, e.g. ``{".mp4"}``.
    """
    root = os.path.realpath(root)
    if run_as(user, ["test", "-d", root, "-a", "-r", root, "-a", "-x", root]).returncode != 0:
        raise HTTPException(403, "The folder cannot be read")
    parts = run_as_bytes(user, ["find", root, "-type", "f", "-printf", "%P\\0%s\\0%T@\\0"]).split(b"\0")
    wanted = {e.lower() for e in extensions} if extensions else None
    out = []
    for i in range(0, len(parts) - 2, 3):
        rel = parts[i].decode("utf-8", "replace")
        if wanted is not None and os.path.splitext(rel)[1].lower() not in wanted:
            continue
        try:
            out.append({"rel": rel, "size": int(parts[i + 1]), "mtime": float(parts[i + 2])})
        except ValueError:
            continue
        if len(out) >= limit:
            break
    return out


def run_as_bytes(user, cmd):
    """Stdout of a command run as ``user``; empty when it fails."""
    prefix = [] if os.geteuid() == 0 else ["sudo"]
    r = subprocess.run(prefix + ["runuser", "-u", user, "--"] + cmd, capture_output=True)
    return r.stdout if r.returncode == 0 else b""


def server_file_info(user, root, rel):
    """``(real_path, size)`` of a file inside ``root``, or raises 403/404."""
    real = os.path.realpath(os.path.join(os.path.realpath(root), rel))
    if not _inside(real, root) or real == os.path.realpath(root):
        raise HTTPException(403, "This location is not allowed here")
    r = run_as(user, ["stat", "-c", "%s", real])
    if r.returncode != 0:
        raise HTTPException(404, "Not found")
    return real, int(r.stdout.strip())


def open_server_file(user, root, rel):
    """Open a file inside ``root`` for reading and return ``(file, size)``.

    The Linux ``user`` must be able to read it. The file is opened without
    following a symlink in the last part and checked again after opening, so
    the path cannot be swapped to lead out of ``root`` between check and read.
    The caller closes it. Seeking works, which is what streaming with ranges
    and reading a container's subtitle tracks need.
    """
    real, _size = server_file_info(user, root, rel)
    if run_as(user, ["test", "-r", real]).returncode != 0:
        raise HTTPException(403, "Permission denied")
    import contextlib
    import sys
    isolation = sys.modules.get("backend.app_isolation")
    with (isolation.release() if isolation else contextlib.nullcontext()):
        fd = os.open(real, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        if not _inside(os.path.realpath("/proc/self/fd/%d" % fd), root):
            raise HTTPException(403, "This location is not allowed here")
        f = os.fdopen(fd, "rb")
    except BaseException:
        os.close(fd)
        raise
    return f, os.fstat(f.fileno()).st_size


def write_beside(user, root, rel, data):
    """Write ``data`` (bytes) to ``root/rel`` as ``user`` through a temporary file.

    Returns the real path written, or ``None`` when the folder does not allow
    that user to write (the caller then keeps its own copy).
    """
    real = os.path.realpath(os.path.join(os.path.realpath(root), rel))
    if not _inside(real, root):
        return None
    folder = os.path.dirname(real)
    if run_as(user, ["test", "-w", folder]).returncode != 0:
        return None
    tmp = real + ".part"
    prefix = [] if os.geteuid() == 0 else ["sudo"]
    r = subprocess.run(prefix + ["runuser", "-u", user, "--", "tee", tmp], input=data, capture_output=True)
    if r.returncode != 0 or run_as(user, ["mv", "-f", tmp, real]).returncode != 0:
        run_as(user, ["rm", "-f", tmp])
        return None
    return real


# ── The same for a folder shared from another mvmOS ──────────────────
#
# The folder is connected by ``owner`` (Files app). An app that keeps a library
# remembers ``(owner, folder_id)``; whenever it lists, reads or writes beside a
# file it asks the sharing server with the key this server already holds, so the
# app never sees the key. The video itself is never fetched here: playing uses
# ``shared_file_url`` and the bytes flow from the sharing server.

# Cloudflare in front of the sharing server rejects Python's default agent (error 1010).
_USER_AGENT = "mvmOS-shared-files/1.0"


def _shared_row(owner, folder_id):
    with get_conn() as c:
        row = c.execute("SELECT origin,grant_id,secret,name FROM file_remote_folders WHERE id=? AND owner=?",
                        (folder_id, owner)).fetchone()
    if not row:
        raise HTTPException(404, "Shared folder is no longer connected")
    return dict(row)


def _shared_call(row, suffix, method="GET", payload=None, headers=None, timeout=30):
    import json
    import urllib.error
    import urllib.request
    url = f"{row['origin']}{shared_files.PREFIX}/{row['grant_id']}{suffix}"
    data = None if payload is None else (payload if isinstance(payload, bytes) else json.dumps(payload).encode())
    req = urllib.request.Request(url, data=data, method=method, headers={
        "User-Agent": _USER_AGENT, "Authorization": "Bearer " + row["secret"], **({"Content-Type": "application/json"} if isinstance(payload, dict) else {}),
        **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        raise HTTPException(403 if e.code in (401, 403) else 502, "The shared folder refused this")
    except (urllib.error.URLError, TimeoutError, OSError):
        raise HTTPException(502, "The sharing server cannot be reached")


def shared_listing(owner, folder_id, path=""):
    """``(entries, permissions)`` of one folder of a shared folder."""
    import json
    from urllib.parse import quote
    row = _shared_row(owner, folder_id)
    data = json.loads(_shared_call(row, "/list?path=" + quote(path, safe="")))
    if not isinstance(data.get("entries"), list) or not isinstance(data.get("permissions"), list):
        raise HTTPException(502, "Unexpected answer from the sharing server")
    return data["entries"], data["permissions"]


def shared_folder_files(owner, folder_id, base="", extensions=None, limit=50000, max_depth=12):
    """Files below ``base`` of a shared folder: ``[{"rel","size","mtime"}]``, ``rel`` relative to ``base``."""
    import datetime
    wanted = {e.lower() for e in extensions} if extensions else None
    out, queue = [], [("", 0)]
    first = True
    while queue and len(out) < limit:
        rel, depth = queue.pop(0)
        entries, permissions = shared_listing(owner, folder_id, "/".join(x for x in (base, rel) if x))
        if first and "read" not in permissions:
            raise HTTPException(403, "This shared folder does not allow reading")
        first = False
        for e in entries:
            name = e.get("name") if isinstance(e, dict) else None
            if not isinstance(name, str) or not name or "/" in name or name in (".", ".."):
                continue
            child = f"{rel}/{name}" if rel else name
            if e.get("type") == "dir":
                if depth < max_depth:
                    queue.append((child, depth + 1))
            elif e.get("type") == "file" and (wanted is None or os.path.splitext(name)[1].lower() in wanted):
                try:
                    mtime = datetime.datetime.fromisoformat(str(e.get("modified"))).timestamp()
                except ValueError:
                    mtime = 0.0
                out.append({"rel": child, "size": int(e.get("size") or 0), "mtime": mtime})
    return out


def shared_read_head(owner, folder_id, path, max_bytes=5 * 1024 ** 2):
    """The first ``max_bytes`` of a small file (e.g. a subtitle) of a shared folder."""
    import urllib.request
    url = shared_file_url(owner, folder_id, path, ttl=120)
    req = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT, "Range": "bytes=0-%d" % (max_bytes - 1)})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.read(max_bytes)
    except Exception:
        raise HTTPException(502, "The sharing server cannot be reached")


def shared_can_write(owner, folder_id, folder_path=""):
    try:
        return "upload" in shared_listing(owner, folder_id, folder_path)[1]
    except HTTPException:
        return False


def shared_write_beside(owner, folder_id, path, data):
    """Upload ``data`` (bytes) to ``path`` of a shared folder. ``True`` when it was written."""
    import json
    row = _shared_row(owner, folder_id)
    if not shared_can_write(owner, folder_id, os.path.dirname(path)):
        return False
    try:
        start = json.loads(_shared_call(row, "/uploads", "POST", {"path": path, "size": len(data)}))
        chunk = int(start.get("chunk_size") or 4 * 1024 * 1024)
        offset = 0
        while offset < len(data) or (offset == 0 and not data):
            part = data[offset:offset + chunk]
            _shared_call(row, "/uploads/" + start["id"], "PUT", part,
                         {"X-Upload-Offset": str(offset), "Content-Type": "application/octet-stream"}, timeout=120)
            offset += len(part)
            if not part:
                break
        return True
    except (HTTPException, ValueError, KeyError):
        return False


def shared_mkdir(owner, folder_id, path):
    """Create a folder in a shared folder. ``True`` when it exists afterwards."""
    row = _shared_row(owner, folder_id)
    try:
        _shared_call(row, "/operations/mkdir", "POST", {"path": path})
        return True
    except HTTPException:
        return False


def shared_delete(owner, folder_id, path):
    """Delete a file or an empty folder of a shared folder. ``True`` when it was deleted."""
    row = _shared_row(owner, folder_id)
    try:
        _shared_call(row, "/operations/delete", "POST", {"path": path})
        return True
    except HTTPException:
        return False


def shared_upload_file(owner, folder_id, path, local_path):
    """Stream a local file to ``path`` of a shared folder without loading it into memory."""
    import json
    row = _shared_row(owner, folder_id)
    size = os.path.getsize(local_path)
    start = json.loads(_shared_call(row, "/uploads", "POST", {"path": path, "size": size}))
    chunk = int(start.get("chunk_size") or 4 * 1024 * 1024)
    offset = 0
    try:
        with open(local_path, "rb") as f:
            while offset < size or (offset == 0 and size == 0):
                part = f.read(chunk)
                _shared_call(row, "/uploads/" + start["id"], "PUT", part,
                             {"X-Upload-Offset": str(offset), "Content-Type": "application/octet-stream"}, timeout=300)
                offset += len(part)
                if not part:
                    break
    except Exception:
        try:
            _shared_call(row, "/uploads/" + start["id"], "DELETE")
        except HTTPException:
            pass
        raise
