import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getSession } from "@/lib/auth";
import { processTransactionImport } from "@/lib/import-transactions";

const ALLOWED_MIME = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
];

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  }
  if (!session.is_admin) {
    return NextResponse.json({ error: "ممنوع — المشرفون فقط" }, { status: 403 });
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

    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "حجم الملف يتجاوز الحد المسموح به (10 ميجابايت)." }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Validate it's a valid Excel file
    const testWb = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await testWb.xlsx.load(buffer as any);
    if (!testWb.worksheets[0]) {
      return NextResponse.json({ error: "ملف Excel لا يحتوي على أي ورقة عمل." }, { status: 400 });
    }

    const { result, error } = await processTransactionImport(buffer, session.username);

    if (error) {
      return NextResponse.json({ error }, { status: 400 });
    }

    return NextResponse.json({ result }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "فشل في قراءة أو معالجة ملف Excel." }, { status: 400 });
  }
}
