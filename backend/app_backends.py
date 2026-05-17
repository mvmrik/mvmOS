"""
Dynamic app backend loader.

Each installed app that needs a server-side component places a Python file in
backend/app-backends/<app-id>.py  The file must expose a FastAPI `router`
object at module level.  This module discovers and mounts all such routers
automatically at startup, and provides helpers for install/uninstall.
"""

import importlib.util
import os
import sys
from fastapi import FastAPI

BACKENDS_DIR = os.path.join(os.path.dirname(__file__), "app-backends")

# Set by load_all() so install() can mount without needing the app reference
_app_ref: FastAPI | None = None


def load_all(app: FastAPI) -> None:
    """Load every *.py in app-backends/ and mount its router. Call once at startup."""
    global _app_ref
    _app_ref = app
    os.makedirs(BACKENDS_DIR, exist_ok=True)
    for fname in sorted(os.listdir(BACKENDS_DIR)):
        if fname.endswith(".py"):
            _load_one(app, fname[:-3])


def _load_one(app: FastAPI, app_id: str) -> bool:
    path = os.path.join(BACKENDS_DIR, f"{app_id}.py")
    if not os.path.isfile(path):
        return False
    mod_name = f"app_backend_{app_id}"
    try:
        spec = importlib.util.spec_from_file_location(mod_name, path)
        mod = importlib.util.module_from_spec(spec)
        sys.modules[mod_name] = mod
        spec.loader.exec_module(mod)
        router = getattr(mod, "router", None)
        if router is None:
            print(f"[app-backends] {app_id}: no router found, skipping")
            return False
        app.include_router(router)
        print(f"[app-backends] loaded backend: {app_id}")
        return True
    except Exception as e:
        print(f"[app-backends] failed to load {app_id}: {e}")
        return False


def install(app_id: str, source_code: str) -> None:
    """Write backend file and mount its router immediately (no restart needed)."""
    os.makedirs(BACKENDS_DIR, exist_ok=True)
    path = os.path.join(BACKENDS_DIR, f"{app_id}.py")
    with open(path, "w") as f:
        f.write(source_code)
    if _app_ref is not None:
        _load_one(_app_ref, app_id)


def uninstall(app_id: str) -> None:
    """Remove backend file. Router stays mounted until next restart (FastAPI limitation)."""
    path = os.path.join(BACKENDS_DIR, f"{app_id}.py")
    if os.path.isfile(path):
        os.remove(path)
    sys.modules.pop(f"app_backend_{app_id}", None)
    print(f"[app-backends] uninstalled backend: {app_id}")


def has_backend(app_id: str) -> bool:
    return os.path.isfile(os.path.join(BACKENDS_DIR, f"{app_id}.py"))
