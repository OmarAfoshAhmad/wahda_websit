/**
 * المستفيدون الذين رصيدهم الكلي = 0 ولا توجد لديهم أي حركة (استيراد أو خصم)
 * أي أنهم دخلوا النظام برصيد صفر من البداية.
 */

const { PrismaClient } = require("@prisma/client");
const ExcelJS = require("exceljs");
const path = require("path");

const prisma = new PrismaClient();

async function main() {
  console.log("جارٍ البحث عن المستفيدين برصيد 0 بدون أي حركة...");

  // المستفيدون الفعّالون (غير محذوفين) برصيد كلي = 0 وليس لديهم أي حركة فعّالة
  const rows = await prisma.$queryRaw`
    SELECT
      b.card_number,
      b.name,
      b.status,
      b.total_balance::float8    AS total_balance,
      b.remaining_balance::float8 AS remaining_balance,
      b.created_at,
      b.completed_via,
      COALESCE(tx.tx_count, 0)::int AS tx_count
    FROM "Beneficiary" b
    LEFT JOIN (
      SELECT beneficiary_id, COUNT(*) AS tx_count
      FROM "Transaction"
      GROUP BY beneficiary_id
    ) tx ON tx.beneficiary_id = b.id
    WHERE b.deleted_at IS NULL
      AND b.total_balance = 0
      AND COALESCE(tx.tx_count, 0) = 0
    ORDER BY b.card_number ASC
  `;

  console.log(`عدد السجلات: ${rows.length}`);

  if (rows.length === 0) {
    console.log("لا يوجد مستفيدون يطابقون الشرط.");
    return;
  }

  // إنشاء ملف Excel
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "WAAD";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("رصيد صفر بلا حركات", {
    views: [{ rightToLeft: true }],
  });

  sheet.columns = [
    { header: "رقم البطاقة",    key: "card_number",       width: 22 },
    { header: "الاسم",           key: "name",               width: 35 },
    { header: "الحالة",          key: "status",             width: 12 },
    { header: "الرصيد الكلي",   key: "total_balance",      width: 14 },
    { header: "الرصيد المتبقي", key: "remaining_balance",  width: 14 },
    { header: "عدد الحركات",    key: "tx_count",           width: 14 },
    { header: "اكتمل عبر",      key: "completed_via",      width: 14 },
    { header: "تاريخ الإنشاء",  key: "created_at",         width: 22 },
  ];

  // تنسيق رأس الجدول
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
  headerRow.alignment = { horizontal: "center", vertical: "middle" };
  headerRow.height = 20;

  for (const row of rows) {
    sheet.addRow({
      card_number:       row.card_number,
      name:              row.name,
      status:            row.status,
      total_balance:     Number(row.total_balance),
      remaining_balance: Number(row.remaining_balance),
      tx_count:          Number(row.tx_count),
      completed_via:     row.completed_via ?? "—",
      created_at:        row.created_at
        ? new Date(row.created_at).toLocaleString("ar-LY")
        : "—",
    });
  }

  // تلوين صفوف البيانات تبادلياً
  for (let i = 2; i <= sheet.rowCount; i++) {
    const r = sheet.getRow(i);
    r.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: i % 2 === 0 ? "FFF1F5F9" : "FFFFFFFF" },
    };
    r.alignment = { horizontal: "right" };
  }

  // حفظ الملف
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outPath = path.join(__dirname, "..", "reports", `zero-balance-no-tx-${timestamp}.xlsx`);
  await workbook.xlsx.writeFile(outPath);

  console.log(`\nتم حفظ الملف: ${outPath}`);
  console.log(`إجمالي السجلات: ${rows.length}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
