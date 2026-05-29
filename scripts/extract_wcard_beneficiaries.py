from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import pandas as pd


ROOT = Path(r"C:\Users\Omar\Desktop\شركة وعد\م.عمر\W CARD")
OUT_DIR = Path(r"C:\Users\Omar\waad_temp_website\exports")
OUT_FILE = OUT_DIR / "wcard_beneficiaries_organized.xlsx"

EXCEL_SUFFIXES = {".xlsx", ".xlsm", ".xls"}


def norm_text(value: Any) -> str:
    text = str(value or "").strip()
    if text.lower() == "nan":
        return ""
    return text


def norm_header(value: Any) -> str:
    text = norm_text(value)
    text = text.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا")
    text = text.replace("ى", "ي").replace("ة", "ه")
    text = re.sub(r"\s+", " ", text)
    return text.lower()


def clean_job_number(value: Any) -> str:
    text = norm_text(value)
    if not text:
        return ""
    text = text.replace(",", "").replace(" ", "")
    if re.fullmatch(r"\d+\.0+", text):
        text = text.split(".", 1)[0]
    text = text.translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789"))
    if text.upper().startswith("WAB2025"):
        return ""
    if re.fullmatch(r"\d{2,12}", text):
        return text
    return ""


def clean_name(value: Any) -> str:
    text = norm_text(value)
    if not text:
        return ""
    text = re.sub(r"\s+", " ", text).strip()
    if re.fullmatch(r"[\d\W_]+", text):
        return ""
    return text


