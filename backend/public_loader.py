"""
Loads public.py from each installed app and registers its router.
Routes are mounted at /pub/<app_id>/ and are accessible from external domains.
"""

import importlib.util
import os
import sys
from fastapi import FastAPI

BACKENDS_DIR = os.path.join(os.path.dirname(__file__), "apps")

# app_id -> router
_public_routers: dict = {}


def load_all(app: FastAPI) -> None:
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
        spec = importlib.util.spec_from_file_location(mod_name, path)
        mod = importlib.util.module_from_spec(spec)
        sys.modules[mod_name] = mod
        spec.loader.exec_module(mod)
        router = getattr(mod, "router", None)
        if router is None:
            print(f"[public-loader] {app_id}: no router found, skipping")
            return False
        _public_routers[app_id] = router
        app.include_router(router, prefix=f"/pub/{app_id}")
        print(f"[public-loader] loaded public: {app_id}")
        return True
    except Exception as e:
        print(f"[public-loader] failed to load {app_id}: {e}")
        return False


def install(app: FastAPI, app_id: str, source_code: str) -> None:
    app_dir = os.path.join(BACKENDS_DIR, app_id)
    os.makedirs(app_dir, exist_ok=True)
    path = os.path.join(app_dir, "public.py")
    with open(path, "w") as f:
        f.write(source_code)
    _load_one(app, app_id)


def get_router(app_id: str):
    return _public_routers.get(app_id)


def get_app_public_dir(app_id: str) -> str | None:
    d = os.path.join(BACKENDS_DIR, app_id, "public")
    return d if os.path.isdir(d) else None
