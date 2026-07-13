const ExcelJS = require('exceljs');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function createMappingExcel() {
  const facilities = [
    "اطلس", "اوكسحين", "فيزو كير", "ابن سينا", "فيزوكير",
    "أطلس", "الشفاء", "مصحة الحكيم", "اوكسجين", "أكسجين",
    "أوكسجين", "بنغازي التخصصي", "منارة المستقبل", "اكسجين",
    "مصحه الحكيم", "مصحة المسرة", "عيادة ماريا", "مركز بداية",
    "شركه الاكسجين", "مركز الشفاء", "باب  الشفاء"
  ];

  const proposals = {
    "ابن سينا": "مستشفى ابن سينا التخصصية",
    "بنغازي التخصصي": "مستشفى بنغازي التخصصي",
    "منارة المستقبل": "مصحة منارة المستقبل",
    "باب  الشفاء": "مستشفى باب الشفاء",
    "الشفاء": "مركز الشفاء الطبي",
    "مركز الشفاء": "مركز الشفاء الطبي",
    "مصحة الحكيم": "مصحة الحكيم",
    "مصحه الحكيم": "مصحة الحكيم",
    "فيزو كير": "فيزو كير",
    "فيزوكير": "فيزو كير",
    "اطلس": "أطلس",
    "أطلس": "أطلس",
    "أكسجين": "أكسجين",
    "أوكسجين": "أكسجين",
    "اكسجين": "أكسجين",
    "اوكسجين": "أكسجين",
    "اوكسحين": "أكسجين",
    "شركه الاكسجين": "أكسجين",
    "مصحة المسرة": "مصحة المسرة",
    "عيادة ماريا": "عيادة ماريا",
    "مركز بداية": "مركز بداية"
  };

  const dbFacilities = await prisma.facility.findMany({ select: { name: true } });
  const dbNames = dbFacilities.map(f => f.name);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('المطابقة');

  ws.columns = [
    { header: 'الاسم الموجود في ملفات الحركات (لا تعدل هذا العمود)', key: 'original', width: 45 },
    { header: 'الاسم الموحد للمنظومة (اكتب الاسم الصحيح هنا)', key: 'standard', width: 45 },
    { header: 'حالة المرفق في المنظومة حالياً', key: 'status', width: 35 }
  ];

  // Header styling
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0D9488" } };
  headerRow.alignment = { horizontal: "center", vertical: "middle" };
  headerRow.height = 30;

  for (const f of facilities) {
    const standardName = proposals[f] || f;
    const isExists = dbNames.includes(standardName);
    
    const row = ws.addRow({
      original: f,
      standard: standardName,
      status: isExists ? "✅ موجود في المنظومة (جاهز)" : "❌ غير موجود (يحتاج إضافة)"
    });

    if (!isExists) {
      row.getCell('status').font = { color: { argb: "FFDC2626" }, bold: true };
    } else {
      row.getCell('status').font = { color: { argb: "FF16A34A" }, bold: true };
    }
  }

  // Freeze header
  ws.views = [{ state: "frozen", ySplit: 1, rightToLeft: true }];

  await wb.xlsx.writeFile('c:\\Users\\Omar\\waad_temp_website\\مطابقة_المرافق.xlsx');
  console.log('Created c:\\Users\\Omar\\waad_temp_website\\مطابقة_المرافق.xlsx');
}

createMappingExcel().catch(console.error).finally(() => prisma.$disconnect());
