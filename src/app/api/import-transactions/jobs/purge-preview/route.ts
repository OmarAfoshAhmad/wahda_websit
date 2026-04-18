import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireActiveFacilitySession } from "@/lib/session-guard";
import { estimateTransactionImportPurgePreview } from "@/lib/import-transactions";

const ALLOWED_MIME = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
];

export async function POST(request: Request) {
  const session = await requireActiveFacilitySession();
  if (!session) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  }
  if (!session.is_admin) {
    return NextResponse.json({ error: "ممنوع — المبرمجون فقط" }, { status: 403 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const replaceOldImportsRaw = String(formData.get("replace_old_imports") ?? "true").toLowerCase();
    const replaceOldImports = replaceOldImportsRaw !== "false";
    const purgeMissingFamiliesRaw = String(formData.get("purge_missing_families") ?? "false").toLowerCase();
    const purgeMissingFamilies = purgeMissingFamiliesRaw === "true";

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "لم يتم إرسال ملف صالح." }, { status: 400 });
    }

    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["xlsx", "xls"].includes(ext ?? "") && !ALLOWED_MIME.includes(file.type)) {
      return NextResponse.json({ error: "نوع الملف غير مدعوم. الرجاء رفع ملف Excel (.xlsx أو .xls)" }, { status: 400 });
    }

    if (ext === "xls") {
      return NextResponse.json(
        { error: "صيغة .xls غير مدعومة في هذا المسار. الرجاء تحويل الملف إلى .xlsx ثم إعادة المحاولة." },
        { status: 400 },
      );
    }

    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "حجم الملف يتجاوز الحد المسموح به (10 ميجابايت)." }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // تحقق سريع من سلامة الملف
    const wb = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load(buffer as any);
    if (!wb.worksheets[0]) {
      return NextResponse.json({ error: "ملف Excel لا يحتوي على أي ورقة عمل." }, { status: 400 });
    }

    const preview = await estimateTransactionImportPurgePreview(buffer, session.username, undefined, {
      replaceOldImports,
      purgeMissingFamilies,
    });

    return NextResponse.json({ preview }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "تعذر حساب معاينة التنظيف." }, { status: 400 });
  }
}
