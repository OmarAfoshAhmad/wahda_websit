from __future__ import annotations

import argparse
import re
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd


SEARCH_ROOT = Path(r"C:\Users\Omar\Desktop\شركة وعد")
INPUT_FILE = Path(r"C:\Users\Omar\Downloads\truth-registry-filter-results-2026-05-25-20-09-21.xlsx")
OUTPUT_FILE = INPUT_FILE.with_name(INPUT_FILE.stem + "_enriched.xlsx")

EXCEL_EXTS = {".xlsx", ".xlsm", ".xls"}
CARD_RE = re.compile(r"WAB2025[0-9A-Z]+", re.IGNORECASE)
ARABIC_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")


def norm_text(v: Any) -> str:
    s = str(v or "").strip()
    if s.lower() == "nan":
        return ""
    return re.sub(r"\s+", " ", s)


def normalize_name(v: Any) -> str:
    s = norm_text(v)
    s = s.replace("أ", "ا").replace("إ", "ا").replace("آ", "ا")
    s = s.replace("ى", "ي").replace("ة", "ه")
    return s.upper()


def canonical_card(card: Any) -> str:
    s = norm_text(card).upper().replace(" ", "")
    if not s:
        return ""
    m = re.match(r"^WAB20250*([1-9][0-9]*|0)([A-Z0-9]*)$", s)
    if not m:
        return s
    return f"WAB2025{m.group(1)}{m.group(2) or ''}"


def parse_date_to_key(v: Any) -> str:
    s = norm_text(v).translate(ARABIC_DIGITS)
    if not s:
        return ""
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s[:10], fmt).strftime("%Y-%m-%d")
        except Exception:
            pass
    try:
        d = pd.to_datetime(s, errors="coerce", dayfirst=True)
        if pd.isna(d):
            return ""
        return d.strftime("%Y-%m-%d")
    except Exception:
        return ""


def extract_date_candidates(text: str) -> list[str]:
    t = norm_text(text).translate(ARABIC_DIGITS)
    out: list[str] = []
    patterns = [
        r"\b(\d{4}-\d{1,2}-\d{1,2})\b",
        r"\b(\d{1,2}/\d{1,2}/\d{4})\b",
        r"\b(\d{1,2}-\d{1,2}-\d{4})\b",
    ]
    for pat in patterns:
        for m in re.finditer(pat, t):
            key = parse_date_to_key(m.group(1))
            if key:
                out.append(key)
    return list(dict.fromkeys(out))


def extract_batch(*sources: str) -> str:
    patterns = [
        r"(?:الدفعه|الدفعة|دفعه|دفعة|batch)\s*[:\-]?\s*\(?\s*(\d{1,3})\s*\)?",
        r"(?:^|[\\/\s_\-])(\d{1,2})\s*الصادر",
        r"(?:^|[\\/\s_\-])دفعة\s*(\d{1,3})",
        r"(?:^|[\\/\s_\-])الدفعة\s*(\d{1,3})",
        r"\((\d{1,3})\)",
    ]
    for source in sources:
        txt = norm_text(source).translate(ARABIC_DIGITS)
        if not txt:
            continue
        candidates = [txt]
        try:
            candidates.append(Path(txt).name)
        except Exception:
            pass
        for c in candidates:
            for pat in patterns:
                m = re.search(pat, c, flags=re.IGNORECASE)
                if m:
                    return m.group(1)
    return ""


