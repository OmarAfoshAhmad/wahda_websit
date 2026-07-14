const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'date-correction-imports');

const JOBS = [
  {
    service: 'DENTAL',
    label: 'الأسنان',
    source: path.join(ROOT, 'خصومات اسنان كاملة.xlsx'),
    sheet: 'الاسنان ',
    outputDir: path.join(ROOT, 'حركات الشركات للأسنان - جديد'),
    outputPattern: /_Transactions\.xlsx$/i,
    resultFile: 'تصحيح تواريخ حركات الأسنان.xlsx',
  },
  {
    service: 'OPTICS',
    label: 'البصريات',
    source: path.join(ROOT, 'خصومات بصريات.xlsx'),
    sheet: 'النظارات',
    outputDir: path.join(ROOT, 'حركات الشركات للبصريات - جديد'),
    outputPattern: /_Transactions_Optics\.xlsx$/i,
    resultFile: 'تصحيح تواريخ حركات البصريات.xlsx',
  },
];

const DAY_MS = 86_400_000;

function clean(value) {
  return String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalized(value) {
  return clean(value).toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
}

function numericAmount(value) {
  const parsed = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function amountKey(value) {
  return numericAmount(value).toFixed(3);
}

function movementKey(record) {
  return [
    normalized(record.insurance),
    normalized(record.approval),
    amountKey(record.amount),
    normalized(record.name),
  ].join('|');
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

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function dateCandidates(value) {
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return { candidates: [], rawKind: 'excel-invalid' };
    const stored = isoFromParts(parsed.y, parsed.m, parsed.d);
    return {
      candidates: unique([stored, swappedIso(stored)]),
      stored,
      rawKind: 'excel-serial',
    };
  }

  let str = clean(value);
  if (!str) return { candidates: [], rawKind: 'blank' };
  str = str
    .replace(/2026\d$/, '2026')
    .replace(/20026$/, '2026')
    .replace(/\/026$/, '/2026')
    .replace(/\/206$/, '/2026')
    .replace(/\/22026$/, '/2/2026')
    .replace(/\/82026$/, '/2026');

  let match = str.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,5})$/);
  if (match) {
    let year = match[3];
    if (year.length === 2) year = `20${year}`;
    if (['206', '026', '20262', '20026', '20263'].includes(year)) year = '2026';
    const dmy = isoFromParts(year, match[2], match[1]);
    return { candidates: unique([dmy]), stored: dmy, rawKind: 'text-dmy' };
  }

  match = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    const iso = isoFromParts(match[1], match[2], match[3]);
    return { candidates: unique([iso]), stored: iso, rawKind: 'text-iso' };
  }

  match = str.match(/^(\d{1,2})[\/\-](\d{4})$/);
  if (match) {
    const iso = isoFromParts(match[2], 1, match[1]);
    return { candidates: unique([iso]), stored: iso, rawKind: 'text-missing-month' };
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
  match = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (match) return isoFromParts(match[3].length === 2 ? `20${match[3]}` : match[3], match[2], match[1]);
  return str;
}

function findHeaderColumns(row) {
  const values = (row || []).map(clean);
  return {
    name: values.findIndex(value => value.includes('اسم المريض')),
    insurance: values.findIndex(value => value.includes('رقم التأمين') || value.includes('رقم التامين')),
    approval: values.findIndex(value => value.includes('رقم الموافقة')),
    amount: values.findIndex(value => value.includes('القيمة المالية')),
    date: values.findIndex(value => value.includes('التاريخ')),
    facility: values.findIndex(value => value.includes('المرفق') || value.includes('الجيهة') || value.includes('الجهة')),
    notes: values.findIndex(value => value.includes('ملاحظات') || value.includes('الملاحظات')),
  };
}

