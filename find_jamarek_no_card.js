/**
 * find_jamarek_no_card.js
 * يجد السجلات في ملف جمارك التي لديها رقم وظيفي لكن بدون رقم بطاقة (#N/A)
 * ويولد ملف شامل في مجلد النواقص
 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const parseDate = v => {
  if (!v) return '';
  if (typeof v === 'number') {
    try {
      const d = XLSX.SSF.parse_date_code(v);
      if (d) return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
    } catch(e) {}
  }
  return String(v).trim();
};

// قراءة ملف المصدر
const wb = XLSX.readFile('اسماء شركات الاسنان/جمارك دمج - Copy.xlsx');
const ws = wb.Sheets['قوة العمومية '];
const data = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });

// قراءة ملف الاستيراد للتحقق
const wbI = XLSX.readFile('اسماء شركات الاسنان جاهزة للاستيراد/Jamarek_List_Import.xlsx');
const wsI = wbI.Sheets[wbI.SheetNames[0]];
const dataI = XLSX.utils.sheet_to_json(wsI, { header: 1 });
const importedCards = new Set(dataI.slice(1).map(r => String(r[1]||'').trim().toUpperCase()).filter(c=>c));

// =============================================
// البحث عن السجلات بدون بطاقة
// =============================================
const validData = data.slice(2); // تخطي العنوان والترويسة
let currentEmpId = null;
let currentEmpJobTitle = null;

const noCardRecords = [];
const allGroups = {};

validData.forEach((r, idx) => {
  // تحديث الرقم الوظيفي الحالي إذا وجد
  if (r[1] && typeof r[1] === 'number') {
    currentEmpId = r[1];
  }

  const name = String(r[2] || '').trim();
  const rel = String(r[3] || '').trim();
  const dob = parseDate(r[4]);
  const card = r[5];
  const note = String(r[6] || '').trim();

  // السجل بدون بطاقة ولديه اسم
  if (name && (!card || card === null || card === '' || card === 0)) {
    const empId = typeof currentEmpId === 'number' ? currentEmpId : null;
    
    noCardRecords.push({
      rowNum: idx + 3,
      empId,
      name,
      rel,
      dob,
      note,
      reason: note || 'غير محدد'
    });

    const key = empId || 'unknown';
    if (!allGroups[key]) allGroups[key] = [];
    allGroups[key].push({ name, rel, dob, note });
  }
});

// فصل الأرقام الوظيفية الصحيحة عن غير الصحيحة
const validEmpGroups = {};
const invalidEmpGroups = {};

Object.entries(allGroups).forEach(([key, rows]) => {
  if (typeof Number(key) === 'number' && !isNaN(Number(key)) && key !== 'unknown') {
    validEmpGroups[key] = rows;
  } else {
    invalidEmpGroups[key] = rows;
  }
});

const totalValid = Object.values(validEmpGroups).reduce((s,r) => s+r.length, 0);
const validEmpCount = Object.keys(validEmpGroups).length;

console.log('='.repeat(60));
console.log('  تحليل سجلات جمارك بدون بطاقة تأمين (#N/A)');
console.log('='.repeat(60));
console.log(`إجمالي السجلات بدون بطاقة: ${noCardRecords.length}`);
console.log(`موظفون بأرقام وظيفية صحيحة: ${validEmpCount} موظف`);
console.log(`إجمالي أفراد عائلاتهم: ${totalValid} فرد`);

// إحصاء الأسباب
const reasons = {};
noCardRecords.forEach(r => {
  const reason = r.reason || 'غير محدد';
  if (!reasons[reason]) reasons[reason] = 0;
  reasons[reason]++;
});
console.log('\nالأسباب:');
Object.entries(reasons).forEach(([r,c]) => console.log(`  - "${r}": ${c} سجل`));

// إحصاء العلاقات
const relations = {};
noCardRecords.forEach(r => {
  const rel = r.rel || '?';
  if (!relations[rel]) relations[rel] = 0;
  relations[rel]++;
});
console.log('\nالعلاقات:');
Object.entries(relations).sort((a,b)=>b[1]-a[1]).forEach(([r,c]) => console.log(`  - ${r}: ${c}`));

// =============================================
// توليد الملف
// =============================================
const outWb = XLSX.utils.book_new();

// ورقة 1: جميع السجلات بدون بطاقة
const sheet1Data = [
  ['تقرير: سجلات جمارك بدون رقم بطاقة (#N/A) - تحتاج دراسة ومعالجة'],
  [],
  ['#', 'الرقم الوظيفي', 'اسم المستفيد', 'صلة القرابة', 'تاريخ الميلاد', 'سبب الغياب', 'ملاحظة إضافية']
];

let counter = 1;
noCardRecords.forEach(r => {
  const empLabel = r.empId ? String(r.empId) : 'غير محدد';
  let actionNote = '';
  if (r.note.includes('خطء') || r.note.includes('خطأ')) {
    actionNote = '⚠️ يحتاج تصحيح الرقم الوطني أو تاريخ الميلاد';
  } else if (!r.note) {
    actionNote = '📋 يحتاج فحص وإضافة رقم بطاقة';
  } else {
    actionNote = '🔍 يحتاج دراسة';
  }
  sheet1Data.push([counter++, empLabel, r.name, r.rel, r.dob, r.note || 'لا توجد ملاحظة', actionNote]);
});

const ws1 = XLSX.utils.aoa_to_sheet(sheet1Data);
ws1['!cols'] = [
  { wch: 5 }, { wch: 14 }, { wch: 35 }, { wch: 16 }, { wch: 14 }, { wch: 40 }, { wch: 45 }
];
ws1['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }];
XLSX.utils.book_append_sheet(outWb, ws1, 'كل السجلات بدون بطاقة');

// ورقة 2: مجمعة حسب الموظف
const sheet2Data = [
  ['مجمع حسب الموظف - الأسرة الكاملة'],
  [],
  ['الرقم الوظيفي', 'اسم المستفيد', 'صلة القرابة', 'تاريخ الميلاد', 'السبب', 'الإجراء المطلوب']
];

Object.entries(validEmpGroups).sort((a,b) => Number(a[0]) - Number(b[0])).forEach(([empId, rows]) => {
  sheet2Data.push(['── موظف رقم: ' + empId + ' ──────── (' + rows.length + ' فرد) ──', '', '', '', '', '']);
  rows.forEach(r => {
    let action = '';
    if (r.note.includes('خطء') || r.note.includes('خطأ')) {
      action = 'تصحيح بيانات ثم إصدار بطاقة';
    } else {
      action = 'مراجعة وإصدار بطاقة';
    }
    sheet2Data.push(['', r.name, r.rel, r.dob, r.note || '—', action]);
  });
  sheet2Data.push([]);
});

const ws2 = XLSX.utils.aoa_to_sheet(sheet2Data);
ws2['!cols'] = [
  { wch: 40 }, { wch: 35 }, { wch: 16 }, { wch: 14 }, { wch: 40 }, { wch: 30 }
];
XLSX.utils.book_append_sheet(outWb, ws2, 'مجمع حسب الموظف');

// ورقة 3: ملخص إحصائي
const sheet3Data = [
  ['ملخص إحصائي - سجلات جمارك بدون بطاقة تأمين'],
  [],
  ['المعطى', 'العدد'],
  ['إجمالي السجلات بدون بطاقة', noCardRecords.length],
  ['عدد الموظفين المتأثرين (برقم وظيفي)', validEmpCount],
  [],
  ['الأسباب', ''],
];
Object.entries(reasons).forEach(([r,c]) => sheet3Data.push([r || 'غير محدد', c]));

sheet3Data.push([]);
sheet3Data.push(['توزيع العلاقات (صلة القرابة)', '']);
Object.entries(relations).sort((a,b)=>b[1]-a[1]).forEach(([r,c]) => sheet3Data.push([r, c]));

sheet3Data.push([]);
sheet3Data.push(['الموظفون المتأثرون', '']);
Object.entries(validEmpGroups).sort((a,b) => Number(a[0]) - Number(b[0])).forEach(([empId, rows]) => {
  sheet3Data.push([`موظف #${empId}`, `${rows.length} فرد`]);
});

const ws3 = XLSX.utils.aoa_to_sheet(sheet3Data);
ws3['!cols'] = [{ wch: 45 }, { wch: 15 }];
XLSX.utils.book_append_sheet(outWb, ws3, 'ملخص إحصائي');

// حفظ الملف
const outputDir = 'النواقص - مؤمنين غير مستوردين';
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
const outPath = path.join(outputDir, 'جمارك_JMR_بدون_بطاقة.xlsx');
XLSX.writeFile(outWb, outPath);

console.log(`\n✅ تم حفظ الملف: ${outPath}`);
console.log(`📊 ${noCardRecords.length} سجل بدون بطاقة في 3 أوراق`);
console.log('\nتفاصيل الموظفين:');
Object.entries(validEmpGroups).sort((a,b)=>Number(a[0])-Number(b[0])).forEach(([empId,rows])=>{
  console.log(`  موظف #${empId}: ${rows.length} فرد (${rows.map(r=>r.rel).join(', ')})`);
});
