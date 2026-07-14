import { NextResponse } from "next/server";
import { requireActiveFacilitySession } from "@/lib/session-guard";
import ExcelJS from "exceljs";

export async function GET() {
  const session = await requireActiveFacilitySession();
  if (!session?.is_admin) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("قالب المرافق");

  sheet.views = [{ rightToLeft: true }];

  sheet.columns = [
    { header: "اسم المرفق", key: "name", width: 30 },
    { header: "اسم المستخدم", key: "username", width: 25 },
  ];

  // تنسيق رأس الأعمدة
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, size: 12 };
  headerRow.alignment = { horizontal: "center" };

  // صفوف توضيحية
  sheet.addRow({ name: "مستشفى المركز", username: "hospital_central" });
  sheet.addRow({ name: "عيادة الشمال", username: "clinic_north" });

  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition":
        'attachment; filename="facility_template.xlsx"; filename*=UTF-8\'\'%D9%82%D8%A7%D9%84%D8%A8_%D8%A7%D8%B3%D8%AA%D9%8A%D8%B1%D8%A7%D8%AF_%D8%A7%D9%84%D9%85%D8%B1%D8%A7%D9%81%D9%82.xlsx',
    },
  });
}
