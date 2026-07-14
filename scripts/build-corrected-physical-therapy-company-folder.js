const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');

const ROOT = path.resolve(__dirname, '..');
const INPUT_DIR = path.join(ROOT, 'حركات الشركات للعلاج الطبيعي');
const VERIFICATION_FILE = path.join(ROOT, 'date-correction-imports', 'تحقق تواريخ حركات العلاج الطبيعي.xlsx');
const OUTPUT_DIR = path.join(ROOT, 'حركات الشركات للعلاج الطبيعي - مصححة');
const APPLIED_FILE = path.join(OUTPUT_DIR, 'تصحيحات العلاج الطبيعي المطبقة.xlsx');
const STATISTICS_FILE = path.join(OUTPUT_DIR, 'STATISTICS_CORRECTED_PT.xlsx');

const COLORS = {
  header: '1F4E78',
  headerText: 'FFFFFF',
  corrected: 'DDEBF7',
  skipped: 'FFF2CC',
};

function clean(value) {
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    if (value.result !== undefined && value.result !== null) value = value.result;
    else if (value.text !== undefined && value.text !== null) value = value.text;
    else if (Array.isArray(value.richText)) value = value.richText.map(part => part.text || '').join('');
  }
  return String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeCode(value) {
  return clean(value).toUpperCase().replace(/\s+/g, '');
}

function normalizeArabic(value) {
  return clean(value).toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
}

function numeric(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : Number.NaN;
  const parsed = Number(clean(value).replace(/,/g, '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function validIso(value) {
  const str = clean(value);
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return '';
  return str;
}

function isoDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
  }
  const str = clean(value);
  let match = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) return validIso(`${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`);
  match = str.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (match) {
    const year = match[3].length === 2 ? `20${match[3]}` : match[3];
    return validIso(`${year}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`);
  }
  return '';
}

function findColumnsFromValues(values) {
  const headers = values.map(clean);
  return {
    name: headers.findIndex(value => value.includes('اسم المريض')),
    insurance: headers.findIndex(value => value.includes('رقم التأمين') || value.includes('رقم التامين')),
    approval: headers.findIndex(value => value.includes('رقم الموافقة')),
    amount: headers.findIndex(value => value.includes('القيمة المالية')),
    date: headers.findIndex(value => value.includes('التاريخ')),
    facility: headers.findIndex(value => value.includes('المرفق') || value.includes('الجهة') || value.includes('الجيهة')),
    notes: headers.findIndex(value => value.includes('ملاحظات')),
  };
}

function findExcelJsColumns(worksheet) {
  const values = [];
  for (let column = 1; column <= worksheet.columnCount; column += 1) values.push(worksheet.getRow(1).getCell(column).value);
  const zeroBased = findColumnsFromValues(values);
  const columns = Object.fromEntries(Object.entries(zeroBased).map(([key, index]) => [key, index + 1]));
  for (const key of ['name', 'insurance', 'approval', 'amount', 'date', 'facility', 'notes']) {
    if (columns[key] <= 0) throw new Error(`العمود ${key} غير موجود في ${worksheet.name}`);
  }
  return columns;
}

