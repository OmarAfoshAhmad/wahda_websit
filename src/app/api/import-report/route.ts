import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireActiveFacilitySession } from "@/lib/session-guard";
import { processLegacyTransactionsImport } from "@/lib/import-report";

const ALLOWED_MIME = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
];

function toReadableImportError(error: unknown): string {
  if (error instanceof Error) {
    const lower = error.message.toLowerCase();
    if (error.message.includes("WAAD_FACILITY_ID")) {
      return "إعدادات الخادم غير مكتملة: WAAD_FACILITY_ID غير مضبوط.";
    }
    if (lower.includes("non-existing facility") || lower.includes("transaction_facility_id_fkey")) {
      return "معرّف المرفق المخصص للاستيراد غير صحيح أو غير موجود في قاعدة البيانات.";
    }
    if (lower.includes("invalid signature") || lower.includes("can't find end of central directory")) {
      return "الملف ليس بصيغة Excel .xlsx صالحة. افتحه في Excel ثم احفظه كـ .xlsx وأعد الرفع.";
    }
    return `فشل في معالجة الملف: ${error.message}`;
  }
  return "فشل في قراءة أو معالجة ملف Excel.";
}

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

    const testWb = new ExcelJS.Workbook();
    await testWb.xlsx.load(buffer as unknown as Parameters<typeof testWb.xlsx.load>[0]);
    if (!testWb.worksheets[0]) {
      return NextResponse.json({ error: "ملف Excel لا يحتوي على أي ورقة عمل." }, { status: 400 });
    }

    const { result, error } = await processLegacyTransactionsImport(buffer, session.username);
    if (error) {
      return NextResponse.json({ error }, { status: 400 });
    }

    return NextResponse.json({ result }, { status: 200 });
  } catch (error) {
    console.error("[import-report] Failed to import file", error);
    return NextResponse.json({ error: toReadableImportError(error) }, { status: 400 });
  }
}
