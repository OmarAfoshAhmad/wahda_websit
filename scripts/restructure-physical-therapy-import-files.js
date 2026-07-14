const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const ROOT = path.resolve(__dirname, '..');
const INPUT_DIR = path.join(ROOT, 'حركات الشركات للعلاج الطبيعي - مصححة');
const OUTPUT_DIR = path.join(ROOT, 'حركات الشركات للعلاج الطبيعي - مصححة ومهيكلة');
const REPORT_FILE = path.join(OUTPUT_DIR, 'تقرير إعادة هيكلة حركات العلاج الطبيعي.xlsx');

const HEADERS = [
  'اسم المريض',
  'رقم التأمين',
  'رقم الموافقة',
  'القيمة المالية',
  'التاريخ',
  'المرفق الصحي',
  'عدد الجلسات',
  'ملاحظات',
];

function clean(value) {
  return String(value ?? '').replace(/\u00a0/g, ' ').trim();
}

function extractSessions(value) {
  const text = clean(value);
  const match = text.match(/(\d+(?:\.\d+)?)\s*جلس/) || text.match(/^(\d+(?:\.\d+)?)$/);
  const sessions = match ? Number(match[1]) : Number.NaN;
  if (!Number.isInteger(sessions) || sessions <= 0) return null;
  return sessions;
}

function extractNotes(value) {
  const text = clean(value);
  if (!text || /^\d+(?:\.\d+)?$/.test(text)) return '';
  return text
    .replace(/^\d+(?:\.\d+)?\s*جلس(?:ة|ات)?\s*/u, '')
    .replace(/^[-–—:،؛\s]+/u, '')
    .trim();
}

function styleHeader(row) {
  row.height = 28;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', readingOrder: 'rtl' };
  });
}

function styleDataRow(row) {
  row.eachCell((cell) => {
    cell.alignment = { vertical: 'middle', readingOrder: 'rtl' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFD9E2F3' } },
      left: { style: 'thin', color: { argb: 'FFD9E2F3' } },
      bottom: { style: 'thin', color: { argb: 'FFD9E2F3' } },
      right: { style: 'thin', color: { argb: 'FFD9E2F3' } },
    };
  });
}

async function restructureFile(file) {
  const inputPath = path.join(INPUT_DIR, file);
  const outputPath = path.join(OUTPUT_DIR, file);
  const input = new ExcelJS.Workbook();
  await input.xlsx.readFile(inputPath);
  const inputSheet = input.worksheets[0];
  if (!inputSheet) throw new Error(`لا توجد ورقة عمل في ${file}`);

  const output = new ExcelJS.Workbook();
  output.creator = 'WAAD import restructuring';
  output.created = new Date();
  const sheet = output.addWorksheet(inputSheet.name || 'العلاج الطبيعي', {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }],
  });
  sheet.addRow(HEADERS);
  styleHeader(sheet.getRow(1));

  let movements = 0;
  let financialTotal = 0;
  let sessionTotal = 0;
  let notesCount = 0;

  for (let rowNumber = 2; rowNumber <= inputSheet.rowCount; rowNumber += 1) {
    const source = inputSheet.getRow(rowNumber);
    const name = clean(source.getCell(1).value);
    const insurance = clean(source.getCell(2).value);
    const approval = clean(source.getCell(3).value);
    const financialValue = Number(source.getCell(4).value);
    const date = source.getCell(5).value;
    const facility = clean(source.getCell(6).value);
    const sessionSource = source.getCell(7).value;

    // ملفات المصدر تحتوي صفوف قوالب تلقائية بعد آخر حركة (بطاقة/موافقة وصفر بلا اسم أو تاريخ).
    if (!name && !date) continue;
    const sessions = extractSessions(sessionSource);
    if (sessions === null) {
      throw new Error(`عدد الجلسات غير صالح في ${file}، الصف ${rowNumber}: ${clean(sessionSource)}`);
    }
    if (!name || !insurance || !date || !Number.isFinite(financialValue)) {
      throw new Error(`بيانات أساسية ناقصة في ${file}، الصف ${rowNumber}`);
    }

    const notes = extractNotes(sessionSource);
    const target = sheet.addRow([
      name,
      insurance,
      approval,
      financialValue,
      date,
      facility,
      sessions,
      notes,
    ]);
    if (date instanceof Date) target.getCell(5).numFmt = 'yyyy-mm-dd';
    target.getCell(4).numFmt = '0.00';
    target.getCell(7).numFmt = '0';
    styleDataRow(target);

    if (target.number !== rowNumber) {
      throw new Error(`تغير رقم الصف في ${file}: ${rowNumber} أصبح ${target.number}`);
    }
    movements += 1;
    financialTotal += financialValue;
    sessionTotal += sessions;
    if (notes) notesCount += 1;
  }

  sheet.autoFilter = { from: 'A1', to: `H${Math.max(1, sheet.rowCount)}` };
  sheet.columns = [
    { width: 36 }, { width: 24 }, { width: 18 }, { width: 17 },
    { width: 17 }, { width: 30 }, { width: 16 }, { width: 48 },
  ];
  await output.xlsx.writeFile(outputPath);

  return { file, movements, financialTotal, sessionTotal, notesCount };
}

