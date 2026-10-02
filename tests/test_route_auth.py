"""Guards who may call each core endpoint.

The backend runs as root, so a route that forgets its check lets any caller
act as root. A password dialog in the browser does not count: only what the
server checks does. This test reads the dependencies of every core route and
fails when a new route has no identity check, or when a system action loses
its administrator check.

Run: venv/bin/python -m unittest tests.test_route_auth
"""
import glob
import importlib
import os
import sys
import sqlite3
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from fastapi.routing import APIRoute, APIWebSocketRoute  # noqa: E402
from backend import auth  # noqa: E402
from backend import db, plugins, scheduler  # noqa: E402
from fastapi import HTTPException  # noqa: E402
from starlette.requests import Request  # noqa: E402

SESSION_CHECKS = {
    auth.get_current_session,
    auth.get_current_session_optional,
    auth.require_admin,
    auth.require_root_session,
}

# Routes without a desktop session dependency, each with the reason it is safe.
PUBLIC = {
    ("GET", "/login"): "login page",
    ("POST", "/login"): "login itself, rate limited",
    ("POST", "/login/totp"): "second login step, needs the pending token",
    ("GET", "/api/auth/login-users"): "user names shown on the login page",
    ("POST", "/api/auth/switch"): "checks the session cookie and the target user's password itself",
    ("POST", "/logout"): "only ends the caller's own session",
    ("GET", "/api/scheduler/tick"): "accepts only the local crontab, see _from_local_cron",
    ("POST", "/api/scheduler/tick"): "accepts only the local crontab, see _from_local_cron",
    ("GET", "/api/scheduler/status"): "read only state of the cron line",
    ("GET", "/api/settings/display"): "display settings needed before login",
    ("GET", "/api/notifications/badges"): "checks the Apps Hub token itself",
    ("GET", "/ui.js"): "Automations public page script",
    ("GET", "/"): "public page shells of Clipboard and Automations",
}
# Prefixes whose routes check an Apps Hub token or platform identity themselves.
PUBLIC_PREFIXES = ("/api/pub/", "/api/platform/")

# System actions: root, or a sudo user after their password (require_admin).
ADMIN = {
    ("POST", "/api/users"), ("PATCH", "/api/users/{username}"), ("DELETE", "/api/users/{username}"),
    ("POST", "/api/plugins/stores"), ("DELETE", "/api/plugins/stores/{store_id}"),
    ("POST", "/api/plugins/install"), ("DELETE", "/api/plugins/{plugin_id}"),
    ("POST", "/api/widgets/stores"), ("DELETE", "/api/widgets/stores/{store_id}"),
    ("POST", "/api/widgets/install"), ("DELETE", "/api/widgets/{widget_id}"),
    ("POST", "/api/themes/stores"), ("DELETE", "/api/themes/stores/{store_id}"),
    ("POST", "/api/themes/install"), ("DELETE", "/api/themes/{theme_id}"),
    ("POST", "/api/packages/install"), ("POST", "/api/packages/upgrade"), ("POST", "/api/packages/remove"),
    ("POST", "/api/system/update"), ("POST", "/api/system/power/restart"), ("POST", "/api/system/power/stop"),
    ("POST", "/api/system/processes/kill"), ("POST", "/api/system/services/action"),
    ("POST", "/api/system/php-ini"), ("POST", "/api/system/mysql-cnf"),
    ("POST", "/api/system/nginx-conf"), ("POST", "/api/system/sshd-conf"),
    ("POST", "/api/system/ufw-toggle"), ("POST", "/api/system/ufw-allow"), ("POST", "/api/system/ufw-delete"),
    ("POST", "/api/backup/create"), ("GET", "/api/backup/download/{folder_name}"),
    ("DELETE", "/api/backup/{folder_name}"), ("POST", "/api/backup/schedule"),
    ("POST", "/api/domains"), ("DELETE", "/api/domains/{site_id}"),
}


