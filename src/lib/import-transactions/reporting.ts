import ExcelJS from "exceljs";
import { NotFoundRow } from "./types";

export async function generateNotFoundWorkbook(notFoundRows: NotFoundRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("غير موجودين");

  ws.addRow(["رقم البطاقة", "الاسم", "عدد الأفراد", "الرصيد الكلي", "الرصيد المستخدم", "رقم الصف في الملف"]);

  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { horizontal: "center" };

  for (const row of notFoundRows) {
    ws.addRow([row.cardNumber, row.name, row.familyCount, row.totalBalance, row.usedBalance, row.rowNumber]);
  }

  ws.columns.forEach((col) => {
    col.width = 25;
  });

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
