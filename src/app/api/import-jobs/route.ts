import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireActiveFacilitySession } from "@/lib/session-guard";
import { createImportJob } from "@/lib/import-jobs";

// MIME types المقبولة صراحةً لملفات Excel — لا نقبل octet-stream
// التحقق الفعلي يعتمد على extension + محتوى الملف داخل ExcelJS
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
    return NextResponse.json({ error: "ممنوع — المشرفون فقط" }, { status: 403 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "لم يتم إرسال ملف صالح." }, { status: 400 });
    }

    // التحقق من نوع الملف على الخادم
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["xlsx", "xls"].includes(ext ?? "") && !ALLOWED_MIME.includes(file.type)) {
      return NextResponse.json({ error: "نوع الملف غير مدعوم. الرجاء رفع ملف Excel (.xlsx أو .xls)" }, { status: 400 });
    }

    // حد أقصى لحجم الملف: 10 MB
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "حجم الملف يتجاوز الحد المسموح به (10 ميجابايت)." }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const workbook = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(Buffer.from(arrayBuffer) as any);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      return NextResponse.json({ error: "ملف Excel لا يحتوي على أي ورقة عمل." }, { status: 400 });
    }

    // استخراج الصفوف كـ objects باستخدام الصف الأول كعناوين
    const headerRow = worksheet.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell((cell) => {
      headers.push(String(cell.value ?? "").trim());
    });

    const rows: Record<string, unknown>[] = [];
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // تخطي صف العناوين
      const obj: Record<string, unknown> = { __rowNumber: rowNumber };
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const header = headers[colNumber - 1];
        if (header) {
          const v = cell.value;
          // تحويل كائنات التاريخ إلى ISO string
          obj[header] = v instanceof Date ? v.toISOString() : v;
        }
      });
      // تخطي الصفوف الفارغة تماماً
      if (Object.values(obj).some((v) => v !== null && v !== undefined && v !== "")) {
        rows.push(obj);
      }
    });

    const result = await createImportJob(rows, session.username);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result, { status: 201 });
  } catch {
    return NextResponse.json({ error: "فشل في قراءة ملف Excel على الخادم." }, { status: 400 });
  }
}