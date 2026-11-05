"""Listeners registered with backend/notifications.py hear every stored notification."""
import sqlite3
import sys
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend import notifications  # noqa: E402


class NotificationListener(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        path = str(Path(self.tmp.name) / "n.db")

        @contextmanager
        def conn_factory():
            conn = sqlite3.connect(path)
            conn.row_factory = sqlite3.Row
            try:
                yield conn
            finally:
                conn.close()

        conn = sqlite3.connect(path)
        conn.execute(
            "CREATE TABLE notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, kind TEXT, source TEXT, "
            "title TEXT, body TEXT, action_app TEXT, ref TEXT, sender TEXT, title_key TEXT, body_key TEXT, vars TEXT, "
            "link TEXT, audience TEXT, is_read INTEGER, created_at TEXT)")
        conn.commit()
        conn.close()
        self.original = notifications.get_conn
        notifications.get_conn = conn_factory
        notifications._listeners.clear()

    def tearDown(self):
        notifications.get_conn = self.original
        notifications._listeners.clear()
        self.tmp.cleanup()

    def test_listener_receives_the_stored_row(self):
        heard = []
        notifications.register_listener("one", heard.append)
        row = notifications.notify("budget", to="anna", title="Hi", title_key="k", vars={"a": 1})
        self.assertEqual(len(heard), 1)
        self.assertEqual(heard[0]["id"], row["id"])
        self.assertEqual(heard[0]["source"], "budget")
        self.assertEqual(heard[0]["username"], "anna")
        self.assertEqual(heard[0]["audience"], "hub")

    def test_failing_listener_does_not_break_the_notification(self):
        def boom(_row):
            raise RuntimeError("nope")
        heard = []
        notifications.register_listener("boom", boom)
        notifications.register_listener("ok", heard.append)
        row = notifications.create_notification("anna", "Hi")
        self.assertTrue(row["id"])
        self.assertEqual(len(heard), 1)

    def test_registering_a_name_again_replaces_it(self):
        first, second = [], []
        notifications.register_listener("hub", first.append)
        notifications.register_listener("hub", second.append)
        notifications.create_notification("anna", "Hi")
        self.assertEqual((len(first), len(second)), (0, 1))
        notifications.unregister_listener("hub")
        notifications.create_notification("anna", "Hi")
        self.assertEqual(len(second), 1)


if __name__ == "__main__":
    unittest.main()
