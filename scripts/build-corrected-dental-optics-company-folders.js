const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const XLSX = require('xlsx');

const ROOT = path.resolve(__dirname, '..');
const RESULT_ROOT = path.join(ROOT, 'حركات الأسنان والبصريات - مصححة نهائيا');

const COLORS = {
  header: '1F4E78',
  headerText: 'FFFFFF',
  dateCorrection: 'DDEBF7',
  invoiceAddition: 'E2F0D9',
  otherNote: 'FFF2CC',
  manualReview: 'FCE4D6',
  missingMovement: 'E4DFEC',
};

const JOBS = [
  {
    service: 'DENTAL',
    label: 'الأسنان',
    inputDir: path.join(ROOT, 'حركات الشركات للأسنان - جديد'),
    outputDir: path.join(RESULT_ROOT, 'حركات الشركات للأسنان - مصححة'),
    filePattern: /_Transactions\.xlsx$/i,
    verificationFile: path.join(ROOT, 'date-correction-imports', 'تصحيح تواريخ حركات الأسنان.xlsx'),
    applyReviewSheet: true,
    correctionFile: path.join(RESULT_ROOT, 'تصحيحات الأسنان - نهائي ملون.xlsx'),
    allowInvoiceAddition: true,
  },
  {
    service: 'OPTICS',
    label: 'البصريات',
    inputDir: path.join(ROOT, 'حركات الشركات للبصريات - جديد'),
    outputDir: path.join(RESULT_ROOT, 'حركات الشركات للبصريات - مصححة'),
    filePattern: /_Transactions_Optics\.xlsx$/i,
    verificationFile: path.join(ROOT, 'date-correction-imports', 'تصحيح تواريخ حركات البصريات.xlsx'),
    applyReviewSheet: false,
    correctionFile: path.join(RESULT_ROOT, 'تصحيحات البصريات - نهائي ملون.xlsx'),
    allowInvoiceAddition: false,
  },
];

function clean(value) {
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    if (value.result !== undefined && value.result !== null) value = value.result;
    else if (value.text !== undefined && value.text !== null) value = value.text;
    else if (Array.isArray(value.richText)) value = value.richText.map(part => part.text || '').join('');
  }
  return String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeArabic(value) {
  return clean(value).replace(/[إأآ]/g, 'ا').replace(/ة/g, 'ه').toLowerCase();
}

