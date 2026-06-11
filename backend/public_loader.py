"""
Loads public.py from each installed app and registers its router.
Routes are mounted at /pub/<app_id>/ and are accessible from external domains.
"""

import os
import sys
import types
from fastapi import FastAPI
from .app_backends import reposition_before_mounts

BACKENDS_DIR = os.path.join(os.path.dirname(__file__), "apps")

# app_id -> router
_public_routers: dict = {}

# Set by load_all() so install() can mount without needing the app reference
_app_ref: FastAPI | None = None


def load_all(app: FastAPI) -> None:
    global _app_ref
    _app_ref = app
    os.makedirs(BACKENDS_DIR, exist_ok=True)
    for app_id in sorted(os.listdir(BACKENDS_DIR)):
        path = os.path.join(BACKENDS_DIR, app_id, "public.py")
        if os.path.isfile(path):
            _load_one(app, app_id)


def _load_one(app: FastAPI, app_id: str) -> bool:
    path = os.path.join(BACKENDS_DIR, app_id, "public.py")
    if not os.path.isfile(path):
        return False
    mod_name = f"app_public_{app_id}"
    try:
        app.routes[:] = [r for r in app.routes if getattr(r, "_app_public", None) != app_id]

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
            print(f"[public-loader] {app_id}: no router found, skipping")
            return False
        _public_routers[app_id] = router
        existing_paths = {id(r) for r in app.routes}
        app.include_router(router, prefix=f"/pub/{app_id}")
        new_routes = []
        for route in app.routes:
            if id(route) not in existing_paths:
                route._app_public = app_id
                new_routes.append(route)
        reposition_before_mounts(app, new_routes)
        print(f"[public-loader] loaded public: {app_id}")
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
