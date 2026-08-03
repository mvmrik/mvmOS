import json
import sys
import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data.db")
APPS_DIR     = os.path.join(os.path.dirname(__file__), "..", "apps")
WIDGETS_DIR  = os.path.join(os.path.dirname(__file__), "..", "widgets")
THEMES_DIR   = os.path.join(os.path.dirname(__file__), "..", "themes")

OFFICIAL_STORE_URL         = "https://raw.githubusercontent.com/mvmrik/mvmos-store/main/manifest.json"
OFFICIAL_WIDGETS_STORE_URL = "https://raw.githubusercontent.com/mvmrik/mvmos-store/main/widgets/manifest.json"
OFFICIAL_THEMES_STORE_URL  = "https://raw.githubusercontent.com/mvmrik/mvmos-store/main/themes/manifest.json"

# Single source of truth for built-in system apps (id, name, icon, category).
# Adding a new system app only requires adding an entry here — it is auto-seeded
# into the `plugins` table on every backend startup so it participates in
# Start Menu recent/most-used tracking like any store app.
SYSTEM_APPS = [
    {"id": "terminal",        "name": "Terminal",         "icon": "🖥️", "category": "Developer Tools"},
    {"id": "filemanager",     "name": "File Manager",     "icon": "🗂️", "category": "Utilities"},
    {"id": "msc",             "name": "Sites",            "icon": "🛠️", "category": "Creative"},
    {"id": "appstore",        "name": "App Store",        "icon": "📦", "category": "System & Administration"},
    {"id": "startup-manager", "name": "Startup Manager",  "icon": "🚀", "category": "System & Administration"},
    {"id": "apphub",          "name": "Apps Hub",         "icon": "🧩", "category": "Communication"},
    {"id": "settings",        "name": "Settings",         "icon": "⚙️", "category": "System & Administration"},
    {"id": "notifications",  "name": "Notifications",    "icon": "🔔", "category": "Communication"},
]


def get_conn():
    """Core data.db. Opened with core's own access even when the caller is a
    confined app going through a sanctioned path (the Platform API, or core
    checking that app's session) — an app still cannot open this file itself,
    because it never gets to name the path."""
    isolation = sys.modules.get("backend.app_isolation")
    if isolation is None:
        conn = sqlite3.connect(DB_PATH)   # isolation not installed (CLI, tests)
    else:
        with isolation.release():
            conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    # WAL lets reads run while a write is in flight — with several users on the
    # desktop at once, this is the difference between waiting and not. The
    # timeout is a ceiling, not a delay: a write takes a few ms, so a queued
    # one gets its turn almost immediately and never reaches 5s in practice.
    # Without it, two simultaneous writes fail instantly with "database is
    # locked" instead of queuing.
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


XDG_DIRS = ["Desktop", "Downloads", "Documents", "Music", "Pictures", "Videos", "Public", "Templates"]


def init_user_dirs():
    home = os.path.expanduser("~")
    if not os.access(home, os.W_OK):
        return
    for d in XDG_DIRS:
        os.makedirs(os.path.join(home, d), exist_ok=True)


