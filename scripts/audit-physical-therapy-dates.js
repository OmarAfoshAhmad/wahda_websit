const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');

const ROOT = path.resolve(__dirname, '..');
const SOURCE_FILE = path.join(ROOT, 'العلاج الطبية اخر نسخة.xlsx');
const COMPANY_DIR = path.join(ROOT, 'حركات الشركات للعلاج الطبيعي');
const OUTPUT_FILE = path.join(ROOT, 'date-correction-imports', 'تحقق تواريخ حركات العلاج الطبيعي.xlsx');
const DAY_MS = 86_400_000;

const COLORS = {
  header: '1F4E78',
  headerText: 'FFFFFF',
  confirmed: 'DDEBF7',
  review: 'FCE4D6',
  missing: 'E4DFEC',
  extra: 'FFF2CC',
};

function clean(value) {
  return String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeArabic(value) {
  return clean(value).toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
}

function normalizeCode(value) {
  return clean(value).toUpperCase().replace(/\s+/g, '');
}

function numeric(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : Number.NaN;
  const parsed = Number(clean(value).replace(/,/g, '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function isoFromParts(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return '';
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return '';
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() + 1 !== m || date.getUTCDate() !== d) return '';
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function isoDay(iso) {
  const match = clean(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return Number.NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS;
}

function swappedIso(iso) {
  const match = clean(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (day > 12 || day === month) return '';
  return isoFromParts(match[1], day, month);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function dateCandidates(value) {
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return { candidates: [], stored: '', rawKind: 'excel-invalid' };
    const stored = isoFromParts(parsed.y, parsed.m, parsed.d);
    return {
      candidates: unique([stored, swappedIso(stored)]),
      stored,
      rawKind: 'excel-serial',
    };
  }

  const str = clean(value);
  if (!str) return { candidates: [], stored: '', rawKind: 'blank' };
  let match = str.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (match) {
    const year = match[3].length === 2 ? `20${match[3]}` : match[3];
    const dmy = isoFromParts(year, match[2], match[1]);
    return { candidates: unique([dmy]), stored: dmy, rawKind: dmy ? 'text-dmy' : 'text-invalid' };
  }
  match = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    const iso = isoFromParts(match[1], match[2], match[3]);
    return { candidates: unique([iso]), stored: iso, rawKind: iso ? 'text-iso' : 'text-invalid' };
  }
  return { candidates: [], stored: '', rawKind: 'text-unparsed' };
}

function parseOutputDate(value) {
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    return parsed ? isoFromParts(parsed.y, parsed.m, parsed.d) : '';
  }
  const str = clean(value);
  let match = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) return isoFromParts(match[1], match[2], match[3]);
  match = str.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (match) return isoFromParts(match[3].length === 2 ? `20${match[3]}` : match[3], match[2], match[1]);
  return '';
}

function findColumns(row) {
  const values = (row || []).map(clean);
  return {
    name: values.findIndex(value => value.includes('اسم المريض')),
    insurance: values.findIndex(value => value.includes('رقم التامين') || value.includes('رقم التأمين')),
    approval: values.findIndex(value => value.includes('رقم الموافقة')),
    date: values.findIndex(value => value.includes('التاريخ')),
    amount: values.findIndex(value => value.includes('القيمة المالية')),
    facility: values.findIndex(value => value.includes('الجيهة') || value.includes('الجهة') || value.includes('المرفق')),
    sessions: values.findIndex(value => value.includes('جلسات')),
    notes: values.findIndex(value => value.includes('ملاحظات')),
  };
}

function movementKey(record) {
  return [
    normalizeCode(record.insurance),
    normalizeCode(record.approval),
    Number(record.amount).toFixed(3),
    normalizeArabic(record.name),
  ].join('|');
}

function fallbackKey(record) {
  return [normalizeCode(record.insurance), normalizeCode(record.approval), Number(record.amount).toFixed(3)].join('|');
}

function readSource() {
  const workbook = XLSX.readFile(SOURCE_FILE, { cellDates: false, cellNF: true, cellText: true });
  const sheetName = workbook.SheetNames.find(name => normalizeArabic(name).includes('علاج الطبيعي')) || workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
  const sections = [];
  let current = null;

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const columns = findColumns(rows[rowIndex]);
    if (columns.name >= 0 && columns.insurance >= 0 && columns.date >= 0) {
      if (current) sections.push(current);
      current = { headerRow: rowIndex + 1, columns, records: [] };
      continue;
    }
    if (!current) continue;
    const row = rows[rowIndex] || [];
    const name = clean(row[current.columns.name]);
    const insurance = clean(row[current.columns.insurance]);
    const amount = numeric(row[current.columns.amount]);
    const parsedDate = dateCandidates(row[current.columns.date]);
    if (!name || !/^[A-Za-z]/.test(insurance) || !Number.isFinite(amount) || parsedDate.candidates.length === 0) continue;
    const cellAddress = XLSX.utils.encode_cell({ r: rowIndex, c: current.columns.date });
    const cell = sheet[cellAddress] || {};
    current.records.push({
      sourceRow: rowIndex + 1,
      sourceCell: cellAddress,
      sectionHeaderRow: current.headerRow,
      name,
      insurance,
      approval: clean(row[current.columns.approval]),
      amount,
      facility: clean(row[current.columns.facility]),
      sessions: clean(row[current.columns.sessions]),
      notes: clean(row[current.columns.notes]),
      sourceDateDisplay: clean(cell.w ?? row[current.columns.date]),
      sourceDateFormat: clean(cell.z),
      ...parsedDate,
    });
  }
  if (current) sections.push(current);
  return { sheetName, sections, records: sections.flatMap(section => section.records) };
}

function readCompanyFiles() {
  const files = fs.readdirSync(COMPANY_DIR).filter(file => /_Transactions_PT\.xlsx$/i.test(file));
  const records = [];
  for (const file of files) {
    const workbook = XLSX.readFile(path.join(COMPANY_DIR, file), { cellDates: false });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
    const columns = findColumns(rows[0]);
    for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex] || [];
      const name = clean(row[columns.name]);
      const insurance = clean(row[columns.insurance]);
      const amount = numeric(row[columns.amount]);
      const outputDate = parseOutputDate(row[columns.date]);
      if (!name || !insurance || !Number.isFinite(amount) || !outputDate) continue;
      records.push({
        outputFile: file,
        outputRow: rowIndex + 1,
        name,
        insurance,
        approval: clean(row[columns.approval]),
        amount,
        outputDate,
        facility: clean(row[columns.facility]),
        notes: clean(row[columns.notes]),
      });
    }
  }
  return { files, records };
}

