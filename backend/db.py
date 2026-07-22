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

# Existing Store apps keep their installed database row when mvmOS itself is
# updated. Apply this map at startup so their Start Menu category follows the
# current Store taxonomy without requiring a reinstall.
STORE_APP_CATEGORIES = {
    "beambuilder": "Creative", "budget": "Finance", "calculator": "Utilities",
    "calendar": "Productivity", "chat": "Communication", "cost-splitter": "Finance",
    "cron-manager": "System & Administration", "findyourself": "Games",
    "gamehub": "Games", "git-manager": "Developer Tools", "mvm2factor": "Security & Privacy",
    "mvmai": "AI", "mvmsitebuilder": "Creative", "process-manager": "System & Administration",
    "qbit-dashboard": "Media", "queuedesk": "Business", "quotebuilder": "Business",
    "rssfeed": "Media", "server-manager": "System & Administration",
    "server-monitor": "System & Administration", "shoppinglist": "Productivity",
    "statetracker": "System & Administration", "sudofall": "Games",
    "system-info": "System & Administration", "tasks": "Productivity",
    "telegramhub": "Communication", "yoursql": "Developer Tools",
}


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
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
        for app_id, category in STORE_APP_CATEGORIES.items():
            conn.execute(
                "UPDATE plugins SET category=? WHERE id=? AND is_system=0",
                (category, app_id),
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
