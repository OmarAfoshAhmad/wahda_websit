const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const ROOT = path.resolve(__dirname, '..');

const jobs = [
  {
    label: 'الأسنان',
    source: path.join(ROOT, 'خصومات اسنان كاملة.xlsx'),
    sheet: 'الاسنان ',
    outputDir: path.join(ROOT, 'حركات الشركات للأسنان - جديد'),
    outputPattern: /_Transactions\.xlsx$/i,
  },
  {
    label: 'البصريات',
    source: path.join(ROOT, 'خصومات بصريات.xlsx'),
    sheet: 'النظارات',
    outputDir: path.join(ROOT, 'حركات الشركات للبصريات - جديد'),
    outputPattern: /_Transactions_Optics\.xlsx$/i,
  },
];

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalized(value) {
  return clean(value).toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
}

function amountKey(value) {
  const parsed = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed.toFixed(3) : '';
}

function recordKey(record) {
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
  if (m < 1 || m > 12 || d < 1 || d > 31) return '';
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseSourceDate(value) {
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return { iso: '', type: 'number-invalid' };
    return { iso: isoFromParts(parsed.y, parsed.m, parsed.d), type: 'excel-serial' };
  }

  const str = clean(value);
  if (!str) return { iso: '', type: 'blank' };
  let fixed = str
    .replace(/2026\d$/, '2026')
    .replace(/20026$/, '2026')
    .replace(/\/026$/, '/2026')
    .replace(/\/206$/, '/2026')
    .replace(/\/22026$/, '/2/2026');
  let match = fixed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,5})$/);
  if (match) {
    let year = match[3];
    if (year.length === 2) year = `20${year}`;
    if (['206', '026', '20262', '20026', '20263'].includes(year)) year = '2026';
    return { iso: isoFromParts(year, match[2], match[1]), type: 'text-dmy' };
  }
  match = fixed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) return { iso: isoFromParts(match[1], match[2], match[3]), type: 'text-iso' };
  return { iso: fixed, type: 'text-unparsed' };
}

function parseOutputDate(value) {
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    return parsed ? isoFromParts(parsed.y, parsed.m, parsed.d) : '';
  }
  const str = clean(value);
  const iso = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return isoFromParts(iso[1], iso[2], iso[3]);
  const dmy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (dmy) return isoFromParts(dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3], dmy[2], dmy[1]);
  return str;
}

function swappedIso(iso) {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (day > 12 || month === day) return '';
  return isoFromParts(match[1], day, month);
}

function isSwapCandidate(record) {
  if (record.type !== 'excel-serial') return false;
  return Boolean(swappedIso(record.iso));
}

function findSections(data) {
  const sections = [];
  let current = null;
  for (let index = 0; index < data.length; index += 1) {
    const row = data[index] || [];
    const values = row.map(clean);
    const headerIndex = values.findIndex(value => value.includes('اسم المريض'));
    if (headerIndex >= 0) {
      if (current) sections.push(current);
      current = {
        headerRow: index,
        startRow: index + 1,
        colName: headerIndex,
        colIns: values.findIndex(value => value.includes('رقم التأمين') || value.includes('رقم التامين')),
        colApproval: values.findIndex(value => value.includes('رقم الموافقة')),
        colAmount: values.findIndex(value => value.includes('القيمة المالية')),
        colDate: values.findIndex(value => value.includes('التاريخ')),
      };
      continue;
    }
    if (current) current.endRow = index;
  }
  if (current) sections.push(current);
  return sections;
}

function readSource(job) {
  const workbook = XLSX.readFile(job.source, { cellDates: false, cellNF: true, cellText: true });
  const sheet = workbook.Sheets[job.sheet];
  if (!sheet) throw new Error(`Missing sheet ${job.sheet} in ${job.source}`);
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
  const sections = findSections(data);
  const records = [];
  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
    const section = sections[sectionIndex];
    const nextHeader = sections[sectionIndex + 1]?.headerRow ?? data.length;
    for (let rowIndex = section.startRow; rowIndex < nextHeader; rowIndex += 1) {
      const row = data[rowIndex] || [];
      const insurance = clean(row[section.colIns]);
      if (!/^[A-Za-z]/.test(insurance)) continue;
      const name = clean(row[section.colName]);
      const approval = clean(row[section.colApproval]);
      const amount = row[section.colAmount];
      const rawDate = row[section.colDate];
      const cellAddress = XLSX.utils.encode_cell({ r: rowIndex, c: section.colDate });
      const cell = sheet[cellAddress] || {};
      records.push({
        name,
        insurance,
        approval,
        amount,
        row: rowIndex + 1,
        cell: cellAddress,
        rawDate,
        displayDate: cell.w ?? '',
        numberFormat: cell.z ?? '',
        cellType: cell.t ?? '',
        ...parseSourceDate(rawDate),
      });
    }
  }
  return { records, sections };
}