function choiceCost(iso, cutoffDay) {
  const day = isoDay(iso);
  if (!Number.isFinite(day)) return 1e15;
  if (day > cutoffDay) return 1e9 + (day - cutoffDay) * 1e6;
  return 0;
}

function transitionCost(previousIso, currentIso) {
  const previous = isoDay(previousIso);
  const current = isoDay(currentIso);
  const gap = current - previous;
  if (gap < 0) return 1e10 + Math.abs(gap) * 1e7;
  return gap * gap;
}

function inferSection(section, cutoffIso) {
  const dated = section.records.filter(record => record.candidates.length > 0);
  if (!dated.length) return;
  const cutoffDay = isoDay(cutoffIso);
  const states = [];
  for (let index = 0; index < dated.length; index += 1) {
    const record = dated[index];
    states.push(record.candidates.map(candidate => {
      if (index === 0) return { iso: candidate, cost: choiceCost(candidate, cutoffDay), previousIndex: -1 };
      let bestCost = Number.POSITIVE_INFINITY;
      let previousIndex = -1;
      for (let priorIndex = 0; priorIndex < states[index - 1].length; priorIndex += 1) {
        const prior = states[index - 1][priorIndex];
        const cost = prior.cost + transitionCost(prior.iso, candidate) + choiceCost(candidate, cutoffDay);
        if (cost < bestCost) {
          bestCost = cost;
          previousIndex = priorIndex;
        }
      }
      return { iso: candidate, cost: bestCost, previousIndex };
    }));
  }
  let selectedIndex = states.at(-1).reduce((best, state, index, all) => state.cost < all[best].cost ? index : best, 0);
  for (let index = dated.length - 1; index >= 0; index -= 1) {
    const selected = states[index][selectedIndex];
    dated[index].inferredDate = selected.iso;
    dated[index].inference = dated[index].candidates.length === 1
      ? 'تاريخ صريح'
      : selected.iso === dated[index].stored
        ? 'إبقاء تاريخ Excel وفق تسلسل الشركة'
        : 'قلب اليوم والشهر وفق تسلسل الشركة';
    selectedIndex = selected.previousIndex;
  }
}