function numeric(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(clean(value).replace(/,/g, '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isoDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
  }
  if (value && typeof value === 'object') {
    if (value.result !== undefined) return isoDate(value.result);
    if (value.text !== undefined) return isoDate(value.text);
  }
  const str = clean(value);
  let match = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  match = str.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (match) {
    const year = match[3].length === 2 ? `20${match[3]}` : match[3];
    return `${year}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  }
  return str;
}

function invoiceAdditionFromNote(note) {
  const normalized = normalizeArabic(note);
  const direct = normalized.match(/اضافه\s*(\d+(?:\.\d+)?)\s*كشف/);
  if (direct) return Number(direct[1]);
  const reversed = normalized.match(/اضافه\s*كشف\s*(\d+(?:\.\d+)?)/);
  return reversed ? Number(reversed[1]) : 0;
}

function meaningfulNote(note, facility) {
  const noteValue = normalizeArabic(note);
  if (!noteValue) return '';
  if (noteValue === normalizeArabic(facility)) return '';
  return clean(note);
}

function findColumns(worksheet) {
  const columns = {};
  worksheet.getRow(1).eachCell((cell, column) => {
    const header = clean(cell.value);
    if (header.includes('اسم المريض')) columns.name = column;
    else if (header.includes('رقم التأمين') || header.includes('رقم التامين')) columns.insurance = column;
    else if (header.includes('رقم الموافقة')) columns.approval = column;
    else if (header.includes('القيمة المالية')) columns.amount = column;
    else if (header.includes('التاريخ')) columns.date = column;
    else if (header.includes('مرفق') || header.includes('جهة') || header.includes('جيهة')) columns.facility = column;
    else if (header.includes('ملاحظ')) columns.notes = column;
  });
  const required = ['name', 'insurance', 'approval', 'amount', 'date', 'facility', 'notes'];
  for (const key of required) {
    if (!columns[key]) throw new Error(`عمود ${key} غير موجود في ${worksheet.name}`);
  }
  return columns;
}

function loadVerification(job) {
  const workbook = XLSX.readFile(job.verificationFile, { cellDates: false });
  const applied = new Map();
  const manualReview = [];
  const sourceMissing = [];

  const loadSheet = (sheetName, shouldApply) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return;
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
    for (const row of rows) {
      const entry = {
        name: clean(row['اسم المريض']),
        insurance: clean(row['رقم التأمين']),
        approval: clean(row['رقم الموافقة']),
        amount: numeric(row['القيمة المالية']),
        oldDate: isoDate(row['التاريخ القديم']),
        correctedDate: isoDate(row['التاريخ المصحح']),
        facility: clean(row['المرفق الصحي']),
        notes: clean(row['ملاحظات']),
        outputFile: clean(row['ملف الشركة الأصلي']),
        outputRow: Number(row['صف ملف الشركة الأصلي']),
        sourceRow: Number(row['صف المصدر']),
        sourceDisplay: clean(row['القيمة الظاهرة في المصدر']),
        confidence: clean(row['درجة الثقة']),
        verificationSheet: sheetName,
      };
      if (!entry.outputFile || !entry.outputRow || !entry.correctedDate) continue;
      if (shouldApply) applied.set(`${entry.outputFile}|${entry.outputRow}`, entry);
      else manualReview.push(entry);
    }
  };

  loadSheet('تصحيحات مؤكدة', true);
  loadSheet('مراجعة يدوية', job.applyReviewSheet);
  if (!job.applyReviewSheet) {
    // The preceding call already collected the review rows.
  }

  const missingSheet = workbook.Sheets['غير موجودة بالمنظم'];
  if (missingSheet) {
    sourceMissing.push(...XLSX.utils.sheet_to_json(missingSheet, { defval: '', raw: false }));
  }
  return { applied, manualReview, sourceMissing };
}

function styleHeader(row) {
  row.height = 24;
  row.eachCell(cell => {
    cell.font = { bold: true, color: { argb: COLORS.headerText } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.header } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', readingOrder: 'rtl' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'B4C6E7' } },
      bottom: { style: 'thin', color: { argb: 'B4C6E7' } },
      left: { style: 'thin', color: { argb: 'B4C6E7' } },
      right: { style: 'thin', color: { argb: 'B4C6E7' } },
    };
  });
}

function fillRow(row, color, lastColumn) {
  for (let column = 1; column <= lastColumn; column += 1) {
    row.getCell(column).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
  }
}

function styleCompanySheet(worksheet, columns) {
  worksheet.views = [{ rightToLeft: true, state: 'frozen', ySplit: 1 }];
  worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: worksheet.rowCount, column: worksheet.columnCount } };
  styleHeader(worksheet.getRow(1));
  worksheet.getColumn(columns.name).width = 34;
  worksheet.getColumn(columns.insurance).width = 24;
  worksheet.getColumn(columns.approval).width = 16;
  worksheet.getColumn(columns.amount).width = 15;
  worksheet.getColumn(columns.date).width = 16;
  worksheet.getColumn(columns.facility).width = 34;
  worksheet.getColumn(columns.notes).width = 34;
}

function correctionType(dateChanged, addition) {
  if (dateChanged && addition > 0) return 'تصحيح تاريخ + إضافة للفاتورة';
  if (dateChanged) return 'تصحيح تاريخ';
  if (addition > 0) return 'إضافة للفاتورة';
  return '';
}

function correctedRecord(job, file, rowNumber, values) {
  return {
    'اسم المريض': values.name,
    'رقم التأمين': values.insurance,
    'رقم الموافقة': values.approval,
    'القيمة المالية المصححة': values.correctedAmount,
    'التاريخ المصحح': values.correctedDate,
    'المرفق الصحي': values.facility,
    'ملاحظات': values.notes,
    'القيمة المالية القديمة': values.oldAmount,
    'المبلغ المضاف': values.addition,
    'التاريخ القديم': values.oldDate,
    'نوع التصحيح': correctionType(values.dateChanged, values.addition),
    'نوع الملاحظة': values.noteType,
    'ملف الشركة': file,
    'صف ملف الشركة': rowNumber,
    'نوع الخدمة': job.service,
  };
}

async function addMissingOpticsMovements(job, verification, outputFiles, correctionRows) {
  if (job.service !== 'OPTICS' || verification.sourceMissing.length === 0) return [];
  const sourceWorkbook = XLSX.readFile(path.join(ROOT, 'خصومات بصريات.xlsx'), { cellDates: false });
  const sourceSheet = sourceWorkbook.Sheets['النظارات'];
  const sourceRows = XLSX.utils.sheet_to_json(sourceSheet, { header: 1, defval: '', raw: true });
  const added = [];

  for (const missing of verification.sourceMissing) {
    const sourceRowNumber = Number(missing['صف المصدر']);
    const raw = sourceRows[sourceRowNumber - 1] || [];
    const insurance = clean(missing['رقم التأمين']);
    const prefix = (insurance.match(/^([A-Za-z]+)/) || [])[1]?.toUpperCase();
    if (!prefix) continue;
    const outputFile = `${prefix}_Transactions_Optics.xlsx`;
    const workbook = outputFiles.get(outputFile);
    if (!workbook) continue;
    const worksheet = workbook.worksheets[0];
    const columns = findColumns(worksheet);
    const values = {
      name: clean(missing['اسم المريض']),
      insurance,
      approval: clean(missing['رقم الموافقة']),
      amount: numeric(missing['القيمة المالية']),
      date: isoDate(missing['التاريخ المستنتج']),
      facility: clean(raw[5]),
      notes: clean(raw[6]),
    };
    const row = worksheet.addRow([]);
    row.getCell(columns.name).value = values.name;
    row.getCell(columns.insurance).value = values.insurance;
    row.getCell(columns.approval).value = values.approval;
    row.getCell(columns.amount).value = values.amount;
    row.getCell(columns.date).value = values.date;
    row.getCell(columns.date).numFmt = 'yyyy-mm-dd';
    row.getCell(columns.facility).value = values.facility;
    row.getCell(columns.notes).value = values.notes;
    fillRow(row, COLORS.missingMovement, worksheet.columnCount);
    added.push({ ...values, outputFile, outputRow: row.number, sourceRow: sourceRowNumber });
    correctionRows.push({
      'اسم المريض': values.name,
      'رقم التأمين': values.insurance,
      'رقم الموافقة': values.approval,
      'القيمة المالية المصححة': values.amount,
      'التاريخ المصحح': values.date,
      'المرفق الصحي': values.facility,
      'ملاحظات': values.notes,
      'القيمة المالية القديمة': '',
      'المبلغ المضاف': '',
      'التاريخ القديم': '',
      'نوع التصحيح': 'حركة مضافة من المصدر',
      'نوع الملاحظة': '',
      'ملف الشركة': outputFile,
      'صف ملف الشركة': row.number,
      'نوع الخدمة': job.service,
    });
  }
  return added;
}

async function processJob(job) {
  fs.mkdirSync(job.outputDir, { recursive: true });
  const verification = loadVerification(job);
  const files = fs.readdirSync(job.inputDir).filter(file => job.filePattern.test(file));
  const outputFiles = new Map();
  const correctionRows = [];
  const summary = [];
  let totalRows = 0;
  let dateCorrections = 0;
  let invoiceAdditions = 0;
  let invoiceAdditionTotal = 0;
  let otherNoteRows = 0;

  for (const file of files) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path.join(job.inputDir, file));
    const worksheet = workbook.worksheets[0];
    const columns = findColumns(worksheet);
    let fileDateCorrections = 0;
    let fileInvoiceAdditions = 0;
    let fileAdditionTotal = 0;

    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const insurance = clean(row.getCell(columns.insurance).value);
      if (!insurance) continue;
      totalRows += 1;
      const name = clean(row.getCell(columns.name).value);
      const approval = clean(row.getCell(columns.approval).value);
      const oldAmount = numeric(row.getCell(columns.amount).value);
      const oldDate = isoDate(row.getCell(columns.date).value);
      const facility = clean(row.getCell(columns.facility).value);
      const notes = meaningfulNote(row.getCell(columns.notes).value, facility);
      const addition = job.allowInvoiceAddition ? invoiceAdditionFromNote(notes) : 0;
      const correction = verification.applied.get(`${file}|${rowNumber}`);
      const correctedDate = correction?.correctedDate || oldDate;
      const dateChanged = Boolean(correctedDate && oldDate && correctedDate !== oldDate);
      const correctedAmount = oldAmount + addition;
      const noteType = addition > 0 ? 'إضافة مالية للفاتورة' : notes ? 'ملاحظة أخرى - بلا زيادة مالية' : '';

      if (notes) {
        fillRow(row, addition > 0 ? COLORS.invoiceAddition : COLORS.otherNote, worksheet.columnCount);
        if (addition === 0) otherNoteRows += 1;
      }
      if (dateChanged) {
        row.getCell(columns.date).value = correctedDate;
        row.getCell(columns.date).numFmt = 'yyyy-mm-dd';
        row.getCell(columns.date).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.dateCorrection } };
        dateCorrections += 1;
        fileDateCorrections += 1;
      }
      if (addition > 0) {
        row.getCell(columns.amount).value = correctedAmount;
        row.getCell(columns.amount).numFmt = '0.00';
        row.getCell(columns.amount).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.invoiceAddition } };
        invoiceAdditions += 1;
        invoiceAdditionTotal += addition;
        fileInvoiceAdditions += 1;
        fileAdditionTotal += addition;
      }
      if (dateChanged || addition > 0) {
        correctionRows.push(correctedRecord(job, file, rowNumber, {
          name, insurance, approval, correctedAmount, correctedDate, facility, notes,
          oldAmount, addition, oldDate, dateChanged, noteType,
        }));
      }
    }
    styleCompanySheet(worksheet, columns);
    outputFiles.set(file, workbook);
    summary.push({ file, rows: worksheet.rowCount - 1, dateCorrections: fileDateCorrections, invoiceAdditions: fileInvoiceAdditions, additionTotal: fileAdditionTotal });
  }

  const missingAdded = await addMissingOpticsMovements(job, verification, outputFiles, correctionRows);
  for (const item of missingAdded) {
    const summaryRow = summary.find(row => row.file === item.outputFile);
    if (summaryRow) summaryRow.rows += 1;
  }

  for (const [file, workbook] of outputFiles) {
    const worksheet = workbook.worksheets[0];
    const columns = findColumns(worksheet);
    styleCompanySheet(worksheet, columns);
    await workbook.xlsx.writeFile(path.join(job.outputDir, file));
  }

  await writeStatistics(job, summary, {
    totalRows: totalRows + missingAdded.length,
    dateCorrections,
    invoiceAdditions,
    invoiceAdditionTotal,
    otherNoteRows,
    missingAdded: missingAdded.length,
  });
  await writeCorrectionWorkbook(job, correctionRows, verification.manualReview, summary);
  return {
    job,
    files: files.length,
    totalRows: totalRows + missingAdded.length,
    dateCorrections,
    invoiceAdditions,
    invoiceAdditionTotal,
    otherNoteRows,
    manualReview: verification.manualReview.length,
    missingAdded: missingAdded.length,
    correctionRows: correctionRows.length,
  };
}

async function writeStatistics(job, summary, totals) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('الإحصائيات', { views: [{ rightToLeft: true }] });
  worksheet.columns = [
    { header: 'ملف الشركة', key: 'file', width: 36 },
    { header: 'عدد الحركات', key: 'rows', width: 16 },
    { header: 'تصحيحات التاريخ', key: 'dateCorrections', width: 18 },
    { header: 'إضافات الفاتورة', key: 'invoiceAdditions', width: 18 },
    { header: 'إجمالي الزيادة', key: 'additionTotal', width: 18 },
  ];
  summary.forEach(row => worksheet.addRow(row));
  worksheet.addRow({ file: 'الإجمالي', rows: totals.totalRows, dateCorrections: totals.dateCorrections, invoiceAdditions: totals.invoiceAdditions, additionTotal: totals.invoiceAdditionTotal });
  styleHeader(worksheet.getRow(1));
  worksheet.autoFilter = 'A1:E1';
  const info = workbook.addWorksheet('دليل الألوان', { views: [{ rightToLeft: true }] });
  info.addRow(['اللون', 'المعنى']);
  const legend = [
    [COLORS.invoiceAddition, 'أخضر: ملاحظة إضافة مالية، وتمت زيادة فاتورة الأسنان'],
    [COLORS.otherNote, 'أصفر: ملاحظة أخرى لم تغيّر مبلغ الفاتورة'],
    [COLORS.dateCorrection, 'أزرق في خلية التاريخ: تم تصحيح التاريخ'],
    [COLORS.missingMovement, 'بنفسجي: حركة بصريات أضيفت لأنها كانت في المصدر وغير موجودة بالملف المنظم'],
  ];
  legend.forEach(([color, text]) => {
    const row = info.addRow(['', text]);
    row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
  });
  styleHeader(info.getRow(1));
  info.getColumn(1).width = 14;
  info.getColumn(2).width = 90;
  await workbook.xlsx.writeFile(path.join(job.outputDir, job.service === 'DENTAL' ? 'STATISTICS_CORRECTED.xlsx' : 'STATISTICS_CORRECTED_OPTICS.xlsx'));
}

async function writeCorrectionWorkbook(job, correctionRows, manualReview, summary) {
  const workbook = new ExcelJS.Workbook();
  const headers = [
    'اسم المريض', 'رقم التأمين', 'رقم الموافقة', 'القيمة المالية المصححة', 'التاريخ المصحح', 'المرفق الصحي', 'ملاحظات',
    'القيمة المالية القديمة', 'المبلغ المضاف', 'التاريخ القديم', 'نوع التصحيح', 'نوع الملاحظة', 'ملف الشركة', 'صف ملف الشركة', 'نوع الخدمة',
  ];
  const ready = workbook.addWorksheet('التصحيحات المطبقة', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  ready.addRow(headers);
  for (const record of correctionRows) {
    const row = ready.addRow(headers.map(header => record[header] ?? ''));
    const type = record['نوع التصحيح'];
    const noteType = record['نوع الملاحظة'];
    let color = type === 'حركة مضافة من المصدر' ? COLORS.missingMovement : COLORS.dateCorrection;
    if (noteType === 'إضافة مالية للفاتورة') color = COLORS.invoiceAddition;
    else if (noteType === 'ملاحظة أخرى - بلا زيادة مالية') color = COLORS.otherNote;
    fillRow(row, color, headers.length);
  }
  styleHeader(ready.getRow(1));
  ready.autoFilter = { from: 'A1', to: `O${Math.max(1, ready.rowCount)}` };
  ready.columns.forEach((column, index) => { column.width = [34, 24, 16, 20, 17, 34, 34, 20, 16, 17, 28, 28, 36, 16, 16][index]; });

  const review = workbook.addWorksheet('مراجعة يدوية غير مطبقة', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  const reviewHeaders = ['اسم المريض', 'رقم التأمين', 'رقم الموافقة', 'القيمة المالية', 'التاريخ المقترح', 'التاريخ الحالي', 'المرفق الصحي', 'ملاحظات', 'ملف الشركة', 'صف ملف الشركة', 'سبب العزل'];
  review.addRow(reviewHeaders);
  for (const item of manualReview) {
    const row = review.addRow([
      item.name, item.insurance, item.approval, item.amount, item.correctedDate, item.oldDate,
      item.facility, item.notes, item.outputFile, item.outputRow, 'لم يعتمد المستخدم هذا التاريخ يدوياً بعد',
    ]);
    fillRow(row, COLORS.manualReview, reviewHeaders.length);
  }
  styleHeader(review.getRow(1));
  review.columns.forEach(column => { column.width = 24; });

  const stats = workbook.addWorksheet('ملخص', { views: [{ rightToLeft: true }] });
  stats.addRow(['البيان', 'القيمة']);
  stats.addRow(['نوع الخدمة', job.label]);
  stats.addRow(['عدد ملفات الشركات', summary.length]);
  stats.addRow(['عدد التصحيحات المطبقة', correctionRows.length]);
  stats.addRow(['حالات مراجعة يدوية غير مطبقة', manualReview.length]);
  stats.addRow(['قاعدة الزيادة المالية', job.allowInvoiceAddition ? 'تطبق فقط عند وجود عبارة إضافة ... كشف في الأسنان' : 'لا توجد أي زيادة مالية في البصريات']);
  styleHeader(stats.getRow(1));
  stats.getColumn(1).width = 38;
  stats.getColumn(2).width = 70;

  const legend = workbook.addWorksheet('دليل الألوان', { views: [{ rightToLeft: true }] });
  legend.addRow(['اللون', 'المعنى']);
  [
    [COLORS.invoiceAddition, 'إضافة مالية إلى فاتورة الأسنان'],
    [COLORS.otherNote, 'ملاحظة أخرى لم تغيّر قيمة الفاتورة'],
    [COLORS.dateCorrection, 'تصحيح تاريخ فقط'],
    [COLORS.manualReview, 'حالة معزولة للمراجعة ولم تطبق'],
    [COLORS.missingMovement, 'حركة مضافة من المصدر لأنها كانت مفقودة من الملف المنظم'],
  ].forEach(([color, text]) => {
    const row = legend.addRow(['', text]);
    row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
  });
  styleHeader(legend.getRow(1));
  legend.getColumn(1).width = 14;
  legend.getColumn(2).width = 80;
  await workbook.xlsx.writeFile(job.correctionFile);
}

async function main() {
  fs.mkdirSync(RESULT_ROOT, { recursive: true });
  const results = [];
  for (const job of JOBS) results.push(await processJob(job));
  console.log(JSON.stringify(results.map(result => ({
    service: result.job.label,
    companyFiles: result.files,
    movements: result.totalRows,
    dateCorrections: result.dateCorrections,
    invoiceAdditions: result.invoiceAdditions,
    invoiceAdditionTotal: result.invoiceAdditionTotal,
    otherNoteRows: result.otherNoteRows,
    manualReviewNotApplied: result.manualReview,
    missingMovementsAdded: result.missingAdded,
    correctionRows: result.correctionRows,
    outputFolder: result.job.outputDir,
    correctionFile: result.job.correctionFile,
  })), null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