function readOutputs(job) {
  const records = [];
  const files = fs.readdirSync(job.outputDir).filter(file => job.outputPattern.test(file));
  for (const file of files) {
    const workbook = XLSX.readFile(path.join(job.outputDir, file), { cellDates: false });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
    const header = (data[0] || []).map(clean);
    const columns = {
      name: header.findIndex(value => value.includes('اسم المريض')),
      insurance: header.findIndex(value => value.includes('رقم التأمين') || value.includes('رقم التامين')),
      approval: header.findIndex(value => value.includes('رقم الموافقة')),
      amount: header.findIndex(value => value.includes('القيمة المالية')),
      date: header.findIndex(value => value.includes('التاريخ')),
    };
    for (let index = 1; index < data.length; index += 1) {
      const row = data[index] || [];
      const insurance = clean(row[columns.insurance]);
      if (!insurance) continue;
      records.push({
        file,
        row: index + 1,
        name: clean(row[columns.name]),
        insurance,
        approval: clean(row[columns.approval]),
        amount: row[columns.amount],
        rawDate: row[columns.date],
        iso: parseOutputDate(row[columns.date]),
      });
    }
  }
  return { records, files };
}

function groupByKey(records) {
  const map = new Map();
  for (const record of records) {
    const key = recordKey(record);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(record);
  }
  return map;
}

function consumeMatch(pool, predicate) {
  const index = pool.findIndex(predicate);
  return index >= 0 ? pool.splice(index, 1)[0] : null;
}

function audit(job) {
  const source = readSource(job);
  const output = readOutputs(job);
  const sourceGroups = groupByKey(source.records);
  const outputGroups = groupByKey(output.records);
  const categories = { exact: [], swapped: [], different: [], missingOutput: [], extraOutput: [] };

  for (const [key, sourceRecords] of sourceGroups) {
    const remaining = [...(outputGroups.get(key) || [])];
    const unmatchedSources = [];
    for (const sourceRecord of sourceRecords) {
      const found = consumeMatch(remaining, outputRecord => outputRecord.iso === sourceRecord.iso);
      if (found) categories.exact.push({ source: sourceRecord, output: found });
      else unmatchedSources.push(sourceRecord);
    }
    for (const sourceRecord of unmatchedSources) {
      const swap = swappedIso(sourceRecord.iso);
      const found = swap ? consumeMatch(remaining, outputRecord => outputRecord.iso === swap) : null;
      if (found) categories.swapped.push({ source: sourceRecord, output: found });
      else if (remaining.length) categories.different.push({ source: sourceRecord, output: remaining.shift() });
      else categories.missingOutput.push({ source: sourceRecord });
    }
    for (const outputRecord of remaining) categories.extraOutput.push({ output: outputRecord });
    outputGroups.delete(key);
  }
  for (const records of outputGroups.values()) {
    for (const outputRecord of records) categories.extraOutput.push({ output: outputRecord });
  }

  const sourceTypeCounts = {};
  const formats = {};
  for (const record of source.records) {
    sourceTypeCounts[record.type] = (sourceTypeCounts[record.type] || 0) + 1;
    const formatKey = `${record.cellType}|${record.numberFormat}|${record.displayDate}`;
    formats[formatKey] = (formats[formatKey] || 0) + 1;
  }

  const outputByKey = groupByKey(output.records);
  const swapCandidates = source.records.filter(isSwapCandidate).map(record => {
    const matches = outputByKey.get(recordKey(record)) || [];
    return {
      source: record,
      output: matches.find(candidate => candidate.iso === record.iso),
      proposedIso: swappedIso(record.iso),
    };
  });

  return { job, source, output, categories, sourceTypeCounts, formats, swapCandidates };
}

function printExamples(title, records, limit = 12) {
  console.log(`\n${title} (${records.length})`);
  for (const item of records.slice(0, limit)) {
    const source = item.source || (Object.prototype.hasOwnProperty.call(item, 'displayDate') ? item : null);
    const output = item.output;
    console.log(JSON.stringify({
      insurance: source?.insurance ?? output?.insurance,
      name: source?.name ?? output?.name,
      sourceRow: source?.row,
      sourceCell: source?.cell,
      sourceRaw: source?.rawDate,
      sourceDisplay: source?.displayDate,
      sourceFormat: source?.numberFormat,
      sourceType: source?.type,
      sourceIso: source?.iso,
      outputFile: output?.file,
      outputRow: output?.row,
      outputRaw: output?.rawDate,
      outputIso: output?.iso,
    }, null, 0));
  }
}