function matchRecords(sourceRecords, outputRecords) {
  const exact = new Map();
  const fallback = new Map();
  for (const output of outputRecords) {
    const key = movementKey(output);
    if (!exact.has(key)) exact.set(key, []);
    exact.get(key).push(output);
    const fallbackValue = fallbackKey(output);
    if (!fallback.has(fallbackValue)) fallback.set(fallbackValue, []);
    fallback.get(fallbackValue).push(output);
  }

  const consumed = new Set();
  for (const source of sourceRecords) {
    let pool = (exact.get(movementKey(source)) || []).filter(item => !consumed.has(item));
    if (!pool.length) pool = (fallback.get(fallbackKey(source)) || []).filter(item => !consumed.has(item));
    const output = pool.find(item => item.outputDate === source.stored) || pool[0] || null;
    source.output = output;
    if (output) consumed.add(output);
  }
  return outputRecords.filter(record => !consumed.has(record));
}

function neighborAssessment(section, record) {
  const dated = section.records.filter(item => item.inferredDate);
  const index = dated.indexOf(record);
  const previous = index > 0 ? dated[index - 1] : null;
  const next = index + 1 < dated.length ? dated[index + 1] : null;
  const fits = iso => {
    const day = isoDay(iso);
    const previousDay = previous ? isoDay(previous.inferredDate) : Number.NaN;
    const nextDay = next ? isoDay(next.inferredDate) : Number.NaN;
    return (!Number.isFinite(previousDay) || day >= previousDay) && (!Number.isFinite(nextDay) || day <= nextDay);
  };
  const candidateFits = Object.fromEntries(record.candidates.map(candidate => [candidate, fits(candidate)]));
  return {
    previous: previous?.inferredDate || '',
    next: next?.inferredDate || '',
    oldFits: fits(record.output?.outputDate || record.stored),
    newFits: fits(record.inferredDate),
    candidateFits,
  };
}

function classify(source, section, cutoffIso) {
  if (!source.output || !source.inferredDate) return '';
  const assessment = neighborAssessment(section, source);
  if (source.output.outputDate === source.inferredDate) {
    if (source.rawKind !== 'excel-serial' || source.candidates.length !== 2) return '';
    const alternative = source.candidates.find(candidate => candidate !== source.output.outputDate);
    if (alternative && assessment.oldFits && assessment.candidateFits[alternative] && alternative <= cutoffIso) {
      source.reviewProposedDate = alternative;
      return 'مراجعة يدوية - التاريخان محتملان وكلاهما يحافظ على تسلسل الشركة';
    }
    return '';
  }
  if (source.output.outputDate > cutoffIso && source.inferredDate <= cutoffIso) {
    return 'مؤكد - التاريخ القديم بعد تاريخ الملف والقلب يعيده إلى الفترة الصحيحة';
  }
  if (!assessment.oldFits && assessment.newFits) {
    return 'مؤكد - التاريخ المصحح يعيد تسلسل الشركة';
  }
  return 'مراجعة يدوية - الاحتمالان يحتاجان تأكيداً';
}

