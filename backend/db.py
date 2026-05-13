import sqlite3
import configparser
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data.db")
APPS_DIR     = os.path.join(os.path.dirname(__file__), "..", "apps")
WIDGETS_DIR  = os.path.join(os.path.dirname(__file__), "..", "widgets")
THEMES_DIR   = os.path.join(os.path.dirname(__file__), "..", "themes")

OFFICIAL_STORE_URL         = "https://raw.githubusercontent.com/mvmrik/mvmos-store/main/manifest.json"
OFFICIAL_WIDGETS_STORE_URL = "https://raw.githubusercontent.com/mvmrik/mvmos-store/main/widgets/manifest.json"
OFFICIAL_THEMES_STORE_URL  = "https://raw.githubusercontent.com/mvmrik/mvmos-store/main/themes/manifest.json"


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


XDG_DIRS = ["Desktop", "Downloads", "Documents", "Music", "Pictures", "Videos", "Public", "Templates"]


def init_user_dirs():
    home = os.path.expanduser("~")
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
                open_count INTEGER NOT NULL DEFAULT 0
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
                desktop_y INTEGER
            );
        """)
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


def load_config():
    cfg = configparser.ConfigParser()
    cfg_path = os.path.join(os.path.dirname(__file__), "..", "config.ini")
    cfg.read(cfg_path)
    return cfg