for (const job of jobs) {
  const result = audit(job);
  const { categories } = result;
  console.log(`\n========== ${job.label} ==========`);
  console.log(JSON.stringify({
    sourceFile: path.basename(job.source),
    sourceRows: result.source.records.length,
    sections: result.source.sections.length,
    outputFiles: result.output.files.length,
    outputRows: result.output.records.length,
    sourceDateTypes: result.sourceTypeCounts,
    exact: categories.exact.length,
    dayMonthSwapped: categories.swapped.length,
    otherDifferent: categories.different.length,
    missingOutput: categories.missingOutput.length,
    extraOutput: categories.extraOutput.length,
  }, null, 2));
  const numberFormats = {};
  for (const record of result.source.records.filter(record => record.type === 'excel-serial')) {
    const key = record.numberFormat || '(blank)';
    numberFormats[key] = (numberFormats[key] || 0) + 1;
  }
  console.log('تنسيقات خلايا التاريخ الرقمية:', JSON.stringify(numberFormats, null, 2));
  const numericRecords = result.source.records.filter(record => record.type === 'excel-serial');
  const numericEqualDayMonth = numericRecords.filter(record => {
    const match = record.iso.match(/^\d{4}-(\d{2})-(\d{2})$/);
    return match && match[1] === match[2];
  }).length;
  const numericUnambiguous = numericRecords.length - result.swapCandidates.length - numericEqualDayMonth;
  const candidatesByOutput = {};
  for (const candidate of result.swapCandidates) {
    const file = candidate.output?.file || '(غير موجود في المجلد المنظم)';
    candidatesByOutput[file] = (candidatesByOutput[file] || 0) + 1;
  }
  const sourceModified = fs.statSync(job.source).mtime;
  const sourceModifiedIso = sourceModified.toISOString().slice(0, 10);
  const storedAfterSourceFile = numericRecords.filter(record => record.iso > sourceModifiedIso).length;
  const candidateStoredAfterSourceFile = result.swapCandidates.filter(candidate => candidate.source.iso > sourceModifiedIso).length;
  const candidateCorrectedOnOrBeforeSourceFile = result.swapCandidates.filter(candidate => (
    candidate.source.iso > sourceModifiedIso && candidate.proposedIso <= sourceModifiedIso
  )).length;
  console.log('تحليل قابلية انقلاب اليوم/الشهر:', JSON.stringify({
    sourceModifiedIso,
    candidates: result.swapCandidates.length,
    sameDayAndMonth: numericEqualDayMonth,
    unambiguousDayAbove12: numericUnambiguous,
    storedDatesAfterSourceFile: storedAfterSourceFile,
    swappedCandidatesAfterSourceFile: candidateStoredAfterSourceFile,
    futureCandidatesResolvedBySwap: candidateCorrectedOnOrBeforeSourceFile,
    candidatesByOutput,
  }, null, 2));
  const unresolvedFuture = result.swapCandidates.filter(candidate => (
    candidate.source.iso > sourceModifiedIso && candidate.proposedIso > sourceModifiedIso
  ));
  if (unresolvedFuture.length) {
    console.log('مرشحات مستقبلية لا يحلها الانقلاب وحده:', JSON.stringify(unresolvedFuture.map(candidate => ({
      insurance: candidate.source.insurance,
      cell: candidate.source.cell,
      displayed: candidate.source.displayDate,
      storedIso: candidate.source.iso,
      proposedIso: candidate.proposedIso,
      outputFile: candidate.output?.file,
      outputRow: candidate.output?.row,
    })), null, 2));
  }
  console.log('\nأمثلة مرشحة للتصحيح (من تسلسل Excel إلى يوم/شهر المقصود):');
  for (const candidate of result.swapCandidates.slice(0, 20)) {
    console.log(JSON.stringify({
      insurance: candidate.source.insurance,
      name: candidate.source.name,
      sourceCell: candidate.source.cell,
      displayed: candidate.source.displayDate,
      storedIso: candidate.source.iso,
      proposedIso: candidate.proposedIso,
      outputFile: candidate.output?.file,
      outputRow: candidate.output?.row,
      outputIso: candidate.output?.iso,
    }));
  }
  printExamples('أمثلة انقلاب اليوم والشهر', categories.swapped);
  printExamples('أمثلة اختلافات أخرى', categories.different);
  printExamples('أمثلة حركات في المصدر غير موجودة في المجلد المنظم', categories.missingOutput, 25);
  printExamples('أمثلة الخلايا الرقمية من الأصل', result.source.records.filter(record => record.type === 'excel-serial'), 15);
  printExamples('أمثلة الخلايا النصية من الأصل', result.source.records.filter(record => record.type.startsWith('text-')), 15);
}
