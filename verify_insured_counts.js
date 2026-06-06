/**
 * verify_insured_counts.js
 * التحقق من تطابق أعداد المؤمنين بين ملف الإحصائية وملفات الاستيراد والمصادر
 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

// ========================================================
// 1. ملف الإحصائية (الأعداد الرسمية)
// ========================================================
const statsWb = XLSX.readFile('عدد مؤمنين الشركات (1).xlsx');
const statsWs = statsWb.Sheets[statsWb.SheetNames[0]];
const statsData = XLSX.utils.sheet_to_json(statsWs, { header: 1 });

const officialStats = {};
statsData.slice(1).forEach(row => {
  if (!row[1]) return;
  const company = String(row[1]).trim();
  const count = row[2];
  const type = String(row[3] || '').trim();
  officialStats[company] = { official: count, type };
});

console.log('='.repeat(70));
console.log('  تقرير التحقق من أعداد المؤمنين - شركات الأسنان');
console.log('='.repeat(70));

// ========================================================
// 2. ملفات الاستيراد الجاهزة - حساب الأعداد الفعلية
// ========================================================
const importDir = 'اسماء شركات الاسنان جاهزة للاستيراد';

// دالة تحليل ملف الاستيراد
function analyzeImportFile(filePath) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const dataRows = data.slice(1).filter(r => r.some(c => c !== null && c !== undefined && String(c).trim() !== ''));
  
  const cardNums = dataRows.map(r => String(r[1] || '').trim());
  
  // البطاقة الرئيسية: لا تنتهي بحرف+رقم (W1, D1, S1, F1, M1...)
  const mainCards = cardNums.filter(c => c && c.match(/^[A-Z0-9]+[0-9]$/) && !c.match(/[WDFMSwdfms]\d+$/i));
  // معالين
  const depCards = cardNums.filter(c => c && c.match(/[WDFMSwdfms]\d+$/i));
  // بدون بطاقة
  const noCard = cardNums.filter(c => !c);
  
  return {
    total: dataRows.length,
    mainCards: mainCards.length,
    depCards: depCards.length,
    noCard: noCard.length
  };
}

// دالة تحليل ملفات المصدر (MERG)
function analyzeSourceFile(dir, cardColIndex, empIdentifier) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.xlsx'));
  if (!files.length) return { total: 0, mainEmp: 0, noCard: 0 };
  
  const wb = XLSX.readFile(path.join(dir, files[0]));
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
  
  return { total: data.length, file: files[0] };
}

// ========================================================
// 3. بيانات الاستيراد الجاهزة
// ========================================================
const importFiles = {
  'أركاديا':       { file: 'Arcadia_List_Import.xlsx',      code: 'ARCAD' },
  'الاسمنت':       { file: 'Cement_List_Import.xlsx',       code: 'LCC'   },
  'فيوتشر':        { file: 'Future_List_Import.xlsx',       code: 'FUTU'  },
  'حجر الماس':     { file: 'Hajar_List_Import.xlsx',        code: 'HJR'   },
  'جمارك':         { file: 'Jamarek_List_Import.xlsx',      code: 'JMR'   },
  'اوزون':         { file: 'OZONE_List_Import.xlsx',        code: 'O3G'   },
  'الرواق':        { file: 'Rewaq_List_Import.xlsx',        code: 'RWG'   },
  'توسيالي':       { file: 'Tosyali_List_Import.xlsx',      code: 'TOSY'  },
  'فيجن':          { file: 'Vision_List_Import.xlsx',       code: 'VISN'  },
  'وعد المعماري':  { file: 'Waad_Architect_List_Import.xlsx', code: 'WCA' },
  'وعد':           { file: 'Waad_List_Import.xlsx',         code: 'WAAD'  },
  'الواحة':        { file: 'Waha_List_Import.xlsx',         code: 'WAHA'  },
};

const importCounts = {};
for (const [company, info] of Object.entries(importFiles)) {
  const filePath = path.join(importDir, info.file);
  if (fs.existsSync(filePath)) {
    importCounts[company] = analyzeImportFile(filePath);
    importCounts[company].file = info.file;
  } else {
    importCounts[company] = { total: 0, mainCards: 0, depCards: 0, noCard: 0, file: 'NOT FOUND' };
  }
}

// ========================================================
// 4. بيانات المصادر الأصلية (MERG)
// ========================================================
function countMergARCADIA() {
  const d = 'MERG ARCADIA';
  const f = fs.readdirSync(d)[0];
  const wb = XLSX.readFile(path.join(d, f));
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const nonEmpty = data.filter(r => r.some(c => c !== null && c !== undefined && String(c).trim() !== ''));
  const mainEmp = nonEmpty.filter(r => {
    const id = String(r[9] || '').trim();
    return id.match(/^ARCAD\d{8}$/) || id.match(/^ARCAD\d+[^A-Za-z]/);
  });
  const deps = nonEmpty.filter(r => {
    const id = String(r[9] || '').trim();
    return id.match(/^ARCAD\d+[A-Za-z]\d+$/);
  });
  return { file: f, totalNonEmpty: nonEmpty.length, mainEmp: mainEmp.length, deps: deps.length };
}

function countMergHJR() {
  const d = 'MERG HJR';
  const f = fs.readdirSync(d)[0];
  const wb = XLSX.readFile(path.join(d, f));
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const mainEmp = data.filter(r => typeof r[0] === 'number' && r[0] > 0);
  const withCard = mainEmp.filter(r => r[4] && String(r[4]).trim() !== '' && String(r[4]).match(/^HJR/));
  const noCard = mainEmp.filter(r => !r[4] || String(r[4]).trim() === '');
  return { file: f, totalEmp: mainEmp.length, withCard: withCard.length, noCard: noCard.length };
}

function countMergWAAD() {
  const d = 'merg waad -tpa';
  const files = fs.readdirSync(d);
  const f = files[0];
  const wb = XLSX.readFile(path.join(d, f));
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const mainEmp = data.filter(r => typeof r[1] === 'number' && r[1] > 0);
  const allPersons = data.filter(r => r[2] && String(r[2]).trim() !== '' && !String(r[2]).includes('الإسم') && !String(r[2]).includes('اسم'));
  const withCard = allPersons.filter(r => r[6] && String(r[6]).match(/^WAAD/));
  return { file: f, mainEmp: mainEmp.length, allPersons: allPersons.length, withCard: withCard.length };
}

function countMergWAADArch() {
  const d = 'merg waad architect';
  const f = fs.readdirSync(d)[0];
  const wb = XLSX.readFile(path.join(d, f));
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const mainEmp = data.filter(r => typeof r[0] === 'number' && r[0] > 0);
  const allPersons = data.filter(r => r[1] && String(r[1]).trim() !== '' && !String(r[1]).includes('الإسم') && !String(r[1]).includes('قائمة'));
  const withCard = data.filter(r => r[8] && String(r[8]).match(/^WCA/));
  return { file: f, mainEmp: mainEmp.length, allPersons: allPersons.length, withCard: withCard.length };
}

function countMergWAHA() {
  const d = 'merg waha';
  const f = fs.readdirSync(d)[0];
  const wb = XLSX.readFile(path.join(d, f));
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const mainEmp = data.filter(r => typeof r[1] === 'number' && r[1] > 0);
  const allPersons = data.filter(r => r[2] && String(r[2]).trim() !== '' && !String(r[2]).includes('الاسم') && !String(r[2]).includes('كشف'));
  const withCard = allPersons.filter(r => r[5] && String(r[5]).match(/^WAHA/));
  return { file: f, mainEmp: mainEmp.length, allPersons: allPersons.length, withCard: withCard.length };
}

const sourceData = {
  'أركاديا':      countMergARCADIA(),
  'حجر الماس':    countMergHJR(),
  'وعد':          countMergWAAD(),
  'وعد المعماري': countMergWAADArch(),
  'الواحة':       countMergWAHA(),
};

// ========================================================
// 5. طباعة التقرير المقارن
// ========================================================
console.log('\n');
console.log('الشركة'.padEnd(18) + '│ ' + 'إحصائية رسمية'.padEnd(16) + '│ ' + 'جاهزة استيراد (إجمالي)'.padEnd(24) + '│ ' + 'بطاقات رئيسية'.padEnd(16) + '│ ' + 'معالون'.padEnd(10) + '│ ' + 'الحالة');
console.log('─'.repeat(120));

const results = [];
const officialMapping = {
  'أركاديا':      'اركاديا ',
  'الاسمنت':      'الاسمنت',
  'فيوتشر':       'فيوتشر',
  'حجر الماس':    'حجر الماس',
  'جمارك':        'جمارك',
  'اوزون':        'اوزون',
  'الرواق':       'الرواق',
  'توسيالي':      'توسيالي ',
  'فيجن':         'فيجن',
  'وعد المعماري': 'وعد المعماري',
  'وعد':          'وعد',
  'الواحة':       'الواحة',
};

for (const [company, info] of Object.entries(importCounts)) {
  const offKey = officialMapping[company] || company;
  const official = officialStats[offKey] || officialStats[company] || {};
  const offCount = official.official;
  const importTotal = info.total;
  
  let status = '';
  let diff = '';
  
  if (offCount === 'قيد الانجاز') {
    status = '⏳ قيد الإنجاز';
  } else if (typeof offCount === 'number') {
    const delta = importTotal - offCount;
    diff = delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : '=';
    if (delta === 0) status = '✅ مطابق';
    else if (delta > 0) status = `📈 زيادة ${delta}`;
    else status = `❌ نقص ${Math.abs(delta)}`;
  } else {
    status = '❓ غير موجود في الإحصائية';
  }
  
  results.push({ company, offCount, importTotal, mainCards: info.mainCards, depCards: info.depCards, status, diff });
  
  const offStr = offCount === 'قيد الانجاز' ? 'قيد الإنجاز' : (offCount || '---');
  console.log(
    company.padEnd(18) + '│ ' +
    String(offStr).padEnd(16) + '│ ' +
    String(importTotal).padEnd(24) + '│ ' +
    String(info.mainCards).padEnd(16) + '│ ' +
    String(info.depCards).padEnd(10) + '│ ' +
    status
  );
}

// ========================================================
// 6. الشركات في الإحصائية لكن غير موجودة في الاستيراد
// ========================================================
console.log('\n' + '─'.repeat(120));
console.log('⚠️  شركات في الإحصائية الرسمية لكن لا يوجد لها ملف استيراد:');
const coveredCompanies = Object.values(officialMapping);
for (const [company, data] of Object.entries(officialStats)) {
  if (!coveredCompanies.includes(company)) {
    console.log(`   - ${company}: ${data.official} مؤمن (${data.type})`);
  }
}

// ========================================================
// 7. تفاصيل ملفات المصدر المتاحة
// ========================================================
console.log('\n' + '='.repeat(70));
console.log('  تفاصيل ملفات المصدر المرجعية (MERG)');
console.log('='.repeat(70));

const arcData = sourceData['أركاديا'];
console.log(`\nأركاديا (${arcData.file}):`);
console.log(`  موظفين أساسيين: ${arcData.mainEmp}`);
console.log(`  معالون: ${arcData.deps}`);
console.log(`  إجمالي غير فارغ: ${arcData.totalNonEmpty}`);
console.log(`  ↳ ملف الاستيراد الجاهز: ${importCounts['أركاديا'].total} صف`);
console.log(`  ↳ الإحصائية الرسمية: ${officialStats['اركاديا ']?.official || '---'}`);
const arcDiff = importCounts['أركاديا'].total - (officialStats['اركاديا ']?.official || 0);
console.log(`  ↳ الفرق عن الإحصائية: ${arcDiff > 0 ? '+' : ''}${arcDiff}`);

const hjrData = sourceData['حجر الماس'];
console.log(`\nحجر الماس (${hjrData.file}):`);
console.log(`  موظفين في الملف المصدر: ${hjrData.totalEmp}`);
console.log(`  لديهم بطاقة تأمين: ${hjrData.withCard}`);
console.log(`  بدون بطاقة: ${hjrData.noCard}`);
console.log(`  ↳ ملف الاستيراد الجاهز: ${importCounts['حجر الماس'].total} صف`);
console.log(`  ↳ الإحصائية الرسمية: ${officialStats['حجر الماس']?.official || '---'} (${officialStats['حجر الماس']?.type || ''})`);

const waadData = sourceData['وعد'];
console.log(`\nوعد (${waadData.file}):`);
console.log(`  موظفين أساسيين: ${waadData.mainEmp}`);
console.log(`  إجمالي الأشخاص: ${waadData.allPersons}`);
console.log(`  ↳ ملف الاستيراد الجاهز: ${importCounts['وعد'].total} صف`);
console.log(`  ↳ الإحصائية الرسمية: ${officialStats['وعد']?.official || '---'}`);

const wcaData = sourceData['وعد المعماري'];
console.log(`\nوعد المعماري (${wcaData.file}):`);
console.log(`  موظفين أساسيين: ${wcaData.mainEmp}`);
console.log(`  إجمالي الأشخاص: ${wcaData.allPersons}`);
console.log(`  بطاقات WCA: ${wcaData.withCard}`);
console.log(`  ↳ ملف الاستيراد الجاهز: ${importCounts['وعد المعماري'].total} صف`);
console.log(`  ↳ الإحصائية الرسمية: ${officialStats['وعد المعماري']?.official || '---'}`);

const wahaData = sourceData['الواحة'];
console.log(`\nالواحة (${wahaData.file}):`);
console.log(`  موظفين أساسيين: ${wahaData.mainEmp}`);
console.log(`  إجمالي الأشخاص: ${wahaData.allPersons}`);
console.log(`  ↳ ملف الاستيراد الجاهز: ${importCounts['الواحة'].total} صف`);
console.log(`  ↳ الإحصائية الرسمية: ${officialStats['الواحة']?.official || '---'}`);

// ========================================================
// 8. ملخص نهائي
// ========================================================
console.log('\n' + '='.repeat(70));
console.log('  ملخص الحالة');
console.log('='.repeat(70));

const matched = results.filter(r => r.status.includes('مطابق'));
const excess = results.filter(r => r.status.includes('زيادة'));
const deficit = results.filter(r => r.status.includes('نقص'));
const pending = results.filter(r => r.status.includes('قيد'));

console.log(`✅ مطابق تماماً: ${matched.length} شركة`);
matched.forEach(r => console.log(`   - ${r.company}: ${r.offCount} مؤمن`));

console.log(`\n📈 زيادة عن الإحصائية: ${excess.length} شركة`);
excess.forEach(r => console.log(`   - ${r.company}: إحصائية=${r.offCount} / استيراد=${r.importTotal} (${r.diff})`));

console.log(`\n❌ نقص عن الإحصائية: ${deficit.length} شركة`);
deficit.forEach(r => console.log(`   - ${r.company}: إحصائية=${r.offCount} / استيراد=${r.importTotal} (${r.diff})`));

console.log(`\n⏳ قيد الإنجاز: ${pending.length} شركة`);
pending.forEach(r => console.log(`   - ${r.company}`));

// ========================================================
// 9. حفظ التقرير في Excel
// ========================================================
const reportWb = XLSX.utils.book_new();

// ورقة المقارنة الرئيسية
const reportData = [
  ['تقرير التحقق من أعداد المؤمنين - شركات الأسنان'],
  [],
  ['الشركة', 'العدد الرسمي (الإحصائية)', 'نوع التعاقد', 'إجمالي ملف الاستيراد', 'بطاقات رئيسية', 'معالون', 'الفرق', 'الحالة'],
];

for (const r of results) {
  const offKey = officialMapping[r.company] || r.company;
  const offData = officialStats[offKey] || officialStats[r.company] || {};
  reportData.push([
    r.company,
    r.offCount,
    offData.type || '',
    r.importTotal,
    r.mainCards,
    r.depCards,
    r.diff || '',
    r.status
  ]);
}

reportData.push([]);
reportData.push(['شركات في الإحصائية بدون ملف استيراد:']);
for (const [company, data] of Object.entries(officialStats)) {
  if (!coveredCompanies.includes(company)) {
    reportData.push([company, data.official, data.type, 'لا يوجد ملف استيراد', '', '', '', '❌ مفقود']);
  }
}

const reportWs = XLSX.utils.aoa_to_sheet(reportData);
reportWs['!cols'] = [
  { wch: 20 }, { wch: 18 }, { wch: 18 }, { wch: 22 }, { wch: 16 }, { wch: 10 }, { wch: 8 }, { wch: 20 }
];
XLSX.utils.book_append_sheet(reportWb, reportWs, 'مقارنة الأعداد');

// ورقة تفاصيل المصادر
const srcData = [
  ['تفاصيل ملفات المصدر (MERG)'],
  [],
  ['الشركة', 'الملف المصدر', 'موظفين أساسيين (مصدر)', 'إجمالي مع عائلة (مصدر)', 'ملف الاستيراد', 'إجمالي الاستيراد', 'الإحصائية الرسمية'],
  ['أركاديا', arcData.file, arcData.mainEmp, arcData.totalNonEmpty, 'Arcadia_List_Import.xlsx', importCounts['أركاديا'].total, officialStats['اركاديا ']?.official],
  ['حجر الماس', hjrData.file, hjrData.totalEmp, hjrData.totalEmp, 'Hajar_List_Import.xlsx', importCounts['حجر الماس'].total, officialStats['حجر الماس']?.official],
  ['وعد', waadData.file, waadData.mainEmp, waadData.allPersons, 'Waad_List_Import.xlsx', importCounts['وعد'].total, officialStats['وعد']?.official],
  ['وعد المعماري', wcaData.file, wcaData.mainEmp, wcaData.allPersons, 'Waad_Architect_List_Import.xlsx', importCounts['وعد المعماري'].total, officialStats['وعد المعماري']?.official],
  ['الواحة', wahaData.file, wahaData.mainEmp, wahaData.allPersons, 'Waha_List_Import.xlsx', importCounts['الواحة'].total, officialStats['الواحة']?.official],
];
const srcWs = XLSX.utils.aoa_to_sheet(srcData);
srcWs['!cols'] = [{ wch: 18 }, { wch: 40 }, { wch: 22 }, { wch: 22 }, { wch: 30 }, { wch: 18 }, { wch: 18 }];
XLSX.utils.book_append_sheet(reportWb, srcWs, 'تفاصيل المصادر');

const outPath = 'تقرير_التحقق_من_أعداد_المؤمنين.xlsx';
XLSX.writeFile(reportWb, outPath);
console.log(`\n📊 تم حفظ التقرير في: ${outPath}`);
