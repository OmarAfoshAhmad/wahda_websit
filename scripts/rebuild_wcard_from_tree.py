from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import pandas as pd


ROOT = Path(r"C:\Users\Omar\Desktop\شركة وعد\م.عمر\W CARD")
OUT_DIR = Path(r"C:\Users\Omar\waad_temp_website\exports")
OUT_FILE = OUT_DIR / "wcard_rebuilt_from_tree.xlsx"
EXCEL_SUFFIXES = {".xlsx", ".xlsm", ".xls"}


def norm_text(value: Any) -> str:
    text = str(value or "").strip()
    if text.lower() == "nan":
        return ""
    return re.sub(r"\s+", " ", text)


def norm_header(value: Any) -> str:
    text = norm_text(value)
    text = text.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا")
    text = text.replace("ى", "ي").replace("ة", "ه")
    return text.lower()


def clean_job_number(value: Any) -> str:
    text = norm_text(value).translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789"))
    if not text:
        return ""
    text = text.replace(",", "").replace(" ", "")
    if re.fullmatch(r"\d+\.0+", text):
        text = text.split(".", 1)[0]
    if text.upper().startswith("WAB2025"):
        return ""
    if re.fullmatch(r"\d{2,12}", text):
        return text
    return ""


def clean_name(value: Any) -> str:
    text = norm_text(value)
    if not text:
        return ""
    if re.fullmatch(r"[\d\W_]+", text):
        return ""
    if text.upper().startswith("WAB2025"):
        return ""
    return text


def extract_card(value: Any) -> str:
    text = norm_text(value).upper().replace(" ", "")
    if re.fullmatch(r"WAB2025[0-9A-Z]+", text):
        return text
    return ""


def extract_batch_number(*sources: str) -> str:
    patterns = [
        r"(?:الدفعه|الدفعة|دفعه|دفعة|batch)\s*[:\-]?\s*\(?\s*(\d{1,3})\s*\)?",
        r"(?:^|[\\/\s_\-])(\d{1,2})\s*الصادر",
        r"(?:^|[\\/\s_\-])دفعة\s*(\d{1,3})",
        r"(?:^|[\\/\s_\-])الدفعة\s*(\d{1,3})",
        r"\((\d{1,3})\)",
    ]
    for source in sources:
        text = str(source or "").strip()
        if not text:
            continue
        text = text.translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789"))
        candidates = [text]
        try:
            candidates.append(Path(text).name)
        except Exception:
            pass
        for candidate in candidates:
            for pat in patterns:
                match = re.search(pat, candidate, flags=re.IGNORECASE)
                if match:
                    return match.group(1)
    return ""


def is_name_header(h: str) -> bool:
    return any(
        k in h
        for k in [
            "الاسم",
            "اسم",
            "name",
            "beneficiary",
        ]
    )


def is_job_header(h: str) -> bool:
    return any(
        k in h
        for k in [
            "رقم الوظيفي",
            "الرقم الوظيفي",
            "رقم وظيفي",
            "employee",
            "emp no",
            "emp number",
        ]
    )


def is_card_header(h: str) -> bool:
    return any(k in h for k in ["رقم البطاق", "البطاقه", "البطاقة", "insurance profile", "card"])


def is_batch_header(h: str) -> bool:
    return "دفع" in h or "batch" in h


def detect_header(raw_df: pd.DataFrame) -> tuple[int, dict[str, int]] | None:
    best: tuple[int, int, dict[str, int]] | None = None
    scan_max = min(12, len(raw_df))
    for r in range(scan_max):
        mapping: dict[str, int] = {}
        score = 0
        for c, cell in enumerate(raw_df.iloc[r].tolist()):
            h = norm_header(cell)
            if not h:
                continue
            if "name" not in mapping and is_name_header(h):
                mapping["name"] = c
                score += 2
            if "job" not in mapping and is_job_header(h):
                mapping["job"] = c
                score += 3
            if "card" not in mapping and is_card_header(h):
                mapping["card"] = c
                score += 1
            if "batch" not in mapping and is_batch_header(h):
                mapping["batch"] = c
                score += 1
        if score >= 5 and "name" in mapping and "job" in mapping:
            if best is None or score > best[0]:
                best = (score, r, mapping)
    if best is None:
        return None
    return best[1], best[2]