function readSource(job) {
  const workbook = XLSX.readFile(job.source, { cellDates: false, cellNF: true, cellText: true });
  const sheet = workbook.Sheets[job.sheet];
  if (!sheet) throw new Error(`لم يتم العثور على ورقة ${job.sheet}`);
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
  const sections = [];
  let current = null;

  for (let rowIndex = 0; rowIndex < data.length; rowIndex += 1) {
    const columns = findHeaderColumns(data[rowIndex]);
    if (columns.name >= 0) {
      if (current) sections.push(current);
      current = { headerRow: rowIndex + 1, columns, records: [] };
      continue;
    }
    if (!current) continue;
    const row = data[rowIndex] || [];
    const insurance = clean(row[current.columns.insurance]);
    if (!/^[A-Za-z]/.test(insurance)) continue;
    const cellAddress = XLSX.utils.encode_cell({ r: rowIndex, c: current.columns.date });
    const cell = sheet[cellAddress] || {};
    current.records.push({
      sourceRow: rowIndex + 1,
      sourceCell: cellAddress,
      sectionHeaderRow: current.headerRow,
      name: clean(row[current.columns.name]),
      insurance,
      approval: clean(row[current.columns.approval]),
      amount: numericAmount(row[current.columns.amount]),
      sourceDateRaw: row[current.columns.date],
      sourceDateDisplay: clean(cell.w ?? row[current.columns.date]),
      sourceDateFormat: clean(cell.z),
      ...dateCandidates(row[current.columns.date]),
    });
  }
  if (current) sections.push(current);
  return sections;
}

function readOutputs(job) {
  const records = [];
  const files = fs.readdirSync(job.outputDir).filter(file => job.outputPattern.test(file));
  for (const file of files) {
    const workbook = XLSX.readFile(path.join(job.outputDir, file), { cellDates: false });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
    const columns = findHeaderColumns(data[0]);
    for (let rowIndex = 1; rowIndex < data.length; rowIndex += 1) {
      const row = data[rowIndex] || [];
      const insurance = clean(row[columns.insurance]);
      if (!insurance) continue;
      records.push({
        outputFile: file,
        outputRow: rowIndex + 1,
        name: clean(row[columns.name]),
        insurance,
        approval: clean(row[columns.approval]),
        amount: numericAmount(row[columns.amount]),
        outputDate: parseOutputDate(row[columns.date]),
        facility: clean(row[columns.facility]),
        notes: clean(row[columns.notes]),
      });
    }
  }
  return records;
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
    const rowStates = record.candidates.map((candidate, candidateIndex) => {
      let bestCost = choiceCost(candidate, cutoffDay);
      let previousIndex = -1;
      if (index > 0) {
        bestCost = Number.POSITIVE_INFINITY;
        for (let priorIndex = 0; priorIndex < states[index - 1].length; priorIndex += 1) {
          const prior = states[index - 1][priorIndex];
          const cost = prior.cost + transitionCost(prior.iso, candidate) + choiceCost(candidate, cutoffDay);
          if (cost < bestCost) {
            bestCost = cost;
            previousIndex = priorIndex;
          }
        }
      }
      return { iso: candidate, cost: bestCost, previousIndex, candidateIndex };
    });
    states.push(rowStates);
  }

  let selectedIndex = states.at(-1).reduce((best, state, index, array) => (
    state.cost < array[best].cost ? index : best
  ), 0);
  for (let index = dated.length - 1; index >= 0; index -= 1) {
    const selected = states[index][selectedIndex];
    dated[index].inferredDate = selected.iso;
    dated[index].inference = dated[index].candidates.length === 1
      ? 'تاريخ صريح'
      : selected.iso === dated[index].stored
        ? 'ابقاء تاريخ Excel وفق التسلسل'
        : 'قلب اليوم والشهر وفق التسلسل';
    selectedIndex = selected.previousIndex;
  }
}

function matchSourceToOutputs(sections, outputs) {
  const outputGroups = new Map();
  for (const output of outputs) {
    const key = movementKey(output);
    if (!outputGroups.has(key)) outputGroups.set(key, []);
    outputGroups.get(key).push(output);
  }

  for (const section of sections) {
    for (const source of section.records) {
      const pool = outputGroups.get(movementKey(source)) || [];
      let index = pool.findIndex(output => output.outputDate === source.stored);
      if (index < 0) index = 0;
      source.output = pool.length ? pool.splice(index, 1)[0] : null;
    }
  }
}

