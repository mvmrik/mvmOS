"""Which paths a domain that shows only Apps Hub or one app may reach."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend import public_hosts  # noqa: E402


class PublicHosts(unittest.TestCase):
    def test_shared_pieces_reach_every_public_host(self):
        for mode, app in (("hub", "apphub"), ("app", "mvmai")):
            for p in ("/asset.js", "/i18n/en.js", "/pub/apphub/layout.js", "/api/pub/apphub/me",
                      "/api/notifications", "/api/notifications/badges", "/api/settings/display"):
                self.assertTrue(public_hosts.allows(mode, app, p), (mode, p))

    def test_app_host_reaches_only_its_own_app(self):
        self.assertTrue(public_hosts.allows("app", "mvmai", "/pub/mvmai/chats"))
        self.assertFalse(public_hosts.allows("app", "mvmai", "/pub/calendar/"))
        self.assertFalse(public_hosts.allows("app", "mvmai", "/pub/mvmaix/"))

    def test_hub_host_reaches_public_apps(self):
        self.assertTrue(public_hosts.allows("hub", "apphub", "/pub/calendar/"))

    def test_desktop_stays_closed(self):
        for mode, app in (("hub", "apphub"), ("app", "mvmai")):
            for p in ("/", "/login", "/index.html", "/desktop.js", "/api/auth/me", "/api/apps", "/api/domains",
                      "/pub/apphub/../../api/domains", "/pub/apphub/%2e%2e/api/domains", "/pub//x"):
                self.assertFalse(public_hosts.allows(mode, app, p), (mode, p))

    def test_other_rows_are_unchanged(self):
        self.assertFalse(public_hosts.allows(None, "site", "/pub/apphub/layout.js"))


if __name__ == "__main__":
    unittest.main()
