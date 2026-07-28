"""
Loads an app's server code and registers its routers.

apps/<id>/api.py may declare:
  router          -> mounted at /pub/<id>       (Apps Hub token)
  desktop_router  -> mounted at /api/apps/<id>  (desktop session)

Both prefixes are assigned here, from the app's id. An app never chooses its
own path: it cannot mount at /api/settings, shadow a core route, or sit on
another app's prefix.

An app whose two surfaces are big enough to want separate files may put the
desktop half in apps/<id>/desktop.py instead; its `router` is mounted at
/api/apps/<id> exactly as a `desktop_router` in api.py would be.

backend/apps/<id>/public.py is the older location, still honoured.
"""

import os
import sys
import types
from fastapi import Depends, FastAPI
from . import app_isolation
from .app_backends import reposition_before_mounts

BACKENDS_DIR = os.path.join(os.path.dirname(__file__), "apps")
APPS_DIR = os.path.join(os.path.dirname(__file__), "..", "apps")

# app_id -> router
_public_routers: dict = {}

# Set by load_all() so install() can mount without needing the app reference
_app_ref: FastAPI | None = None


def _source_path(app_id: str) -> str | None:
    """An app's server code lives in apps/<id>/api.py.
    backend/apps/<id>/public.py is the older location, still honoured."""
    for path in (
        os.path.join(APPS_DIR, app_id, "api.py"),
        os.path.join(BACKENDS_DIR, app_id, "public.py"),
    ):
        if os.path.isfile(path):
            return path
    return None


def load_all(app: FastAPI) -> None:
    global _app_ref
    _app_ref = app
    os.makedirs(BACKENDS_DIR, exist_ok=True)
    app_ids = set(os.listdir(BACKENDS_DIR))
    if os.path.isdir(APPS_DIR):
        app_ids |= set(os.listdir(APPS_DIR))
    for app_id in sorted(app_ids):
        if _source_path(app_id) or os.path.isfile(os.path.join(APPS_DIR, app_id, "desktop.py")):
            _load_one(app, app_id)


def _exec_module(path: str, mod_name: str, app_dir: str):
    """exec the source directly — importlib would reuse a stale .pyc when
    mtime (1s resolution) and file size happen to match the old version.

    Module-level code is confined too: an app must not read core data.db or a
    sibling app's files while merely being imported."""
    with open(path) as f:
        source = f.read()
    mod = types.ModuleType(mod_name)
    mod.__file__ = path
    sys.modules[mod_name] = mod
    with app_isolation.confine(app_dir):
        exec(compile(source, path, "exec"), mod.__dict__)
    return mod


def _isolate_routes(routes, app_dir: str) -> None:
    """Confine an app's routes by wrapping each route's ASGI app.

    Not a dependency: a `yield` dependency is entered in a different context
    from the route body, so with a ContextVar root the body would run with no
    confinement at all (verified — open('/etc/passwd') succeeded). Wrapping the
    route puts the set() and the handler in the same context, and covers
    WebSocket routes for the whole life of the connection rather than only the
    handshake.

    The Platform API lifts this for itself, so a sanctioned endpoint still
    answers normally.
    """
    for route in routes:
        original = getattr(route, "app", None)
        if original is None:
            continue

        async def wrapped(scope, receive, send, _original=original):
            with app_isolation.confine(app_dir):
                await _original(scope, receive, send)

        route.app = wrapped


def _load_one(app: FastAPI, app_id: str) -> bool:
    path = _source_path(app_id)
    desktop_path = os.path.join(APPS_DIR, app_id, "desktop.py")
    if path is None and not os.path.isfile(desktop_path):
        return False
    mod_name = f"app_public_{app_id}"
    app_dir = os.path.realpath(os.path.join(APPS_DIR, app_id))
    try:
        app.routes[:] = [r for r in app.routes if getattr(r, "_app_public", None) != app_id]

        router = desktop_router = None
        if path is not None:
            mod = _exec_module(path, mod_name, app_dir)
            router = getattr(mod, "router", None)
            desktop_router = getattr(mod, "desktop_router", None)

        # A separate desktop.py keeps a big desktop surface out of api.py; its
        # `router` means the same thing as `desktop_router` would there.
        if os.path.isfile(desktop_path):
            dmod = _exec_module(desktop_path, f"app_desktop_{app_id}", app_dir)
            desktop_router = getattr(dmod, "router", None) or desktop_router

        if router is None and desktop_router is None:
            print(f"[public-loader] {app_id}: no router found, skipping")
            return False

        existing_paths = {id(r) for r in app.routes}
        if router is not None:
            _public_routers[app_id] = router
            app.include_router(router, prefix=f"/pub/{app_id}")
        # An app reached only from the desktop has no public page; its routes
        # sit at /api/apps/<id> behind the desktop session, exactly where a
        # backend.py used to put them, so main.js needs no change to move here.
        if desktop_router is not None:
            app.include_router(
                desktop_router,
                prefix=f"/api/apps/{app_id}",
                dependencies=[Depends(sys.modules["backend.auth"].get_current_session)],
            )

        new_routes = []
        for route in app.routes:
            if id(route) not in existing_paths:
                route._app_public = app_id
                new_routes.append(route)
        # Wrap after include_router: the routes exist only now, and wrapping
        # them here confines the handler itself rather than a dependency.
        _isolate_routes(new_routes, app_dir)
        reposition_before_mounts(app, new_routes)
        kinds = "+".join(k for k, v in (("public", router), ("desktop", desktop_router)) if v)
        print(f"[public-loader] loaded {kinds}: {app_id}")
        return True
    except Exception as e:
        print(f"[public-loader] failed to load {app_id}: {e}")
        return False


def install(app_id: str, source_code: str) -> None:
    app_dir = os.path.join(BACKENDS_DIR, app_id)
    os.makedirs(app_dir, exist_ok=True)
    path = os.path.join(app_dir, "public.py")
    with open(path, "w") as f:
        f.write(source_code)
    if _app_ref is not None:
        _load_one(_app_ref, app_id)


def get_router(app_id: str):
    return _public_routers.get(app_id)


def get_app_public_dir(app_id: str) -> str | None:
    d = os.path.join(BACKENDS_DIR, app_id, "public")
    return d if os.path.isdir(d) else None