function loadDecisions() {
  const workbook = XLSX.readFile(VERIFICATION_FILE, { cellDates: false });
  const decisions = [];
  for (const sheetName of ['تصحيحات مؤكدة', 'مراجعة يدوية']) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) throw new Error(`ورقة ${sheetName} غير موجودة في ملف التحقق`);
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
    rows.forEach((row, index) => {
      const currentDate = validIso(row['التاريخ الحالي']);
      const correctedDate = validIso(row['التاريخ المقترح']);
      const decision = {
        verificationSheet: sheetName,
        verificationRow: index + 2,
        name: clean(row['اسم المريض']),
        insurance: clean(row['رقم التأمين']),
        approval: clean(row['رقم الموافقة']),
        amount: numeric(row['القيمة المالية']),
        currentDate,
        correctedDate,
        file: clean(row['ملف الشركة']),
        outputRow: Number(row['صف ملف الشركة']),
        sourceRow: Number(row['صف المصدر']),
        sourceCell: clean(row['خلية المصدر']),
        reason: clean(row['سبب التصنيف']),
      };
      if (!decision.file || !Number.isInteger(decision.outputRow) || decision.outputRow < 2) {
        throw new Error(`مرجع ملف أو صف غير صالح في ${sheetName}، صف ${index + 2}`);
      }
      if (!currentDate || !correctedDate || !Number.isFinite(decision.amount)) {
        throw new Error(`تاريخ أو مبلغ غير صالح في ${sheetName}، صف ${index + 2}`);
      }
      decisions.push(decision);
    });
  }

  const seen = new Map();
  for (const decision of decisions) {
    const key = `${decision.file}|${decision.outputRow}`;
    const prior = seen.get(key);
    if (prior && prior.correctedDate !== decision.correctedDate) {
      throw new Error(`تاريخان متعارضان للصف ${key}`);
    }
    seen.set(key, decision);
  }
  return {
    applied: decisions.filter(decision => decision.currentDate !== decision.correctedDate),
    unchanged: decisions.filter(decision => decision.currentDate === decision.correctedDate),
  };
}

function validateDecisionAgainstRow(decision, row, columns) {
  const actual = {
    name: clean(row.getCell(columns.name).value),
    insurance: clean(row.getCell(columns.insurance).value),
    approval: clean(row.getCell(columns.approval).value),
    amount: numeric(row.getCell(columns.amount).value),
    date: isoDate(row.getCell(columns.date).value),
  };
  const mismatches = [];
  if (normalizeArabic(actual.name) !== normalizeArabic(decision.name)) mismatches.push('الاسم');
  if (normalizeCode(actual.insurance) !== normalizeCode(decision.insurance)) mismatches.push('رقم التأمين');
  if (normalizeCode(actual.approval) !== normalizeCode(decision.approval)) mismatches.push('رقم الموافقة');
  if (Math.abs(actual.amount - decision.amount) > 0.001) mismatches.push('المبلغ');
  if (actual.date !== decision.currentDate) mismatches.push(`التاريخ الحالي (${actual.date} بدلاً من ${decision.currentDate})`);
  if (mismatches.length) {
    throw new Error(`فشل التحقق من ${decision.file} صف ${decision.outputRow}: ${mismatches.join('، ')}`);
  }
  return actual;
}

function styleHeader(row) {
  row.height = 25;
  row.eachCell(cell => {
    cell.font = { bold: true, color: { argb: COLORS.headerText } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.header } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', readingOrder: 'rtl' };
  });
}