function reportRow(source, reason = '') {
  const assessment = source.inferredDate ? neighborAssessment(source.section, source) : { previous: '', next: '' };
  return {
    'اسم المريض': source.output?.name || source.name,
    'رقم التأمين': source.output?.insurance || source.insurance,
    'رقم الموافقة': source.output?.approval || source.approval,
    'القيمة المالية': source.output?.amount ?? source.amount,
    'التاريخ الحالي': source.output?.outputDate || source.stored,
    'التاريخ المقترح': source.reviewProposedDate || source.inferredDate || '',
    'التاريخ السابق في التسلسل': assessment.previous,
    'التاريخ التالي في التسلسل': assessment.next,
    'ملف الشركة': source.output?.outputFile || '',
    'صف ملف الشركة': source.output?.outputRow || '',
    'صف المصدر': source.sourceRow,
    'خلية المصدر': source.sourceCell,
    'القيمة الظاهرة بالمصدر': source.sourceDateDisplay,
    'نوع خلية المصدر': source.rawKind,
    'طريقة الاستنتاج': source.inference || '',
    'سبب التصنيف': reason,
  };
}

function chronologicalAnomalies(section, alreadyReported) {
  const anomalies = [];
  const dated = section.records.filter(record => record.inferredDate && record.output);
  for (let index = 1; index < dated.length; index += 1) {
    const previous = dated[index - 1];
    const current = dated[index];
    if (isoDay(current.inferredDate) >= isoDay(previous.inferredDate)) continue;
    const key = `${current.sourceRow}|${current.output.outputFile}|${current.output.outputRow}`;
    if (alreadyReported.has(key)) continue;
    anomalies.push(reportRow(current, `مراجعة يدوية - التاريخ أقدم من الحركة السابقة ${previous.inferredDate} رغم ترتيب القسم`));
    alreadyReported.add(key);
  }
  return anomalies;
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

function addSheet(workbook, name, rows, color) {
  const worksheet = workbook.addWorksheet(name, { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  const headers = rows.length ? Object.keys(rows[0]) : [
    'اسم المريض', 'رقم التأمين', 'رقم الموافقة', 'القيمة المالية', 'التاريخ الحالي', 'التاريخ المقترح',
    'التاريخ السابق في التسلسل', 'التاريخ التالي في التسلسل', 'ملف الشركة', 'صف ملف الشركة', 'صف المصدر',
    'خلية المصدر', 'القيمة الظاهرة بالمصدر', 'نوع خلية المصدر', 'طريقة الاستنتاج', 'سبب التصنيف',
  ];
  worksheet.addRow(headers);
  for (const item of rows) {
    const row = worksheet.addRow(headers.map(header => item[header] ?? ''));
    fillRow(row, color, headers.length);
  }
  styleHeader(worksheet.getRow(1));
  worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, worksheet.rowCount), column: headers.length } };
  worksheet.columns.forEach((column, index) => {
    column.width = index === 0 ? 34 : index === headers.length - 1 ? 65 : 22;
  });
  return worksheet;
}

