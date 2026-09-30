import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { requireActiveFacilitySession } from "@/lib/session-guard";
import { createImportJob, type ImportOptions } from "@/lib/import-jobs";
import { assertCompanyAccessForSession } from "@/lib/company-scope";
import { hasPermission } from "@/lib/permissions";

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
  if (!hasPermission(session, "import_beneficiaries")) {
    return NextResponse.json({ error: "لا تملك صلاحية استيراد المستفيدين" }, { status: 403 });
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
    const workbook = XLSX.read(Buffer.from(arrayBuffer), {
      type: "buffer",
      cellDates: false,
    });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = firstSheetName ? workbook.Sheets[firstSheetName] : undefined;
    if (!worksheet) {
      return NextResponse.json({ error: "ملف Excel لا يحتوي على أي ورقة عمل." }, { status: 400 });
    }

    // raw:false يحافظ على عرض التواريخ كما هو في Excel ويمنع انزياح اليوم بسبب المنطقة الزمنية.
    const parsedRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
      defval: null,
      raw: false,
    });
    const rows = parsedRows.map((row, index) => ({ ...row, __rowNumber: index + 2 }));

    // قراءة خيارات الاستيراد من FormData
    const companyIdParam = formData.get("company_id");
    const companyId = typeof companyIdParam === "string" ? companyIdParam.trim() : "";
    if (!companyId && session.role_v2 !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "يجب تحديد الشركة قبل الاستيراد" }, { status: 400 });
    }
    if (companyId) await assertCompanyAccessForSession(session, companyId);
    const options: ImportOptions = {
      updateBalance: formData.get("updateBalance") === "true",
      reactivate: formData.get("reactivate") === "true",
      wipeInactive: formData.get("wipeInactive") === "true",
      ...(companyId ? { company_id: companyId } : {}),
    };

    const result = await createImportJob(rows, session.username, options);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error("[api/import-jobs]", error);
    return NextResponse.json({ error: "فشل في قراءة ملف Excel على الخادم." }, { status: 400 });
  }
}
