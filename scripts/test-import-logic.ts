import { importOpticsTransactionsAction } from "@/app/actions/import-optics-transactions";
import ExcelJS from "exceljs";

async function main() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  
  ws.columns = [
    { header: "الاسم", key: "name" },
    { header: "رقم البطاقة", key: "card" },
    { header: "موافقة", key: "approval" },
    { header: "التاريخ", key: "date" },
    { header: "المبلغ", key: "amount" },
    { header: "المرفق", key: "facility" }
  ];

  // Using the exact row that failed in the screenshot
  ws.addRow({
    name: "احمد موسي علي موسي",
    card: "WAB2025105968",
    approval: "123",
    date: new Date("2026-06-21"),
    amount: 400.00,
    facility: "شركة ساطي للبصريات"
  });

  const buffer = await wb.xlsx.writeBuffer();
  const base64 = buffer.toString("base64");

  // Wahda Bank Company ID
  const companyId = "cmp7ha2km0000u9v8jse4ib5x";

  const result = await importOpticsTransactionsAction(
    base64,
    false, // purgeOld
    true, // dryRun
    companyId,
    true // autoCreateMissing
  );

  console.log(JSON.stringify(result, null, 2));
}

main().catch(console.error);
