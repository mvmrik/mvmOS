import sqlite3
import configparser
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data.db")


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

            CREATE TABLE IF NOT EXISTS plugins (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                icon TEXT NOT NULL DEFAULT '📦',
                category TEXT NOT NULL DEFAULT 'Utilities',
                version TEXT NOT NULL DEFAULT '1.0.0',
                description TEXT NOT NULL DEFAULT '',
                js_code TEXT NOT NULL DEFAULT '',
                manifest_url TEXT NOT NULL DEFAULT '',
                installed_at INTEGER DEFAULT (strftime('%s','now'))
            );
        """)


def load_config():
    cfg = configparser.ConfigParser()
    cfg_path = os.path.join(os.path.dirname(__file__), "..", "config.ini")
    cfg.read(cfg_path)
    return cfg
