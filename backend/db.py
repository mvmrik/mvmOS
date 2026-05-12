import sqlite3
import configparser
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data.db")


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_conn() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                created_at INTEGER DEFAULT (strftime('%s','now'))
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
        """)


def load_config():
    cfg = configparser.ConfigParser()
    cfg_path = os.path.join(os.path.dirname(__file__), "..", "config.ini")
    cfg.read(cfg_path)
    return cfg