function confidenceFor(record, section, cutoffIso) {
  if (!record.output || !record.inferredDate || record.inferredDate === record.output.outputDate) return '';
  if (record.output.outputDate > cutoffIso && record.inferredDate <= cutoffIso) return 'مؤكد - التاريخ القديم بعد تاريخ الملف';

  const dated = section.records.filter(item => item.inferredDate);
  const index = dated.indexOf(record);
  const previous = index > 0 ? dated[index - 1] : null;
  const next = index + 1 < dated.length ? dated[index + 1] : null;
  const oldDay = isoDay(record.output.outputDate);
  const newDay = isoDay(record.inferredDate);
  const previousDay = previous ? isoDay(previous.inferredDate) : Number.NaN;
  const nextDay = next ? isoDay(next.inferredDate) : Number.NaN;
  const oldBreaksPrevious = Number.isFinite(previousDay) && oldDay < previousDay;
  const oldBreaksNext = Number.isFinite(nextDay) && oldDay > nextDay;
  const newFitsPrevious = !Number.isFinite(previousDay) || newDay >= previousDay;
  const newFitsNext = !Number.isFinite(nextDay) || newDay <= nextDay;
  if ((oldBreaksPrevious || oldBreaksNext) && newFitsPrevious && newFitsNext) {
    return 'مؤكد - التاريخ المصحح يعيد التسلسل';
  }
  return 'مراجعة يدوية - الاحتمالان لا يكسران التسلسل مباشرة';
}

function oldIdempotencyKey(job, output) {
  if (!output) return '';
  const prefix = job.service === 'DENTAL' ? 'import-dental-tx' : 'import-optics-tx';
  return `${prefix}:${output.outputRow}:${output.insurance}:${output.amount}:${output.outputDate}`;
}

function correctionRow(job, record, confidence) {
  const output = record.output;
  return {
    'اسم المريض': output.name,
    'رقم التأمين': output.insurance,
    'رقم الموافقة': output.approval,
    'القيمة المالية': output.amount,
    'التاريخ المصحح': record.inferredDate,
    'المرفق الصحي': output.facility,
    'ملاحظات': output.notes,
    'التاريخ القديم': output.outputDate,
    'نوع الخدمة': job.service,
    'ملف الشركة الأصلي': output.outputFile,
    'صف ملف الشركة الأصلي': output.outputRow,
    'صف المصدر': record.sourceRow,
    'خلية المصدر': record.sourceCell,
    'القيمة الظاهرة في المصدر': record.sourceDateDisplay,
    'طريقة الاستنتاج': record.inference,
    'درجة الثقة': confidence,
    'مفتاح الحركة القديمة المتوقع': oldIdempotencyKey(job, output),
  };
}

function makeSheet(rows, headers) {
  const data = [headers, ...rows.map(row => headers.map(header => row[header] ?? ''))];
  const sheet = XLSX.utils.aoa_to_sheet(data);
  sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, data.length - 1), c: headers.length - 1 } }) };
  sheet['!cols'] = headers.map(header => ({ wch: Math.min(38, Math.max(13, header.length + 3)) }));
  sheet['!views'] = [{ rightToLeft: true }];
  return sheet;
}

