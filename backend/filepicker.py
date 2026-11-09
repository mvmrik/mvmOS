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
