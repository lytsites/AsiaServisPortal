from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent  # <папка>/
DB_PATH = BASE_DIR / "app.db"

# Временное хранилище (удаляется очисткой по TTL)
TMP_DIR = BASE_DIR / "app" / ".tmp_uploads"
TMP_TTL_SECONDS = 60 * 60  # 1 час
MAX_UPLOAD_MB = 50
PERM_DIR = BASE_DIR / "app" / "uploads"