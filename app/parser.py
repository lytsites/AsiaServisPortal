import re
from typing import Any, List, Dict
import pdfplumber

RE_REGION = re.compile(r"Регион:\s*(.+)")
RE_REPORT_DATE = re.compile(r"Отчет произведен:\s*([0-9]{2}\.[0-9]{2}\.[0-9]{4}\s+[0-9]{2}:[0-9]{2}:[0-9]{2})")
RE_PERIOD = re.compile(r"Период:\s*([0-9]{2}\.[0-9]{2}\.[0-9]{4}\s*-\s*[0-9]{2}\.[0-9]{2}\.[0-9]{4})")

def _clean_text(t: str) -> str:
    t = (t or "").replace("\u00A0", " ")
    t = re.sub(r"[ \t]+", " ", t)
    return t.strip()

def _extract_meta(full_text: str) -> Dict[str, str]:
    region = ""
    report_date = ""
    period = ""

    m = RE_REGION.search(full_text)
    if m:
        region = m.group(1).strip()

    m = RE_REPORT_DATE.search(full_text)
    if m:
        report_date = m.group(1).strip()

    m = RE_PERIOD.search(full_text)
    if m:
        period = m.group(1).strip()

    return {"region": region, "report_date": report_date, "period": period}

def _parse_rows_by_columns(page) -> List[Dict[str, str]]:
    """
    Парсит строки таблицы по координатам колонок, устойчиво к переносам.
    Нужные поля:
    - ИИН/БИН (12 цифр)
    - Код банка (7 символов + буква на следующей строке)
    - ИИК (KZ + 18 символов, часто продолжение на следующих строках)
    - КБК (6 цифр)
    - Сумма (xxx,xxx.xx)
    """
    words = page.extract_words()
    # ИИН/БИН всегда отдельным словом (12 цифр)
    iin_words = [w for w in words if re.fullmatch(r"\d{12}", w["text"])]
    iin_words = sorted(iin_words, key=lambda w: w["top"])

    rows = []
    for idx, iw in enumerate(iin_words):
        top = iw["top"]
        next_top = iin_words[idx + 1]["top"] if idx + 1 < len(iin_words) else 10**9

        # 1) Берём "основную" строку записи (где стоит ИИН)
        line = [w for w in words if abs(w["top"] - top) < 2.5]
        line = sorted(line, key=lambda w: w["x0"])

        iin = iw["text"]
        pay_no = ""
        bank_base = ""
        iik_prefix = ""
        kbk = ""
        amount = ""

        # По координатам колонок (под ваш PDF)
        for w in line:
            t = w["text"]
            # Код банка (часто 7 символов в этой строке)
            if 320 <= w["x0"] <= 385 and re.fullmatch(r"[A-Z0-9]{7,8}", t):
                bank_base = t

            # ИИК префикс (KZ + 5 символов)
            if 385 <= w["x0"] <= 470 and re.fullmatch(r"KZ[0-9A-Z]{5}", t):
                iik_prefix = t

            # КБК (6 цифр) — в вашем PDF стоит около x0 ~ 442
            if 420 <= w["x0"] <= 500 and re.fullmatch(r"\d{6}", t):
                kbk = t

            # Сумма — около x0 ~ 528
            if w["x0"] >= 505 and re.fullmatch(r"\d[\d,]*\.\d{2}", t):
                amount = t
        
        # Номер платежного поручения (может быть "226*" и т.п.)
        for w in line:
            t = w["text"]
            if re.fullmatch(r"\d+\*?", t):
                pay_no = t
                break

        # 2) Собираем продолжения до следующего ИИН (там обычно лежат:
        #    - последняя буква кода банка
        #    - остаток ИИК (может содержать буквы/цифры)
        between = [w for w in words if top < w["top"] < next_top]
        between = sorted(between, key=lambda w: (w["top"], w["x0"]))

        # Суффикс кода банка (одна буква в колонке банка)
        suffix = ""
        for w in between:
            if 320 <= w["x0"] <= 385 and re.fullmatch(r"[A-Z]", w["text"]):
                suffix = w["text"]
                break

        bank_code = bank_base
        if bank_base and len(bank_base) == 7 and suffix:
            bank_code = bank_base + suffix

        # Остаток ИИК: берём токены в колонке ИИК (могут быть A2910013 и т.п.)
        cont_parts = []
        for w in between:
            if 385 <= w["x0"] <= 470 and re.fullmatch(r"[0-9A-Z]+", w["text"]):
                cont_parts.append(w["text"])

        iik = (iik_prefix or "") + "".join(cont_parts)
        # Казахстанский ИИК обычно длиной 20 (KZ + 18)
        if len(iik) > 20:
            iik = iik[:20]

        # если что-то ключевое не нашли — всё равно добавим строку, но пустое поле будет видно
        rows.append({
            "pay_no": pay_no,
            "iin_bin": iin,
            "bank_code": bank_code,
            "iik": iik,
            "kbk": kbk,
            "amount_in": amount
        })

    # дедупликация (в PDF могут повторяться строки из-за повторов блоков)
    uniq = []
    seen = set()
    for r in rows:
        key = (r.get("pay_no",""), r["iin_bin"], r["bank_code"], r["iik"], r["kbk"], r["amount_in"])
        if key in seen:
            continue
        seen.add(key)
        uniq.append(r)

    return uniq

def parse_report_pdf(pdf_path: str) -> dict[str, Any]:
    pages_text = []
    all_rows = []

    with pdfplumber.open(pdf_path) as pdf:
        for p in pdf.pages:
            pages_text.append(p.extract_text() or "")
            all_rows.extend(_parse_rows_by_columns(p))

    full_text = _clean_text("\n".join(pages_text))
    meta = _extract_meta(full_text)

    return {
        "region": meta["region"],
        "report_date": meta["report_date"],
        "period": meta["period"],
        "rows": all_rows
    }
