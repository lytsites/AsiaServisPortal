import sqlite3
from contextlib import contextmanager
from .config import DB_PATH

def _column_exists(conn: sqlite3.Connection, table: str, col: str) -> bool:
    cur = conn.execute(f"PRAGMA table_info({table})")
    cols = [r[1] for r in cur.fetchall()]
    return col in cols

def init_db() -> None:
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("""
        CREATE TABLE IF NOT EXISTS uploads (
            id TEXT PRIMARY KEY,
            original_name TEXT NOT NULL,
            stored_path TEXT NOT NULL,
            created_at TEXT NOT NULL,
            is_committed INTEGER NOT NULL DEFAULT 0
        )
        """)

        # миграции для уже существующих БД
        if not _column_exists(conn, "uploads", "is_committed"):
            conn.execute("ALTER TABLE uploads ADD COLUMN is_committed INTEGER NOT NULL DEFAULT 0")

        conn.commit()

@contextmanager
def db_conn():
    conn = sqlite3.connect(DB_PATH)
    try:
        yield conn
    finally:
        conn.close()