def is_name_like(cell: str) -> bool:
    s = norm_text(cell)
    if len(s) < 6:
        return False
    if CARD_RE.search(s):
        return False
    if re.search(r"\d", s):
        return False
    if not re.search(r"[A-Za-z\u0600-\u06FF]", s):
        return False
    bad = ["موظف", "موظفة", "زوج", "زوجة", "ابن", "ابنة", "دفعة", "المنظومة", "ملاحظ"]
    return not any(b in s for b in bad)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Enrich truth-registry filter export with source file and batch matches.")
    parser.add_argument("--input", type=str, default=str(INPUT_FILE), help="Input Excel file path.")
    parser.add_argument("--search-root", type=str, default=str(SEARCH_ROOT), help="Root folder to scan for Excel sources.")
    parser.add_argument("--output", type=str, default="", help="Output Excel file path. Default: <input>_enriched.xlsx")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    input_file = Path(args.input)
    search_root = Path(args.search_root)
    output_file = Path(args.output) if args.output else input_file.with_name(input_file.stem + "_enriched.xlsx")

    if not input_file.exists():
        raise FileNotFoundError(f"Input file not found: {input_file}")

    wb = pd.ExcelFile(input_file)
    if "نتائج الفلتر" not in wb.sheet_names:
        raise RuntimeError("Sheet 'نتائج الفلتر' not found.")

    target = pd.read_excel(input_file, sheet_name="نتائج الفلتر")
    target = target.copy()
    target["__card_canonical"] = target["رقم البطاقة"].map(canonical_card)
    target["__name_norm"] = target["الاسم"].map(normalize_name)
    target["__birth_key"] = target["الميلاد"].map(parse_date_to_key)
    target["__name_birth_key"] = target["__name_norm"] + "::" + target["__birth_key"]

    target_card_set = set(x for x in target["__card_canonical"].tolist() if x)
    unresolved_rows = target.index.tolist()

    card_hits: dict[str, list[dict[str, str]]] = {}
    name_birth_hits: dict[str, list[dict[str, str]]] = {}

    excel_files = sorted(
        p for p in search_root.rglob("*")
        if p.is_file() and p.suffix.lower() in EXCEL_EXTS and not p.name.startswith("~$")
    )

    for file_path in excel_files:
        try:
            xls = pd.ExcelFile(file_path)
        except Exception:
            continue

        rel_file = str(file_path.relative_to(search_root))
        for sheet_name in xls.sheet_names:
            try:
                df = pd.read_excel(file_path, sheet_name=sheet_name, header=None, dtype=str).fillna("")
            except Exception:
                continue
            if df.empty:
                continue

            for row_no, row in enumerate(df.itertuples(index=False, name=None), start=1):
                cells = [norm_text(v) for v in row if norm_text(v)]
                if not cells:
                    continue

                row_text = " | ".join(cells)
                batch_guess = extract_batch(row_text, sheet_name, file_path.name, str(file_path.parent))

                # Card-based matching
                found_cards: set[str] = set()
                for cell in cells:
                    up = cell.upper().replace(" ", "")
                    for m in CARD_RE.finditer(up):
                        found_cards.add(m.group(0))

                for found in found_cards:
                    can = canonical_card(found)
                    if can in target_card_set:
                        card_hits.setdefault(can, []).append(
                            {
                                "matched_card": found,
                                "batch": batch_guess,
                                "source_file": rel_file,
                                "source_sheet": sheet_name,
                                "source_row": str(row_no),
                            }
                        )

                # Name+Birth fallback
                dates = extract_date_candidates(row_text)
                if dates:
                    names = [normalize_name(c) for c in cells if is_name_like(c)]
                    if names:
                        for d in dates:
                            for n in names:
                                key = f"{n}::{d}"
                                name_birth_hits.setdefault(key, []).append(
                                    {
                                        "batch": batch_guess,
                                        "source_file": rel_file,
                                        "source_sheet": sheet_name,
                                        "source_row": str(row_no),
                                    }
                                )

    # Apply best hit to each row
    def pick_best_card_hit(can: str) -> dict[str, str] | None:
        hits = card_hits.get(can, [])
        if not hits:
            return None
        # Prefer explicit batch then shortest source path for stability
        hits_sorted = sorted(
            hits,
            key=lambda h: (
                0 if h.get("batch") else 1,
                len(h.get("source_file", "")),
                h.get("source_file", ""),
                h.get("source_sheet", ""),
            ),
        )
        return hits_sorted[0]

    def pick_best_name_birth_hit(key: str) -> dict[str, str] | None:
        hits = name_birth_hits.get(key, [])
        if not hits:
            return None
        hits_sorted = sorted(
            hits,
            key=lambda h: (
                0 if h.get("batch") else 1,
                len(h.get("source_file", "")),
                h.get("source_file", ""),
                h.get("source_sheet", ""),
            ),
        )
        return hits_sorted[0]

    target["الدفعة_المقترحة_من_المصدر"] = ""
    target["مصدر_الملف_المقترح"] = ""
    target["الورقة_المقترحة"] = ""
    target["الصف_المقترح"] = ""
    target["نوع_المطابقة"] = ""
    target["رقم_بطاقة_مطابق_في_المصدر"] = ""

    matched_card_count = 0
    matched_name_birth_count = 0
    unmatched_count = 0

    for idx, row in target.iterrows():
        can = row["__card_canonical"]
        card_hit = pick_best_card_hit(can)
        if card_hit:
            target.at[idx, "الدفعة_المقترحة_من_المصدر"] = card_hit.get("batch", "")
            target.at[idx, "مصدر_الملف_المقترح"] = card_hit.get("source_file", "")
            target.at[idx, "الورقة_المقترحة"] = card_hit.get("source_sheet", "")
            target.at[idx, "الصف_المقترح"] = card_hit.get("source_row", "")
            target.at[idx, "نوع_المطابقة"] = "بطاقة"
            target.at[idx, "رقم_بطاقة_مطابق_في_المصدر"] = card_hit.get("matched_card", "")
            matched_card_count += 1
            continue

        key = row["__name_birth_key"]
        nb_hit = pick_best_name_birth_hit(key)
        if nb_hit:
            target.at[idx, "الدفعة_المقترحة_من_المصدر"] = nb_hit.get("batch", "")
            target.at[idx, "مصدر_الملف_المقترح"] = nb_hit.get("source_file", "")
            target.at[idx, "الورقة_المقترحة"] = nb_hit.get("source_sheet", "")
            target.at[idx, "الصف_المقترح"] = nb_hit.get("source_row", "")
            target.at[idx, "نوع_المطابقة"] = "اسم+ميلاد"
            matched_name_birth_count += 1
            continue

        unmatched_count += 1

    report = pd.DataFrame(
        [
            {"المؤشر": "إجمالي_السجلات", "القيمة": len(target)},
            {"المؤشر": "مطابقة_بالبطاقة", "القيمة": matched_card_count},
            {"المؤشر": "مطابقة_بالاسم_والميلاد", "القيمة": matched_name_birth_count},
            {"المؤشر": "بدون_مطابقة", "القيمة": unmatched_count},
            {"المؤشر": "عدد_ملفات_Excel_المفحوصة", "القيمة": len(excel_files)},
        ]
    )

    # Drop internal columns
    output_main = target.drop(columns=["__card_canonical", "__name_norm", "__birth_key", "__name_birth_key"])
    filters_sheet = pd.read_excel(input_file, sheet_name="بيانات التصفية") if "بيانات التصفية" in wb.sheet_names else pd.DataFrame()

    with pd.ExcelWriter(output_file, engine="openpyxl") as writer:
        output_main.to_excel(writer, index=False, sheet_name="نتائج الفلتر")
        if not filters_sheet.empty:
            filters_sheet.to_excel(writer, index=False, sheet_name="بيانات التصفية")
        report.to_excel(writer, index=False, sheet_name="تقرير_الإثراء")

    print(f"OUTPUT={output_file}")
    print(f"TOTAL={len(target)}")
    print(f"MATCH_CARD={matched_card_count}")
    print(f"MATCH_NAME_BIRTH={matched_name_birth_count}")
    print(f"UNMATCHED={unmatched_count}")
    print(f"FILES_SCANNED={len(excel_files)}")


if __name__ == "__main__":
    main()
