const { PrismaClient } = require("@prisma/client");
const ExcelJS = require("exceljs");
const path = require("path");
const p = new PrismaClient();

async function main() {
  // قراءة ملف طرابلس
  const filePath = path.join("C:\\Users\\Omar\\draft\\area", "طرابلس.xlsx");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];

  const excelRows = [];
  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const vals = row.values;
    excelRows.push({
      cardNumber: String(vals[1] ?? "").trim(),
      name: String(vals[2] ?? "").trim(),
      familyCount: Number(vals[3]) || 0,
      totalBalance: Number(vals[4]) || 0,
      usedBalance: Number(vals[5]) || 0,
    });
  });

  // عينة: أول 20 أسرة من الملف مع عدد أفراد > 1 
  const multiMember = excelRows.filter(r => r.familyCount > 1).slice(0, 20);

  let mismatchCount = 0;
  let matchCount = 0;
  
  console.log("=== مقارنة عدد أفراد الأسر بين الملف وقاعدة البيانات ===\n");
  
  for (const row of multiMember) {
    const dbFamily = await p.beneficiary.findMany({
      where: { card_number: { startsWith: row.cardNumber }, deleted_at: null },
      select: { card_number: true },
    });

    const dbDeleted = await p.beneficiary.count({
      where: { card_number: { startsWith: row.cardNumber }, deleted_at: { not: null } },
    });

    const status = dbFamily.length === row.familyCount ? "✓" : "✗";
    if (dbFamily.length !== row.familyCount) mismatchCount++;
    else matchCount++;

    console.log(`${status} ${row.cardNumber} | ${row.name}`);
    console.log(`    ملف: ${row.familyCount} أفراد، رصيد كلي: ${row.totalBalance}`);
    console.log(`    قاعدة البيانات: ${dbFamily.length} أفراد (محذوفين: ${dbDeleted})`);
    if (dbFamily.length !== row.familyCount) {
      console.log(`    ⚠️  فرق: ${row.familyCount - dbFamily.length} فرد ناقص!`);
    }
    console.log();
  }

  console.log(`\n=== ملخص: ${matchCount} متطابق، ${mismatchCount} مختلف من أصل ${multiMember.length} ===`);

  // إحصائية شاملة على كل الملف
  console.log("\n=== تحليل شامل لملف طرابلس ===");
  let totalMismatch = 0;
  let totalMatch = 0;
  let totalMissing = 0;
  
  for (const row of excelRows) {
    if (row.familyCount <= 1) continue;
    const dbCount = await p.beneficiary.count({
      where: { card_number: { startsWith: row.cardNumber }, deleted_at: null },
    });
    if (dbCount === row.familyCount) {
      totalMatch++;
    } else if (dbCount === 0) {
      totalMissing++;
    } else {
      totalMismatch++;
    }
  }
  console.log(`  متطابق: ${totalMatch}`);
  console.log(`  غير متطابق (أفراد ناقصون): ${totalMismatch}`);
  console.log(`  غير موجود أصلاً: ${totalMissing}`);

  await p.$disconnect();
}

main().catch(console.error);