function fillRow(row, color, count) {
  for (let column = 1; column <= count; column += 1) {
    row.getCell(column).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
  }
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

async function writeAppliedWorkbook(applied, unchanged) {
  const workbook = new ExcelJS.Workbook();
  const headers = [
    'اسم المريض', 'رقم التأمين', 'رقم الموافقة', 'القيمة المالية', 'التاريخ القديم', 'التاريخ المصحح',
    'ملف الشركة', 'صف ملف الشركة', 'صف المصدر', 'خلية المصدر', 'ورقة القرار', 'سبب القرار',
  ];
  const ready = workbook.addWorksheet('التصحيحات المطبقة', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  ready.addRow(headers);
  for (const item of applied) {
    const row = ready.addRow([
      item.name, item.insurance, item.approval, item.amount, item.currentDate, item.correctedDate,
      item.file, item.outputRow, item.sourceRow, item.sourceCell, item.verificationSheet, item.reason,
    ]);
    fillRow(row, COLORS.corrected, headers.length);
  }
  styleHeader(ready.getRow(1));
  ready.autoFilter = { from: 'A1', to: `L${Math.max(1, ready.rowCount)}` };
  ready.columns.forEach((column, index) => { column.width = index === 0 ? 34 : index === 11 ? 65 : 22; });

  const skipped = workbook.addWorksheet('لم تتغير', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  skipped.addRow(headers);
  for (const item of unchanged) {
    const row = skipped.addRow([
      item.name, item.insurance, item.approval, item.amount, item.currentDate, item.correctedDate,
      item.file, item.outputRow, item.sourceRow, item.sourceCell, item.verificationSheet,
      'التاريخ المقترح يساوي التاريخ الحالي، لذلك لم يطبق أي تغيير',
    ]);
    fillRow(row, COLORS.skipped, headers.length);
  }
  styleHeader(skipped.getRow(1));
  skipped.columns.forEach((column, index) => { column.width = index === 0 ? 34 : index === 11 ? 65 : 22; });

  const summary = workbook.addWorksheet('ملخص', { views: [{ rightToLeft: true }] });
  summary.addRow(['البيان', 'القيمة']);
  summary.addRow(['عدد تصحيحات التاريخ المطبقة', applied.length]);
  summary.addRow(['قرارات لم تغيّر التاريخ', unchanged.length]);
  summary.addRow(['ملف التحقق المعتمد', path.basename(VERIFICATION_FILE)]);
  summary.addRow(['تنبيه', 'تم تغيير عمود التاريخ فقط، ولم تتغير المبالغ أو بيانات الحركات الأخرى.']);
  styleHeader(summary.getRow(1));
  summary.getColumn(1).width = 42;
  summary.getColumn(2).width = 90;
  await workbook.xlsx.writeFile(APPLIED_FILE);
}

async function writeStatistics(fileStats, totals) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('الإحصائيات', { views: [{ rightToLeft: true }] });
  sheet.addRow(['ملف الشركة', 'عدد الحركات', 'مجموع المبالغ', 'تصحيحات التاريخ']);
  for (const stat of fileStats) sheet.addRow([stat.file, stat.movements, stat.amountTotal, stat.corrections]);
  sheet.addRow(['الإجمالي', totals.movements, totals.amountTotal, totals.corrections]);
  styleHeader(sheet.getRow(1));
  sheet.getColumn(1).width = 38;
  sheet.getColumn(2).width = 18;
  sheet.getColumn(3).width = 20;
  sheet.getColumn(4).width = 20;
  await workbook.xlsx.writeFile(STATISTICS_FILE);
}

function semanticRows(file) {
  const workbook = XLSX.readFile(file, { cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
  const columns = findColumnsFromValues(rows[0] || []);
  return rows.slice(1).map((row, index) => ({
    row: index + 2,
    name: clean(row[columns.name]),
    insurance: clean(row[columns.insurance]),
    approval: clean(row[columns.approval]),
    amount: numeric(row[columns.amount]),
    date: isoDate(row[columns.date]),
    facility: clean(row[columns.facility]),
    notes: clean(row[columns.notes]),
  }));
}

function verifyOutput(files, applied) {
  const expectedByKey = new Map(applied.map(item => [`${item.file}|${item.outputRow}`, item]));
  let movements = 0;
  let amountTotal = 0;
  let dateChanges = 0;
  let otherFieldChanges = 0;
  const unchangedHashes = [];

  for (const file of files) {
    const inputPath = path.join(INPUT_DIR, file);
    const outputPath = path.join(OUTPUT_DIR, file);
    const before = semanticRows(inputPath);
    const after = semanticRows(outputPath);
    if (before.length !== after.length) throw new Error(`تغير عدد الصفوف في ${file}`);
    const fileHasCorrections = applied.some(item => item.file === file);
    if (!fileHasCorrections) {
      const identical = sha256(inputPath) === sha256(outputPath);
      unchangedHashes.push({ file, identical });
      if (!identical) throw new Error(`الملف غير المتأثر تغيرت بصمته: ${file}`);
    }
    for (let index = 0; index < before.length; index += 1) {
      const oldRow = before[index];
      const newRow = after[index];
      if (oldRow.name && oldRow.insurance && oldRow.date) {
        movements += 1;
        amountTotal += Number.isFinite(oldRow.amount) ? oldRow.amount : 0;
      }
      for (const key of ['name', 'insurance', 'approval', 'amount', 'facility', 'notes']) {
        if (String(oldRow[key]) !== String(newRow[key])) otherFieldChanges += 1;
      }
      if (oldRow.date !== newRow.date) {
        dateChanges += 1;
        const expected = expectedByKey.get(`${file}|${oldRow.row}`);
        if (!expected || oldRow.date !== expected.currentDate || newRow.date !== expected.correctedDate) {
          throw new Error(`تغيير تاريخ غير متوقع في ${file} صف ${oldRow.row}`);
        }
      }
    }
  }
  if (dateChanges !== applied.length) throw new Error(`عدد تغييرات التاريخ ${dateChanges} لا يساوي القرارات ${applied.length}`);
  if (otherFieldChanges !== 0) throw new Error(`تغير ${otherFieldChanges} حقل خارج عمود التاريخ`);
  return { movements, amountTotal, dateChanges, otherFieldChanges, unchangedHashes };
}

async function main() {
  if (!fs.existsSync(INPUT_DIR)) throw new Error(`مجلد المصدر غير موجود: ${INPUT_DIR}`);
  if (!fs.existsSync(VERIFICATION_FILE)) throw new Error(`ملف التحقق غير موجود: ${VERIFICATION_FILE}`);
  if (fs.existsSync(OUTPUT_DIR)) throw new Error(`مجلد الناتج موجود مسبقاً: ${OUTPUT_DIR}`);

  const { applied, unchanged } = loadDecisions();
  const files = fs.readdirSync(INPUT_DIR).filter(file => /_Transactions_PT\.xlsx$/i.test(file)).sort();
  const decisionsByFile = new Map();
  for (const decision of applied) {
    if (!files.includes(decision.file)) throw new Error(`ملف الشركة غير موجود: ${decision.file}`);
    if (!decisionsByFile.has(decision.file)) decisionsByFile.set(decision.file, []);
    decisionsByFile.get(decision.file).push(decision);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: false });
  const fileStats = [];
  for (const file of files) {
    const inputPath = path.join(INPUT_DIR, file);
    const outputPath = path.join(OUTPUT_DIR, file);
    const corrections = decisionsByFile.get(file) || [];
    if (!corrections.length) {
      fs.copyFileSync(inputPath, outputPath);
    } else {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(inputPath);
      const worksheet = workbook.worksheets[0];
      const columns = findExcelJsColumns(worksheet);
      for (const decision of corrections) {
        if (decision.outputRow > worksheet.rowCount) throw new Error(`الصف ${decision.outputRow} غير موجود في ${file}`);
        const row = worksheet.getRow(decision.outputRow);
        validateDecisionAgainstRow(decision, row, columns);
        const dateCell = row.getCell(columns.date);
        dateCell.value = decision.correctedDate;
        dateCell.numFmt = 'yyyy-mm-dd';
        dateCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.corrected } };
      }
      await workbook.xlsx.writeFile(outputPath);
    }
    const rows = semanticRows(inputPath).filter(row => row.name && row.insurance && row.date);
    fileStats.push({
      file,
      movements: rows.length,
      amountTotal: rows.reduce((sum, row) => sum + (Number.isFinite(row.amount) ? row.amount : 0), 0),
      corrections: corrections.length,
    });
  }

  const verification = verifyOutput(files, applied);
  await writeAppliedWorkbook(applied, unchanged);
  await writeStatistics(fileStats, {
    movements: fileStats.reduce((sum, item) => sum + item.movements, 0),
    amountTotal: fileStats.reduce((sum, item) => sum + item.amountTotal, 0),
    corrections: applied.length,
  });

  console.log(JSON.stringify({
    inputDir: INPUT_DIR,
    verificationFile: VERIFICATION_FILE,
    outputDir: OUTPUT_DIR,
    companyFiles: files.length,
    appliedCorrections: applied.length,
    unchangedDecisions: unchanged.length,
    correctionsByFile: Object.fromEntries(fileStats.filter(item => item.corrections).map(item => [item.file, item.corrections])),
    verification,
    appliedFile: APPLIED_FILE,
    statisticsFile: STATISTICS_FILE,
  }, null, 2));
}

main().catch(error => {
  console.error(`[ERROR] ${error.message}`);
  process.exitCode = 1;
});
