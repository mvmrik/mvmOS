"""
Dynamic app backend loader.

Each installed app that needs a server-side component places a Python file at
backend/apps/<app-id>/backend.py  The file must expose a FastAPI `router`
object at module level.  This module discovers and mounts all such routers
automatically at startup, and provides helpers for install/uninstall.
"""

import os
import sys
import types
from fastapi import FastAPI
from starlette.routing import Mount

BACKENDS_DIR = os.path.join(os.path.dirname(__file__), "apps")

# Set by load_all() so install() can mount without needing the app reference
_app_ref: FastAPI | None = None


def reposition_before_mounts(app: FastAPI, new_routes: list) -> None:
    """include_router appends at the end of app.routes — after the catch-all
    "/" static mount, which shadows everything behind it. Move the freshly
    added routes back in front of the first Mount so they can match."""
    first_mount = next((i for i, r in enumerate(app.routes) if isinstance(r, Mount)), None)
    if first_mount is None or not new_routes:
        return
    for r in new_routes:
        app.routes.remove(r)
    app.routes[first_mount:first_mount] = new_routes


def load_all(app: FastAPI) -> None:
    """Load every backend.py in apps/<id>/ and mount its router. Call once at startup."""
    global _app_ref
    _app_ref = app
    os.makedirs(BACKENDS_DIR, exist_ok=True)
    for app_id in sorted(os.listdir(BACKENDS_DIR)):
        path = os.path.join(BACKENDS_DIR, app_id, "backend.py")
        if os.path.isfile(path):
            _load_one(app, app_id)


def _load_one(app: FastAPI, app_id: str) -> bool:
    path = os.path.join(BACKENDS_DIR, app_id, "backend.py")
    if not os.path.isfile(path):
        return False
    mod_name = f"app_backend_{app_id}"
    try:
        old_mod = sys.modules.get(mod_name)
        if old_mod is not None:
            task = getattr(old_mod, "_loop_task", None)
            if task and not task.done():
                task.cancel()
        app.routes[:] = [r for r in app.routes if not getattr(r, "_app_backend", None) == app_id]

        # exec the source directly — importlib would reuse a stale .pyc when
        # mtime (1s resolution) and file size happen to match the old version
        with open(path) as f:
            source = f.read()
        mod = types.ModuleType(mod_name)
        mod.__file__ = path
        sys.modules[mod_name] = mod
        exec(compile(source, path, "exec"), mod.__dict__)
        router = getattr(mod, "router", None)
        if router is None:
            print(f"[app-backends] {app_id}: no router found, skipping")
            return False
        existing_paths = {id(r) for r in app.routes}
        app.include_router(router)
        new_routes = []
        for route in app.routes:
            if id(route) not in existing_paths:
                route._app_backend = app_id
                new_routes.append(route)
        reposition_before_mounts(app, new_routes)
        print(f"[app-backends] loaded backend: {app_id}")
        return True
    except Exception as e:
        print(f"[app-backends] failed to load {app_id}: {e}")
        return False


def install(app_id: str, source_code: str) -> None:
    """Write backend.py and mount its router immediately (no restart needed)."""
    app_dir = os.path.join(BACKENDS_DIR, app_id)
    os.makedirs(app_dir, exist_ok=True)
    path = os.path.join(app_dir, "backend.py")
    with open(path, "w") as f:
        f.write(source_code)
    if _app_ref is not None:
        _load_one(_app_ref, app_id)


def uninstall(app_id: str) -> None:
    """Remove backend folder and unmount its routes immediately."""
    import shutil
    app_dir = os.path.join(BACKENDS_DIR, app_id)
    if os.path.isdir(app_dir):
        shutil.rmtree(app_dir)
    sys.modules.pop(f"app_backend_{app_id}", None)
    if _app_ref is not None:
        _app_ref.routes[:] = [r for r in _app_ref.routes if getattr(r, "_app_backend", None) != app_id]
    print(f"[app-backends] uninstalled backend: {app_id}")


def has_backend(app_id: str) -> bool:
    return os.path.isfile(os.path.join(BACKENDS_DIR, app_id, "backend.py"))


def list_backends() -> list[str]:
    if not os.path.isdir(BACKENDS_DIR):
        return []
    return [d for d in os.listdir(BACKENDS_DIR)
            if os.path.isfile(os.path.join(BACKENDS_DIR, d, "backend.py"))]
