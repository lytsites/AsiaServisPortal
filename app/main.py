from pathlib import Path
import re
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, Request, UploadFile, File
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel

from .db import init_db
from .storage import (
    cleanup_expired_files,
    save_temp_pdf,
    get_upload_meta,
    list_uploads,
    file_exists,
    commit_uploads
)
from .parser import parse_report_pdf

BASE_APP_DIR = Path(__file__).resolve().parent
templates = Jinja2Templates(directory=str(BASE_APP_DIR / "templates"))

app = FastAPI(title="PDF Dashboard")
app.add_middleware(GZipMiddleware, minimum_size=1000)

app.mount("/static", StaticFiles(directory=str(BASE_APP_DIR / "static")), name="static")


# -----------------------------
# Helpers for /report sorting
# -----------------------------
RE_PERIOD_RANGE = re.compile(
    r"(?P<s>\d{2}\.\d{2}\.\d{4})\s*-\s*(?P<e>\d{2}\.\d{2}\.\d{4})"
)

def _period_start(period: str) -> datetime:
    m = RE_PERIOD_RANGE.search(period or "")
    if not m:
        return datetime.max
    return datetime.strptime(m.group("s"), "%d.%m.%Y")


@app.on_event("startup")
def on_startup():
    init_db()
    cleanup_expired_files()


@app.get("/", response_class=HTMLResponse)
def page_index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/history", response_class=HTMLResponse)
def page_history(request: Request):
    cleanup_expired_files()
    items = list_uploads()
    for it in items:
        it["available"] = file_exists(it["path"])
    return templates.TemplateResponse("history.html", {"request": request, "items": items})


@app.get("/file/{upload_id}", response_class=HTMLResponse)
def page_file(request: Request, upload_id: str):
    meta = get_upload_meta(upload_id)
    if not meta:
        return RedirectResponse(url="/history", status_code=302)

    available = file_exists(meta["path"])
    parsed = parse_report_pdf(meta["path"]) if available else None

    return templates.TemplateResponse(
        "file.html",
        {"request": request, "meta": meta, "available": available, "parsed": parsed}
    )


# --- API ---

@app.post("/api/upload")
async def api_upload(file: UploadFile = File(...)):
    cleanup_expired_files()
    payload = await save_temp_pdf(file)
    return JSONResponse(payload)


@app.get("/api/preview/{upload_id}")
def api_preview(upload_id: str):
    meta = get_upload_meta(upload_id)
    if not meta or not file_exists(meta["path"]):
        return JSONResponse({"detail": "File not found (expired or missing)"}, status_code=404)

    headers = {
        "Cache-Control": "no-store",
        "Content-Disposition": f'inline; filename="{meta["name"]}"'
    }

    return FileResponse(
        meta["path"],
        media_type="application/pdf",
        headers=headers
    )


@app.get("/viewer/{upload_id}", response_class=HTMLResponse)
def page_viewer(request: Request, upload_id: str):
    meta = get_upload_meta(upload_id)
    if not meta or not file_exists(meta["path"]):
        return HTMLResponse("Not found", status_code=404)

    return templates.TemplateResponse("viewer.html", {
        "request": request,
        "pdf_url": f"/api/preview/{upload_id}"
    })


class CommitBody(BaseModel):
    ids: list[str]


@app.post("/api/commit")
def api_commit(body: CommitBody):
    result = commit_uploads(body.ids)
    return JSONResponse(result)


@app.get("/report", response_class=HTMLResponse)
def page_report(request: Request):
    files = list_uploads(limit=500)  # committed only (если вы так настроили list_uploads)

    parsed_files = []
    for f in files:
        if not file_exists(f["path"]):
            continue

        parsed = parse_report_pdf(f["path"])
        period = (parsed.get("period") or "").strip()
        region = (parsed.get("region") or "").strip()
        report_date = (parsed.get("report_date") or "").strip()
        rows = parsed.get("rows", []) or []

        parsed_files.append({
            "period": period,
            "period_start": _period_start(period),
            "region": region,
            "report_date": report_date,
            "rows": rows,
        })

    # Самый ранний период первым (январь -> февраль -> март)
    parsed_files.sort(key=lambda x: x["period_start"])

    # PERIOD -> DATA(этого файла) -> PERIOD -> DATA(следующего файла) ...
    table_rows = []
    seen = set()  # дедуп по всем параметрам (на всякий случай)

    for pf in parsed_files:
        period = pf["period"]

        # строка периода ПЕРЕД данными файла
        table_rows.append({"type": "period", "period": period})

        # строки файла
        for r in pf["rows"]:
            key = (
                period,
                pf["region"],
                pf["report_date"],
                r.get("pay_no", ""),   # чтобы одинаковые строки с разными платежками не склеивались
                r.get("iin_bin", ""),
                r.get("bank_code", ""),
                r.get("iik", ""),
                r.get("kbk", ""),
                r.get("amount_in", ""),
            )
            if key in seen:
                continue
            seen.add(key)

            table_rows.append({
                "type": "data",
                "iin_bin": r.get("iin_bin", ""),
                "bank_code": r.get("bank_code", ""),
                "iik": r.get("iik", ""),
                "kbk": r.get("kbk", ""),
                "amount_in": r.get("amount_in", ""),
            })

    return templates.TemplateResponse("report.html", {
        "request": request,
        "rows": table_rows,
        "files_count": len(parsed_files)
    })


@app.get("/api/report/data")
def api_report_data():
    """API endpoint for charts and filters data"""
    files = list_uploads(limit=500)
    
    parsed_files = []
    for f in files:
        if not file_exists(f["path"]):
            continue
        
        parsed = parse_report_pdf(f["path"])
        period = (parsed.get("period") or "").strip()
        region = (parsed.get("region") or "").strip()
        report_date = (parsed.get("report_date") or "").strip()
        rows = parsed.get("rows", []) or []
        
        # Clean amount strings for numeric calculations
        cleaned_rows = []
        for r in rows:
            cleaned_rows.append({
                "iin_bin": r.get("iin_bin", ""),
                "bank_code": r.get("bank_code", ""),
                "iik": r.get("iik", ""),
                "kbk": r.get("kbk", ""),
                "amount_in": r.get("amount_in", ""),
                "amount_numeric": float(r.get("amount_in", "0").replace(",", "")) if r.get("amount_in") else 0.0
            })
        
        parsed_files.append({
            "period": period,
            "period_start": _period_start(period).isoformat() if period else "",
            "region": region,
            "report_date": report_date,
            "rows": cleaned_rows,
        })
    
    # Sort by period
    parsed_files.sort(key=lambda x: x["period_start"])
    
    return {
        "files": parsed_files,
        "total_files": len(parsed_files),
        "available_regions": list(set([f["region"] for f in parsed_files if f["region"]])),
        "available_periods": list(set([f["period"] for f in parsed_files if f["period"]])),
        "available_kbks": list(set([
            r["kbk"] for f in parsed_files for r in f["rows"] if r["kbk"]
        ]))
    }
