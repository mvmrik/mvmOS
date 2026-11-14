# Written by mvmOS App Builder from a platform template. The functions other apps, Automations and the
# External API may call are in builder/app/app_api.py and are run with the restricted loader.
import json
import os
import sys

APP_ID = "__ID__"
_DIR = os.path.dirname(os.path.abspath(__file__))


def _declared():
    try:
        with open(os.path.join(_DIR, "public", "bundle.json"), encoding="utf-8") as f:
            return json.load(f).get("integrations") or []
    except (OSError, ValueError):
        return []


sys.modules["backend.builder_sandbox"].load(globals(), os.path.join(_DIR, "builder", "app", "app_api.py"), APP_ID, _DIR, _declared())