def extract_batch_number(*sources: str) -> str:
    patterns = [
        r"(?:الدفعه|الدفعة|دفعه|دفعة|batch)\s*[:\-]?\s*\(?\s*(\d{1,3})\s*\)?",
        r"(?:^|[\\/\s_\-])(\d{1,2})\s*الصادر",
        r"^\s*(\d{1,2})\s",
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


def is_name_header(text: str) -> bool:
    keys = [
        "الاسم",
        "الاسم الكامل",
        "اسم",
        "اسم المستفيد",
        "اسم الموظف",
        "employee name",
        "beneficiary name",
    ]
    return any(k in text for k in keys)


def is_job_header(text: str) -> bool:
    keys = [
        "رقم الوظيفي",
        "الرقم الوظيفي",
        "الرقم الوظيفى",
        "رقم وظيفي",
        "emp",
        "employee no",
        "employee number",
    ]
    return any(k in text for k in keys)


def is_batch_header(text: str) -> bool:
    return "دفع" in text or "batch" in text


def is_card_header(text: str) -> bool:
    keys = ["رقم البطاق", "البطاقه", "البطاقة", "insurance profile", "card"]
    return any(k in text for k in keys)


def is_notes_header(text: str) -> bool:
    keys = ["ملاحظ", "سبب", "note", "notes"]
    return any(k in text for k in keys)


def detect_header_row(raw_df: pd.DataFrame) -> tuple[int, dict[str, int]] | None:
    best: tuple[int, int, dict[str, int]] | None = None
    max_scan = min(12, len(raw_df))
    for r in range(max_scan):
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
            if "batch" not in mapping and is_batch_header(h):
                mapping["batch"] = c
                score += 1
            if "card" not in mapping and is_card_header(h):
                mapping["card"] = c
                score += 1
            if "notes" not in mapping and is_notes_header(h):
                mapping["notes"] = c
                score += 1
        if score >= 4 and "name" in mapping and "job" in mapping:
            if best is None or score > best[0]:
                best = (score, r, mapping)
    if best is None:
        return None
    return best[1], best[2]


def pick_name_from_row(values: list[str], known_index: int | None = None) -> str:
    if known_index is not None and known_index < len(values):
        candidate = clean_name(values[known_index])
        if candidate:
            return candidate
    for v in values:
        text = clean_name(v)
        if not text:
            continue
        if re.search(r"[A-Za-z\u0600-\u06FF]", text) and len(text) >= 6:
            if "موظف" in text or "زوج" in text or "ابن" in text or "ابنة" in text:
                continue
            if text.upper().startswith("WAB2025"):
                continue
            return text
    return ""


def pick_job_from_row(values: list[str], known_index: int | None = None) -> str:
    if known_index is not None and known_index < len(values):
        candidate = clean_job_number(values[known_index])
        if candidate:
            return candidate
    for v in values:
        candidate = clean_job_number(v)
        if candidate:
            return candidate
    return ""


def extract_records_from_sheet(file_path: Path, sheet_name: str) -> list[dict[str, str]]:
    rows_out: list[dict[str, str]] = []
    raw_df = pd.read_excel(file_path, sheet_name=sheet_name, header=None, dtype=str)
    raw_df = raw_df.fillna("")
    if raw_df.empty:
        return rows_out

    header = detect_header_row(raw_df)
    if header is None:
        header_row = -1
        mapping: dict[str, int] = {}
        start_idx = 0
    else:
        header_row, mapping = header
        start_idx = header_row + 1

    file_batch_hint = extract_batch_number(str(file_path.parent), file_path.name, sheet_name)

    for i in range(start_idx, len(raw_df)):
        row_values = [norm_text(v) for v in raw_df.iloc[i].tolist()]
        if not any(row_values):
            continue

        job = pick_job_from_row(row_values, mapping.get("job"))
        name = pick_name_from_row(row_values, mapping.get("name"))
        if not job:
            continue

        card = ""
        if "card" in mapping and mapping["card"] < len(row_values):
            card = norm_text(row_values[mapping["card"]])
        if not card:
            for val in row_values:
                t = norm_text(val).upper().replace(" ", "")
                if re.fullmatch(r"WAB2025[0-9A-Z]+", t):
                    card = t
                    break

        batch_explicit = ""
        if "batch" in mapping and mapping["batch"] < len(row_values):
            batch_explicit = extract_batch_number(norm_text(row_values[mapping["batch"]]))

        notes = ""
        if "notes" in mapping and mapping["notes"] < len(row_values):
            notes = norm_text(row_values[mapping["notes"]])

        batch_inferred = batch_explicit or extract_batch_number(notes) or file_batch_hint

        rows_out.append(
            {
                "الاسم": name,
                "الرقم_الوظيفي": job,
                "رقم_البطاقة": card,
                "الدفعة_الصريحة": batch_explicit or "",
                "الدفعة_المستنتجة": batch_inferred or "",
                "مصدر_الملف": str(file_path),
                "الورقة": sheet_name,
                "رقم_الصف_في_الملف": str(i + 1),
            }
        )

    return rows_out


def main() -> None:
    excel_files = sorted(
        [
            p
            for p in ROOT.rglob("*")
            if p.is_file() and p.suffix.lower() in EXCEL_SUFFIXES and not p.name.startswith("~$")
        ]
    )

    collected: list[dict[str, str]] = []
    failed: list[dict[str, str]] = []

    for file_path in excel_files:
        try:
            xls = pd.ExcelFile(file_path)
        except Exception as ex:
            failed.append({"file": str(file_path), "error": str(ex)[:250]})
            continue

        for sheet in xls.sheet_names:
            try:
                collected.extend(extract_records_from_sheet(file_path, sheet))
            except Exception as ex:
                failed.append({"file": str(file_path), "sheet": sheet, "error": str(ex)[:250]})

    if not collected:
        raise RuntimeError("لم يتم العثور على أي سجلات صالحة.")

    df = pd.DataFrame(collected)
    df["الدفعة_المعتمدة"] = df["الدفعة_الصريحة"].where(df["الدفعة_الصريحة"] != "", df["الدفعة_المستنتجة"])

    # ترميم الدفعات المفقودة اعتماداً على تطابق الرقم الوظيفي/رقم البطاقة من سجلات لها دفعة معروفة.
    known = df[df["الدفعة_المعتمدة"].astype(str).str.strip() != ""].copy()
    if not known.empty:
        by_job = (
            known[known["الرقم_الوظيفي"].astype(str).str.strip() != ""]
            .groupby("الرقم_الوظيفي")["الدفعة_المعتمدة"]
            .agg(lambda s: s.mode().iat[0] if not s.mode().empty else s.iloc[0])
            .to_dict()
        )
        by_card = (
            known[known["رقم_البطاقة"].astype(str).str.strip() != ""]
            .groupby("رقم_البطاقة")["الدفعة_المعتمدة"]
            .agg(lambda s: s.mode().iat[0] if not s.mode().empty else s.iloc[0])
            .to_dict()
        )

        def fill_batch(row: pd.Series) -> str:
            current = str(row["الدفعة_المعتمدة"] or "").strip()
            if current:
                return current
            card = str(row["رقم_البطاقة"] or "").strip()
            if card and card in by_card:
                return str(by_card[card])
            job = str(row["الرقم_الوظيفي"] or "").strip()
            if job and job in by_job:
                return str(by_job[job])
            return ""

        df["الدفعة_المعتمدة"] = df.apply(fill_batch, axis=1)

    # إزالة السجلات التي لا تحتوي اسماً أو رقماً وظيفياً.
    df = df[(df["الاسم"].astype(str).str.strip() != "") | (df["الرقم_الوظيفي"].astype(str).str.strip() != "")]
    df = df.drop_duplicates(subset=["الاسم", "الرقم_الوظيفي", "رقم_البطاقة", "مصدر_الملف", "الورقة", "رقم_الصف_في_الملف"])

    # نسخة مدمجة (سجل واحد لكل اسم+رقم وظيفي).
    df_for_sort = df.copy()
    df_for_sort["__batch_num"] = pd.to_numeric(df_for_sort["الدفعة_المعتمدة"], errors="coerce")
    df_for_sort["__job_num"] = pd.to_numeric(df_for_sort["الرقم_الوظيفي"], errors="coerce")
    df_for_sort = df_for_sort.sort_values(by=["__batch_num", "__job_num", "الاسم"], ascending=[True, True, True], na_position="last")

    consolidated = (
        df_for_sort.groupby(["الاسم", "الرقم_الوظيفي"], dropna=False, as_index=False)
        .agg(
            {
                "رقم_البطاقة": "first",
                "الدفعة_المعتمدة": "first",
                "الدفعة_الصريحة": "first",
                "الدفعة_المستنتجة": "first",
                "مصدر_الملف": "first",
                "الورقة": "first",
                "رقم_الصف_في_الملف": "first",
            }
        )
        .rename(columns={"الدفعة_المعتمدة": "الدفعة"})
    )

    unresolved = consolidated[consolidated["الدفعة"].astype(str).str.strip() == ""].copy()

    summary_batch = (
        consolidated.assign(الدفعة=consolidated["الدفعة"].replace("", "غير معروف"))
        .groupby("الدفعة", as_index=False)
        .size()
        .rename(columns={"size": "عدد_الأسماء"})
        .sort_values(by="الدفعة")
    )

    summary_source = (
        df.groupby("مصدر_الملف", as_index=False)
        .size()
        .rename(columns={"size": "عدد_السجلات"})
        .sort_values(by="عدد_السجلات", ascending=False)
    )

    failed_df = pd.DataFrame(failed) if failed else pd.DataFrame(columns=["file", "sheet", "error"])

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with pd.ExcelWriter(OUT_FILE, engine="openpyxl") as writer:
        consolidated.to_excel(writer, index=False, sheet_name="الملف_الموحد")
        df.to_excel(writer, index=False, sheet_name="كل_السجلات")
        summary_batch.to_excel(writer, index=False, sheet_name="ملخص_الدفعات")
        unresolved.to_excel(writer, index=False, sheet_name="بدون_دفعة")
        summary_source.to_excel(writer, index=False, sheet_name="ملخص_المصادر")
        failed_df.to_excel(writer, index=False, sheet_name="ملفات_فشل_قراءتها")

    print(f"OUTPUT={OUT_FILE}")
    print(f"TOTAL_RAW={len(df)}")
    print(f"TOTAL_UNIQUE={len(consolidated)}")
    print(f"UNRESOLVED_BATCH={len(unresolved)}")


if __name__ == "__main__":
    main()
