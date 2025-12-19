import os
import time
import uuid
from pathlib import Path
from datetime import datetime, timezone
import shutil

from fastapi import UploadFile, HTTPException
from .config import TMP_DIR, TMP_TTL_SECONDS, MAX_UPLOAD_MB, PERM_DIR
from .db import db_conn

def ensure_tmp_dir() -> None:
    TMP_DIR.mkdir(parents=True, exist_ok=True)

def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

def _safe_ext(name: str) -> str:
    n = name.lower().strip()
    if not n.endswith(".pdf"):
        return ""
    return ".pdf"

async def save_temp_pdf(file: UploadFile) -> dict:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Empty filename")

    ext = _safe_ext(file.filename)
    if ext != ".pdf":
        raise HTTPException(status_code=400, detail="Only PDF allowed")

    ct = (file.content_type or "").lower()
    # Иногда браузер шлёт application/octet-stream — не блокируем жёстко, но проверим расширение
    if ct and ("pdf" not in ct) and (ct != "application/octet-stream"):
        raise HTTPException(status_code=400, detail="Invalid content-type")

    ensure_tmp_dir()

    upload_id = uuid.uuid4().hex
    stored_name = f"{upload_id}.pdf"
    stored_path = TMP_DIR / stored_name

    # Ограничение размера (мягко: считаем по чтению)
    max_bytes = MAX_UPLOAD_MB * 1024 * 1024
    total = 0

    with stored_path.open("wb") as out:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                try:
                    stored_path.unlink(missing_ok=True)
                except Exception:
                    pass
                raise HTTPException(status_code=413, detail=f"File too large (>{MAX_UPLOAD_MB}MB)")
            out.write(chunk)

    created_at = utc_now_iso()

    with db_conn() as conn:
        conn.execute(
            "INSERT INTO uploads (id, original_name, stored_path, created_at) VALUES (?, ?, ?, ?)",
            (upload_id, file.filename, str(stored_path), created_at)
        )
        conn.commit()

    return {
        "id": upload_id,
        "name": file.filename,
        "preview_url": f"/api/preview/{upload_id}"
    }

def cleanup_expired_files() -> int:
    """
    Удаляет файлы старше TTL (и не трогает записи истории — просто файл может стать 'expired').
    """
    ensure_tmp_dir()
    now = time.time()
    removed = 0

    for p in TMP_DIR.glob("*.pdf"):
        try:
            mtime = p.stat().st_mtime
            if now - mtime > TMP_TTL_SECONDS:
                p.unlink(missing_ok=True)
                removed += 1
        except Exception:
            continue

    return removed

def get_upload_meta(upload_id: str) -> dict | None:
    with db_conn() as conn:
        cur = conn.execute(
            "SELECT id, original_name, stored_path, created_at FROM uploads WHERE id=?",
            (upload_id,)
        )
        row = cur.fetchone()
    if not row:
        return None
    return {"id": row[0], "name": row[1], "path": row[2], "created_at": row[3]}

def list_uploads(limit: int = 200) -> list[dict]:
    """
    Возвращает ТОЛЬКО сохранённые (committed) файлы.
    Временные в историю не попадают.
    """
    with db_conn() as conn:
        cur = conn.execute(
            """
            SELECT id, original_name, stored_path, created_at
            FROM uploads
            WHERE is_committed = 1
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (limit,)
        )
        rows = cur.fetchall()

    return [
        {
            "id": r[0],
            "name": r[1],
            "path": r[2],
            "created_at": r[3]
        }
        for r in rows
    ]


def file_exists(path: str) -> bool:
    try:
        return Path(path).is_file()
    except Exception:
        return False

def ensure_perm_dir() -> None:
    PERM_DIR.mkdir(parents=True, exist_ok=True)

def commit_uploads(ids: list[str]) -> dict:
    """
    Делает выбранные файлы постоянными:
    - переносит из TMP_DIR в PERM_DIR
    - обновляет stored_path и is_committed=1 в БД
    """
    ensure_perm_dir()
    moved = 0
    missing = []

    with db_conn() as conn:
        for upload_id in ids:
            cur = conn.execute(
                "SELECT stored_path, original_name, is_committed FROM uploads WHERE id=?",
                (upload_id,)
            )
            row = cur.fetchone()
            if not row:
                missing.append(upload_id)
                continue

            old_path, original_name, is_committed = row[0], row[1], int(row[2] or 0)
            if is_committed == 1:
                continue  # уже сохранён

            old_p = Path(old_path)
            if not old_p.is_file():
                missing.append(upload_id)
                continue

            new_path = PERM_DIR / f"{upload_id}.pdf"
            try:
                shutil.move(str(old_p), str(new_path))
            except Exception:
                # если move не вышел, считаем как missing
                missing.append(upload_id)
                continue

            conn.execute(
                "UPDATE uploads SET stored_path=?, is_committed=1 WHERE id=?",
                (str(new_path), upload_id)
            )
            moved += 1

        conn.commit()

    return {"moved": moved, "missing": missing}