async function main() {
  const cutoffIso = fs.statSync(SOURCE_FILE).mtime.toISOString().slice(0, 10);
  const source = readSource();
  const company = readCompanyFiles();
  for (const section of source.sections) {
    inferSection(section, cutoffIso);
    for (const record of section.records) record.section = section;
  }
  const extraOutputs = matchRecords(source.records, company.records);

  const confirmed = [];
  const review = [];
  const missing = [];
  const reported = new Set();
  for (const section of source.sections) {
    for (const record of section.records) {
      if (!record.output) {
        missing.push(reportRow(record, 'الحركة موجودة في المصدر ولم تطابق ملفات الشركات المنظمة'));
        continue;
      }
      const classification = classify(record, section, cutoffIso);
      if (!classification) continue;
      const row = reportRow(record, classification);
      const key = `${record.sourceRow}|${record.output.outputFile}|${record.output.outputRow}`;
      reported.add(key);
      if (classification.startsWith('مؤكد')) confirmed.push(row);
      else review.push(row);
    }
    review.push(...chronologicalAnomalies(section, reported));
  }

  const extraRows = extraOutputs.map(output => ({
    'اسم المريض': output.name,
    'رقم التأمين': output.insurance,
    'رقم الموافقة': output.approval,
    'القيمة المالية': output.amount,
    'التاريخ الحالي': output.outputDate,
    'ملف الشركة': output.outputFile,
    'صف ملف الشركة': output.outputRow,
    'سبب التصنيف': 'الحركة موجودة في ملف الشركة المنظم ولم تطابق المصدر الأصلي',
  }));

  const rawKinds = {};
  for (const record of source.records) rawKinds[record.rawKind] = (rawKinds[record.rawKind] || 0) + 1;
  const workbook = new ExcelJS.Workbook();
  addSheet(workbook, 'تصحيحات مؤكدة', confirmed, COLORS.confirmed);
  addSheet(workbook, 'مراجعة يدوية', review, COLORS.review);
  addSheet(workbook, 'مفقودة من المنظم', missing, COLORS.missing);
  addSheet(workbook, 'زائدة في المنظم', extraRows, COLORS.extra);

  const summary = workbook.addWorksheet('ملخص', { views: [{ rightToLeft: true }] });
  summary.addRow(['البيان', 'القيمة']);
  [
    ['ملف المصدر', path.basename(SOURCE_FILE)],
    ['ورقة المصدر', source.sheetName],
    ['تاريخ آخر تعديل للمصدر', cutoffIso],
    ['أقسام الشركات في المصدر', source.sections.length],
    ['الحركات الفعلية في المصدر', source.records.length],
    ['ملفات الشركات المنظمة', company.files.length],
    ['الحركات في الملفات المنظمة', company.records.length],
    ['خلايا تاريخ Excel الرقمية', rawKinds['excel-serial'] || 0],
    ['خلايا تاريخ نصية صريحة', (rawKinds['text-dmy'] || 0) + (rawKinds['text-iso'] || 0)],
    ['تصحيحات مؤكدة', confirmed.length],
    ['حالات مراجعة يدوية', review.length],
    ['حركات مصدر مفقودة من المنظم', missing.length],
    ['حركات منظمة زائدة عن المصدر', extraRows.length],
    ['تنبيه', 'هذا تقرير تحقق فقط ولم يعدّل ملفات الشركات أو قاعدة البيانات.'],
  ].forEach(row => summary.addRow(row));
  styleHeader(summary.getRow(1));
  summary.getColumn(1).width = 42;
  summary.getColumn(2).width = 90;

  const legend = workbook.addWorksheet('دليل الألوان', { views: [{ rightToLeft: true }] });
  legend.addRow(['اللون', 'المعنى']);
  [
    [COLORS.confirmed, 'أزرق: انقلاب يوم/شهر مؤكد وفق تاريخ الملف وتسلسل حركات الشركة'],
    [COLORS.review, 'برتقالي: يحتاج مراجعة يدوية قبل تعديل ملفات الاستيراد'],
    [COLORS.missing, 'بنفسجي: موجود في المصدر وغير موجود في الملفات المنظمة'],
    [COLORS.extra, 'أصفر: موجود في الملفات المنظمة ولم يطابق المصدر'],
  ].forEach(([color, label]) => {
    const row = legend.addRow(['', label]);
    row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
  });
  styleHeader(legend.getRow(1));
  legend.getColumn(1).width = 15;
  legend.getColumn(2).width = 90;

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  await workbook.xlsx.writeFile(OUTPUT_FILE);
  console.log(JSON.stringify({
    source: path.basename(SOURCE_FILE),
    cutoffIso,
    sections: source.sections.length,
    sourceMovements: source.records.length,
    companyFiles: company.files.length,
    organizedMovements: company.records.length,
    rawKinds,
    confirmed: confirmed.length,
    manualReview: review.length,
    missingFromOrganized: missing.length,
    extraInOrganized: extraRows.length,
    confirmedExamples: confirmed.slice(0, 20),
    reviewExamples: review.slice(0, 20),
    outputFile: OUTPUT_FILE,
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