def init_db():
    init_user_dirs()
    os.makedirs(APPS_DIR, exist_ok=True)
    os.makedirs(WIDGETS_DIR, exist_ok=True)
    os.makedirs(THEMES_DIR, exist_ok=True)
    with get_conn() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                created_at INTEGER DEFAULT (strftime('%s','now')),
                effective_user TEXT NOT NULL DEFAULT 'root'
            );

            CREATE TABLE IF NOT EXISTS desktop_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                config TEXT NOT NULL DEFAULT '{}'
            );

            INSERT OR IGNORE INTO desktop_state (id, config) VALUES (1, '{}');

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL DEFAULT '{}'
            );

            CREATE TABLE IF NOT EXISTS stores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                manifest_url TEXT NOT NULL UNIQUE,
                official INTEGER NOT NULL DEFAULT 0,
                added_at INTEGER DEFAULT (strftime('%s','now'))
            );

            CREATE TABLE IF NOT EXISTS plugins (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                icon TEXT NOT NULL DEFAULT '📦',
                category TEXT NOT NULL DEFAULT 'Utilities',
                version TEXT NOT NULL DEFAULT '1.0.0',
                description TEXT NOT NULL DEFAULT '',
                store_id INTEGER REFERENCES stores(id),
                installed_at INTEGER DEFAULT (strftime('%s','now')),
                last_opened_at INTEGER,
                open_count INTEGER NOT NULL DEFAULT 0,
                is_system INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS widget_stores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                manifest_url TEXT NOT NULL UNIQUE,
                official INTEGER NOT NULL DEFAULT 0,
                added_at INTEGER DEFAULT (strftime('%s','now'))
            );

            CREATE TABLE IF NOT EXISTS theme_stores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                manifest_url TEXT NOT NULL UNIQUE,
                official INTEGER NOT NULL DEFAULT 0,
                added_at INTEGER DEFAULT (strftime('%s','now'))
            );

            CREATE TABLE IF NOT EXISTS themes (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                icon TEXT NOT NULL DEFAULT '🎨',
                category TEXT NOT NULL DEFAULT 'Dark',
                version TEXT NOT NULL DEFAULT '1.0.0',
                description TEXT NOT NULL DEFAULT '',
                layout TEXT NOT NULL DEFAULT 'macos',
                store_id INTEGER REFERENCES theme_stores(id),
                installed_at INTEGER DEFAULT (strftime('%s','now')),
                is_active INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS domains (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                domain TEXT UNIQUE,
                path TEXT UNIQUE,
                app_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
                created_at INTEGER DEFAULT (strftime('%s','now'))
            );

            CREATE TABLE IF NOT EXISTS widgets (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                icon TEXT NOT NULL DEFAULT '🔲',
                category TEXT NOT NULL DEFAULT 'System',
                version TEXT NOT NULL DEFAULT '1.0.0',
                description TEXT NOT NULL DEFAULT '',
                widget_type TEXT NOT NULL DEFAULT 'taskbar',
                store_id INTEGER REFERENCES widget_stores(id),
                installed_at INTEGER DEFAULT (strftime('%s','now')),
                taskbar_order INTEGER,
                desktop_x INTEGER,
                desktop_y INTEGER,
                size TEXT DEFAULT 'm'
            );

            CREATE TABLE IF NOT EXISTS user_totp (
                username TEXT PRIMARY KEY,
                secret TEXT NOT NULL,
                created_at INTEGER DEFAULT (strftime('%s','now'))
            );

            CREATE TABLE IF NOT EXISTS notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                kind TEXT NOT NULL DEFAULT 'persistent',
                source TEXT NOT NULL DEFAULT 'system',
                title TEXT NOT NULL,
                body TEXT NOT NULL DEFAULT '',
                action_app TEXT,
                ref TEXT,
                is_read INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_notifications_username ON notifications(username, created_at DESC);
        """)
        # migrations for existing DBs
        try:
            conn.execute("ALTER TABLE widgets ADD COLUMN size TEXT DEFAULT 'm'")
        except Exception:
            pass
        try:
            conn.execute("ALTER TABLE domains ADD COLUMN path TEXT")
        except Exception:
            pass
        try:
            conn.execute("ALTER TABLE plugins ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0")
        except Exception:
            pass
        try:
            conn.execute("ALTER TABLE notifications ADD COLUMN ref TEXT")
        except Exception:
            pass
        conn.execute("CREATE INDEX IF NOT EXISTS idx_notifications_ref ON notifications(username, source, ref)")
        for app in SYSTEM_APPS:
            conn.execute(
                "INSERT INTO plugins (id, name, icon, category, version, description, is_system) "
                "VALUES (?, ?, ?, ?, '1.0.0', '', 1) "
                "ON CONFLICT(id) DO UPDATE SET name=excluded.name, icon=excluded.icon, "
                "category=excluded.category, is_system=1",
                (app["id"], app["name"], app["icon"], app["category"]),
            )
        # An installed app's own manifest is the authority on its identity, so
        # re-read it at startup: an app that changed its name, icon or category
        # in the Store follows without a reinstall, and a renamed app never has
        # to be listed anywhere in core.
        for row in conn.execute("SELECT id FROM plugins WHERE is_system=0").fetchall():
            try:
                with open(os.path.join(APPS_DIR, row["id"], "manifest.json")) as f:
                    mf = json.load(f)
            except Exception:
                continue          # uninstalled, unreadable or hand-made app row
            fields = {k: mf[k] for k in ("name", "icon", "category") if mf.get(k)}
            if fields:
                conn.execute(
                    "UPDATE plugins SET " + ", ".join(f"{k}=?" for k in fields) + " WHERE id=?",
                    (*fields.values(), row["id"]),
                )
        conn.execute(
            "INSERT OR IGNORE INTO stores (name, manifest_url, official) VALUES (?, ?, 1)",
            ("mvmOS Store", OFFICIAL_STORE_URL),
        )
        conn.execute(
            "INSERT OR IGNORE INTO widget_stores (name, manifest_url, official) VALUES (?, ?, 1)",
            ("mvmOS Widgets", OFFICIAL_WIDGETS_STORE_URL),
        )
        conn.execute(
            "INSERT OR IGNORE INTO theme_stores (name, manifest_url, official) VALUES (?, ?, 1)",
            ("mvmOS Themes", OFFICIAL_THEMES_STORE_URL),
        )
        # Seed default theme if no theme is installed
        existing = conn.execute("SELECT id FROM themes LIMIT 1").fetchone()
        if not existing:
            conn.execute(
                "INSERT OR IGNORE INTO themes (id, name, icon, category, version, description, layout, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
                ("default", "mvmOS Default", "🖤", "Dark", "1.0.0", "The default dark theme.", "macos"),
            )