function generate(job) {
  const cutoffIso = fs.statSync(job.source).mtime.toISOString().slice(0, 10);
  const sections = readSource(job);
  const outputs = readOutputs(job);
  for (const section of sections) inferSection(section, cutoffIso);
  matchSourceToOutputs(sections, outputs);

  const confirmed = [];
  const review = [];
  const unmatched = [];
  for (const section of sections) {
    for (const record of section.records) {
      if (!record.inferredDate || !record.output) {
        if (record.candidates.length && !record.output) unmatched.push(record);
        continue;
      }
      if (record.inferredDate === record.output.outputDate) continue;
      const confidence = confidenceFor(record, section, cutoffIso);
      const row = correctionRow(job, record, confidence);
      if (confidence.startsWith('مؤكد')) confirmed.push(row);
      else review.push(row);
    }
  }

  confirmed.sort((a, b) => String(a['ملف الشركة الأصلي']).localeCompare(String(b['ملف الشركة الأصلي'])) || a['صف ملف الشركة الأصلي'] - b['صف ملف الشركة الأصلي']);
  review.sort((a, b) => String(a['ملف الشركة الأصلي']).localeCompare(String(b['ملف الشركة الأصلي'])) || a['صف ملف الشركة الأصلي'] - b['صف ملف الشركة الأصلي']);

  const headers = [
    'اسم المريض', 'رقم التأمين', 'رقم الموافقة', 'القيمة المالية', 'التاريخ المصحح', 'المرفق الصحي', 'ملاحظات',
    'التاريخ القديم', 'نوع الخدمة', 'ملف الشركة الأصلي', 'صف ملف الشركة الأصلي', 'صف المصدر', 'خلية المصدر',
    'القيمة الظاهرة في المصدر', 'طريقة الاستنتاج', 'درجة الثقة', 'مفتاح الحركة القديمة المتوقع',
  ];
  const summary = [
    { 'البيان': 'نوع الخدمة', 'القيمة': job.label },
    { 'البيان': 'تاريخ آخر تعديل لملف المصدر', 'القيمة': cutoffIso },
    { 'البيان': 'تصحيحات مؤكدة', 'القيمة': confirmed.length },
    { 'البيان': 'حالات تحتاج مراجعة يدوية', 'القيمة': review.length },
    { 'البيان': 'حركات مصدر لم تطابق ملفًا منظمًا', 'القيمة': unmatched.length },
    { 'البيان': 'تنبيه', 'القيمة': 'لا تستورد هذا الملف بالمستورد الحالي قبل إضافة وضع تصحيح التاريخ؛ الاستيراد العادي ينشئ حركة جديدة.' },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, makeSheet(confirmed, headers), 'تصحيحات مؤكدة');
  XLSX.utils.book_append_sheet(workbook, makeSheet(review, headers), 'مراجعة يدوية');
  const unmatchedRows = unmatched.map(record => ({
    'اسم المريض': record.name,
    'رقم التأمين': record.insurance,
    'رقم الموافقة': record.approval,
    'القيمة المالية': record.amount,
    'صف المصدر': record.sourceRow,
    'خلية المصدر': record.sourceCell,
    'القيمة الظاهرة في المصدر': record.sourceDateDisplay,
    'التاريخ المستنتج': record.inferredDate || '',
    'سبب العزل': 'لم يتم العثور على الحركة المطابقة في ملفات الشركات المنظمة',
  }));
  const unmatchedHeaders = ['اسم المريض', 'رقم التأمين', 'رقم الموافقة', 'القيمة المالية', 'صف المصدر', 'خلية المصدر', 'القيمة الظاهرة في المصدر', 'التاريخ المستنتج', 'سبب العزل'];
  XLSX.utils.book_append_sheet(workbook, makeSheet(unmatchedRows, unmatchedHeaders), 'غير موجودة بالمنظم');
  XLSX.utils.book_append_sheet(workbook, makeSheet(summary, ['البيان', 'القيمة']), 'ملخص');
  const resultPath = path.join(OUTPUT_DIR, job.resultFile);
  XLSX.writeFile(workbook, resultPath);
  return { job, cutoffIso, confirmed, review, unmatched, resultPath };
}

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
const results = JOBS.map(generate);
for (const result of results) {
  console.log(JSON.stringify({
    service: result.job.label,
    cutoff: result.cutoffIso,
    confirmed: result.confirmed.length,
    manualReview: result.review.length,
    unmatched: result.unmatched.length,
    file: result.resultPath,
  }, null, 2));
}