def extract_records(file_path: Path, sheet_name: str, root: Path) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    raw = pd.read_excel(file_path, sheet_name=sheet_name, header=None, dtype=str).fillna("")
    if raw.empty:
        return out

    detected = detect_header(raw)
    mapping: dict[str, int] = {}
    if detected is None:
        start = 0
    else:
        header_row, mapping = detected
        start = header_row + 1

    def pick_job_fallback(values: list[str]) -> str:
        for v in values:
            j = clean_job_number(v)
            if j:
                return j
        return ""

    def pick_name_fallback(values: list[str]) -> str:
        for v in values:
            n = clean_name(v)
            if not n:
                continue
            if len(n) < 6:
                continue
            if any(x in n for x in ["موظف", "موظفة", "زوج", "زوجة", "ابن", "ابنة", "المنظومة", "دفعة"]):
                continue
            return n
        return ""
    batch_from_path = extract_batch_number(str(file_path.parent), file_path.name, sheet_name)

    rel = str(file_path.relative_to(root))
    for i in range(start, len(raw)):
        values = [norm_text(v) for v in raw.iloc[i].tolist()]
        if not any(values):
            continue

        if "name" in mapping and mapping["name"] < len(values):
            name = clean_name(values[mapping["name"]])
        else:
            name = pick_name_fallback(values)

        if "job" in mapping and mapping["job"] < len(values):
            job = clean_job_number(values[mapping["job"]])
        else:
            job = pick_job_fallback(values)

        if not name or not job:
            continue

        card = ""
        if "card" in mapping and mapping["card"] < len(values):
            card = extract_card(values[mapping["card"]])
        if not card:
            for v in values:
                card = extract_card(v)
                if card:
                    break

        batch_from_cell = ""
        if "batch" in mapping and mapping["batch"] < len(values):
            batch_from_cell = extract_batch_number(values[mapping["batch"]])

        out.append(
            {
                "الاسم": name,
                "الرقم_الوظيفي": job,
                "رقم_البطاقة": card,
                "الدفعة": batch_from_cell or batch_from_path,
                "مصدر_الدفعة": "من_السطر" if batch_from_cell else ("من_المسار" if batch_from_path else ""),
                "الملف_النسبي": rel,
                "الملف": str(file_path),
                "الورقة": sheet_name,
                "رقم_الصف": i + 1,
            }
        )
    return out


def main() -> None:
    files = sorted([p for p in ROOT.rglob("*") if p.is_file() and p.suffix.lower() in EXCEL_SUFFIXES and not p.name.startswith("~$")])
    all_rows: list[dict[str, str]] = []
    failures: list[dict[str, str]] = []

    for f in files:
        try:
            xls = pd.ExcelFile(f)
        except Exception as ex:
            failures.append({"file": str(f), "sheet": "", "error": str(ex)[:220]})
            continue
        for sheet in xls.sheet_names:
            try:
                rows = extract_records(f, sheet, ROOT)
                all_rows.extend(rows)
            except Exception as ex:
                failures.append({"file": str(f), "sheet": sheet, "error": str(ex)[:220]})

    if not all_rows:
        raise RuntimeError("لم يتم استخراج أي بيانات بالمعايير المطلوبة (اسم + رقم وظيفي).")

    raw_df = pd.DataFrame(all_rows)
    raw_df = raw_df.drop_duplicates(subset=["الاسم", "الرقم_الوظيفي", "الملف", "الورقة", "رقم_الصف"])

    unique_df = (
        raw_df.sort_values(by=["الدفعة", "الرقم_الوظيفي", "الاسم"], na_position="last")
        .groupby(["الاسم", "الرقم_الوظيفي"], as_index=False)
        .agg(
            {
                "رقم_البطاقة": "first",
                "الدفعة": "first",
                "مصدر_الدفعة": "first",
                "الملف_النسبي": "first",
                "الملف": "first",
                "الورقة": "first",
                "رقم_الصف": "first",
            }
        )
    )

    by_file = (
        raw_df.groupby(["الملف_النسبي"], as_index=False)
        .size()
        .rename(columns={"size": "عدد_السجلات"})
        .sort_values("عدد_السجلات", ascending=False)
    )
    by_batch = (
        unique_df.assign(الدفعة=unique_df["الدفعة"].replace("", "غير معروف"))
        .groupby("الدفعة", as_index=False)
        .size()
        .rename(columns={"size": "عدد_الأسماء"})
        .sort_values("الدفعة")
    )
    no_batch = unique_df[unique_df["الدفعة"].astype(str).str.strip() == ""].copy()
    failures_df = pd.DataFrame(failures) if failures else pd.DataFrame(columns=["file", "sheet", "error"])

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with pd.ExcelWriter(OUT_FILE, engine="openpyxl") as writer:
        raw_df.to_excel(writer, index=False, sheet_name="كل_السجلات_بدون_دمج")
        unique_df.to_excel(writer, index=False, sheet_name="قائمة_موحدة_اسم_رقم")
        by_file.to_excel(writer, index=False, sheet_name="ملخص_حسب_الملف")
        by_batch.to_excel(writer, index=False, sheet_name="ملخص_حسب_الدفعة")
        no_batch.to_excel(writer, index=False, sheet_name="بدون_دفعة")
        failures_df.to_excel(writer, index=False, sheet_name="ملفات_فشل_قراءتها")

    print(f"OUTPUT={OUT_FILE}")
    print(f"FILES_SCANNED={len(files)}")
    print(f"RAW_ROWS={len(raw_df)}")
    print(f"UNIQUE_ROWS={len(unique_df)}")
    print(f"NO_BATCH={len(no_batch)}")


if __name__ == "__main__":
    main()