def _calls(dependant):
    for dep in dependant.dependencies:
        yield dep.call
        yield from _calls(dep)


def _core_routes():
    for path in sorted(glob.glob(os.path.join(ROOT, "backend", "*.py"))):
        name = os.path.basename(path)[:-3]
        if name in ("main", "__init__"):
            continue
        router = getattr(importlib.import_module(f"backend.{name}"), "router", None)
        for route in getattr(router, "routes", []):
            if isinstance(route, APIRoute):
                for method in route.methods:
                    yield name, method, route.path, set(_calls(route.dependant))
            elif isinstance(route, APIWebSocketRoute):
                yield name, "WS", route.path, None


class RouteAuthTest(unittest.TestCase):
    def test_admin_key_is_bound_to_session_and_expires(self):
        session = {"effective_user": "member", "token": "session-a"}
        request = Request({"type": "http", "headers": [(b"x-admin-key", b"test-key")], "query_string": b""})
        entry = {"session": "session-a", "expires": time.time() + 10}
        with patch.dict(auth._admin_keys, {"test-key": entry}, clear=True):
            self.assertEqual(auth.ensure_admin(session, request), session)
            with self.assertRaises(HTTPException):
                auth.ensure_admin({**session, "token": "session-b"}, request)
            entry["expires"] = time.time() - 1
            with self.assertRaises(HTTPException):
                auth.ensure_admin(session, request)

    def test_browser_sql_cannot_open_another_database(self):
        with tempfile.TemporaryDirectory() as folder:
            conn = db.connect_own_db(os.path.join(folder, "app.db"))
            try:
                for sql in ("ATTACH DATABASE ':memory:' AS other", "VACUUM INTO 'other.db'"):
                    with self.assertRaises(sqlite3.DatabaseError):
                        conn.execute(sql)
                conn.set_authorizer(plugins._settings_only)
                conn.execute("CREATE TABLE IF NOT EXISTS cfg (key TEXT PRIMARY KEY, value TEXT)")
                conn.execute("INSERT INTO cfg VALUES ('theme', 'light')")
                self.assertEqual(conn.execute("SELECT value FROM cfg").fetchone(), ("light",))
                for sql in ("SELECT name FROM sqlite_master", "CREATE TABLE secret (value TEXT)"):
                    with self.assertRaises(sqlite3.DatabaseError):
                        conn.execute(sql)
            finally:
                conn.close()

    def test_scheduler_rejects_proxied_loopback_request(self):
        scope = {"type": "http", "client": ("127.0.0.1", 2026), "query_string": b""}
        self.assertTrue(scheduler._from_local_cron(Request({**scope, "headers": []})))
        for header in (b"x-forwarded-for", b"x-real-ip", b"cf-connecting-ip", b"forwarded"):
            self.assertFalse(scheduler._from_local_cron(Request({**scope, "headers": [(header, b"203.0.113.1")]})))

    def test_every_route_checks_who_calls(self):
        missing = []
        for module, method, path, deps in _core_routes():
            if deps is None:  # websockets check the session cookie in the handler
                continue
            if deps & SESSION_CHECKS or (method, path) in PUBLIC or path.startswith(PUBLIC_PREFIXES):
                continue
            missing.append(f"{module}: {method} {path}")
        self.assertEqual(missing, [], "Routes without any identity check")

    def test_system_actions_need_admin(self):
        found = {(m, p): d for _, m, p, d in _core_routes() if d is not None}
        absent = sorted(f"{m} {p}" for m, p in ADMIN if (m, p) not in found)
        self.assertEqual(absent, [], "ADMIN lists routes that no longer exist")
        weak = sorted(f"{m} {p}" for m, p in ADMIN if auth.require_admin not in found[(m, p)])
        self.assertEqual(weak, [], "System actions without require_admin")


if __name__ == "__main__":
    unittest.main()