async function writeReport(stats) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('التحقق', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  sheet.addRow(['ملف الشركة', 'عدد الحركات', 'مجموع القيمة المالية', 'مجموع الجلسات', 'حركات لها ملاحظات', 'الحالة']);
  styleHeader(sheet.getRow(1));
  for (const stat of stats) {
    sheet.addRow([stat.file, stat.movements, stat.financialTotal, stat.sessionTotal, stat.notesCount, 'جاهز للاستيراد']);
  }
  sheet.addRow([
    'الإجمالي',
    stats.reduce((sum, item) => sum + item.movements, 0),
    stats.reduce((sum, item) => sum + item.financialTotal, 0),
    stats.reduce((sum, item) => sum + item.sessionTotal, 0),
    stats.reduce((sum, item) => sum + item.notesCount, 0),
    'تم التحقق',
  ]);
  sheet.columns = [{ width: 38 }, { width: 18 }, { width: 23 }, { width: 18 }, { width: 22 }, { width: 22 }];
  await workbook.xlsx.writeFile(REPORT_FILE);
}

async function verifyOutputs(files, expectedStats) {
  let movements = 0;
  let sessions = 0;
  for (const file of files) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path.join(OUTPUT_DIR, file));
    const sheet = workbook.worksheets[0];
    const headers = [];
    sheet.getRow(1).eachCell((cell) => headers.push(clean(cell.value)));
    if (JSON.stringify(headers) !== JSON.stringify(HEADERS)) throw new Error(`رؤوس أعمدة غير صحيحة في ${file}`);
    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      const sessionCount = Number(row.getCell(7).value);
      if (!Number.isInteger(sessionCount) || sessionCount <= 0) throw new Error(`جلسات غير صالحة بعد التوليد: ${file} صف ${rowNumber}`);
      movements += 1;
      sessions += sessionCount;
    }
  }
  const expectedMovements = expectedStats.reduce((sum, item) => sum + item.movements, 0);
  const expectedSessions = expectedStats.reduce((sum, item) => sum + item.sessionTotal, 0);
  if (movements !== expectedMovements || sessions !== expectedSessions) {
    throw new Error(`فشل تحقق الإجماليات: ${movements}/${expectedMovements} حركة، ${sessions}/${expectedSessions} جلسة`);
  }
  return { movements, sessions };
}

async function main() {
  if (!fs.existsSync(INPUT_DIR)) throw new Error(`مجلد المصدر غير موجود: ${INPUT_DIR}`);
  if (fs.existsSync(OUTPUT_DIR)) throw new Error(`مجلد الناتج موجود مسبقاً: ${OUTPUT_DIR}`);
  fs.mkdirSync(OUTPUT_DIR, { recursive: false });

  const files = fs.readdirSync(INPUT_DIR).filter((file) => /_Transactions_PT\.xlsx$/i.test(file)).sort();
  if (!files.length) throw new Error('لم يتم العثور على ملفات شركات العلاج الطبيعي');
  const stats = [];
  for (const file of files) stats.push(await restructureFile(file));
  await writeReport(stats);
  const verification = await verifyOutputs(files, stats);

  console.log(JSON.stringify({ outputDir: OUTPUT_DIR, companyFiles: files.length, ...verification, stats }, null, 2));
}

main().catch((error) => {
  console.error(`[ERROR] ${error.message}`);
  process.exitCode = 1;
});
