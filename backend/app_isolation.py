"""
Filesystem isolation for apps/<id>/ server code.

An app's api.py runs in the server process, so without this it could open core
data.db or another app's files simply by writing the path. This module makes
that a hard error instead of a rule nobody enforces: while an app's module is
being loaded and while its routes are running, sqlite3.connect() and open()
accept only paths inside apps/<id>/.

What an app needs from outside its folder it asks the Platform API for
(backend/platform_api.py) — that is the whole point of those endpoints, and it
is unaffected by this, being a function call rather than a file access.

Work that genuinely cannot go through an endpoint — reading system files,
driving another service — is why backend/apps/<id>/ exists. Code there is not
wrapped, which is exactly why installing such an app asks for the password.

Enforcement is per-app and thread-local, so core code and backend/apps/<id>/
code keep full access even while an app's request is in flight.

LIMITATION — WebSocket routes are NOT covered. A router dependency runs and
unwinds during the handshake, so everything the socket does afterwards runs
unconfined (verified: a WS handler could read core data.db). Covering it means
wrapping the route's ASGI app so the confinement spans the whole connection —
a few lines, safe now that the root is a ContextVar rather than thread-local.

Not done yet because nothing needs it: chat and gamehub stay in
backend/apps/<id>/ for a different reason. gamehub reads core data.db for
every game's name and icon (mp.py _list_games, backend.py _build_stats) and
scans other apps' folders — all inside try/except, so under confinement it
would not crash, it would silently list games with no names. That is a hub
reading other apps' data, the same case as telegramhub, and it needs a
Platform API endpoint for plugin metadata before it can move. A plain game or
chat app touching only its own files can move as soon as the wrapper lands.
"""

import builtins
import contextvars
import os
import sqlite3
import sys

# A ContextVar, not threading.local(): asyncio runs many requests and many
# long-lived WebSocket connections on one thread, and each must carry its own
# confinement. A ContextVar follows the task across await points, so two
# sockets in the same event loop can never see each other's root.
_root: contextvars.ContextVar = contextvars.ContextVar("app_isolation_root", default=None)

_real_open = builtins.open
_real_connect = sqlite3.connect

_installed = False

# Read by the framework on the app's behalf, not by the app: Starlette's
# FileResponse consults the mime type table for every file it serves, so
# blocking these would break returning a file from apps/<id>/public/ — the
# most ordinary thing an app does. They are public, read-only system tables
# containing no data about this install.
_ALWAYS_READABLE = frozenset({
    "/etc/mime.types",
    "/etc/httpd/mime.types",
    "/etc/apache2/mime.types",
})


class AppIsolationError(PermissionError):
    """An app tried to reach outside apps/<id>/."""


def _current_root():
    return _root.get()


def _restore(token, prev):
    """Undo a set(), tolerating a block that entered and exited in different
    contexts.

    reset(token) is the correct way, but a dependency using `yield` is entered
    and resumed by Starlette in separate contexts, and reset() then raises
    ValueError. Setting the previous value back is equivalent for our purpose:
    confinement never widens, because whatever was in force before is what we
    put back.
    """
    try:
        _root.reset(token)
    except ValueError:
        _root.set(prev)


def _check(path, what):
    root = _current_root()
    if root is None:
        return
    # A file descriptor or a sqlite URI/:memory: has no path to confine.
    if isinstance(path, int):
        return
    try:
        p = os.fspath(path)
    except TypeError:
        return
    if not isinstance(p, str):
        return
    if p == ":memory:" or p.startswith("file::memory:"):
        return

    resolved = os.path.realpath(os.path.join(root, p))
    if resolved in _ALWAYS_READABLE:
        return
    if resolved == root or resolved.startswith(root + os.sep):
        return

    app_id = os.path.basename(root)
    raise AppIsolationError(
        f"app '{app_id}' may not {what} outside its own folder: {p}\n"
        f"Use the Platform API (/api/platform/...) for anything from mvmOS, "
        f"or move this to backend/apps/{app_id}/ if it genuinely needs the system."
    )


def _guarded_open(file, *a, **kw):
    _check(file, "open files")
    return _real_open(file, *a, **kw)


def _guarded_connect(database, *a, **kw):
    _check(database, "open databases")
    return _real_connect(database, *a, **kw)


def install():
    """Wrap open()/sqlite3.connect() once, at startup."""
    global _installed
    if _installed:
        return
    builtins.open = _guarded_open
    sqlite3.connect = _guarded_connect
    _installed = True


class confine:
    """Confine file access to app_dir for the duration of the block.

    Nested use (an app's route calling into a helper that confines again) keeps
    the innermost root and restores the previous one on exit, so a plain
    reentrant call can never widen access.
    """

    def __init__(self, app_dir):
        self.root = os.path.realpath(app_dir)
        self.token = None
        self.prev = None

    def __enter__(self):
        self.prev = _root.get()
        self.token = _root.set(self.root)
        return self

    def __exit__(self, *exc):
        _restore(self.token, self.prev)
        return False


class release:
    """Lift confinement — for core code called from inside an app's request.

    The Platform API runs under this: an app asking for the install's currency
    is a sanctioned endpoint, and core reading core data.db to answer it must
    not be judged by the caller's confinement.
    """

    def __enter__(self):
        self.prev = _root.get()
        self.token = _root.set(None)
        return self

    def __exit__(self, *exc):
        _restore(self.token, self.prev)
        return False
