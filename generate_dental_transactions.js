/**
 * generate_dental_transactions.js
 * يولد ملفات حركات الأسنان لكل شركة من ملف الخصومات الكاملة
 */

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

// ========================================================
// 1. قاموس مطابقة المرافق الصحية
// ========================================================
const facilityMatchingFile = 'خصومات الاسنان - مطابقة المرافق.xlsx';
const wb_match = XLSX.readFile(facilityMatchingFile);
const ws_match = wb_match.Sheets[wb_match.SheetNames[0]];
const matchData = XLSX.utils.sheet_to_json(ws_match, { header: 1 });

// بناء قاموس المطابقة: الاسم الأصلي -> الاسم في المنظومة
const facilityMap = {};
matchData.slice(1).forEach(row => {
  if (row[0] && row[1]) {
    facilityMap[String(row[0]).trim()] = String(row[1]).trim();
  }
});

// إضافات يدوية لأخطاء إملائية شائعة لم تُغطَّ في ملف المطابقة
const manualMappings = {
  'الليبيه التخصيصيه': 'الليبية التخصصية - اسنان',
  'الليبية التخصصيه': 'الليبية التخصصية - اسنان',
  'الليبيه التخصصيه': 'الليبية التخصصية - اسنان',
  'الليبية التخصصية': 'الليبية التخصصية - اسنان',
  'الحكيم طبرق': 'مصحة الحكيم - طبرق',
  'الفخامة': 'مركز الفخامة / درنة - اسنان',
  'عالم الاسنان': 'مركز عالم الاسنان',
  'درنة': 'مركز الفخامة / درنة - اسنان',
  'مركز درنة': 'مركز الفخامة / درنة - اسنان',
  'اطلس': 'مركز اطلس - اسنان',
  'اتلس': 'مركز اطلس - اسنان',
  'فينسيا': 'مركز فينيسيا - اسنان',  // خطأ إملائي شائع
  'فينيسيا ': 'مركز فينيسيا - اسنان',   // مسافة زائدة
  ' فينيسيا': 'مركز فينيسيا - اسنان',   // مسافة بادئة
  'الامل ': 'مركز الامل - اسنان',
  'الامل': 'مركز الامل - اسنان',
  'مركز قيس ': 'مركز قيس للاسنان',
  'قيس ': 'مركز قيس للاسنان',
  'اوبال': 'مركز اوبال - اسنان',
  'الريادة ': 'مركز الريادة للاسنان',
};
Object.assign(facilityMap, manualMappings);

console.log('📋 قاموس المطابقة تم تحميله:', Object.keys(facilityMap).length, 'مدخلة');

// ========================================================
// 2. تحديد مجلد الإخراج
// ========================================================
const outputDir = 'حركات الشركات للأسنان - جديد';
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
  console.log('📁 تم إنشاء المجلد:', outputDir);
}

// ========================================================
// 3. قراءة ملف الخصومات الكاملة
// ========================================================
const wb = XLSX.readFile('خصومات اسنان كاملة.xlsx');
const ws = wb.Sheets['الاسنان '];
const rawData = XLSX.utils.sheet_to_json(ws, { header: 1 });

console.log('📊 إجمالي صفوف الملف:', rawData.length);

// ========================================================
// 4. دالة تحويل التاريخ
// ========================================================
function parseDate(val) {
  if (!val) return '';
  
  // إذا كان رقماً (Excel serial date)
  if (typeof val === 'number') {
    const date = XLSX.SSF.parse_date_code(val);
    if (date) {
      const y = date.y;
      const m = String(date.m).padStart(2, '0');
      const d = String(date.d).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    return '';
  }
  
  // إذا كان نصاً
  let str = String(val).trim();
  if (!str || str === ' ') return '';
  
  // إصلاح الأخطاء الإملائية الشائعة في الإدخال
  str = str.replace(/2026\d$/, '2026'); // 20262, 20263 -> 2026
  str = str.replace(/20026$/, '2026'); // 20026 -> 2026
  str = str.replace(/\/026$/, '/2026');   // /026 -> /2026
  str = str.replace(/\/206$/, '/2026');   // /206 -> /2026
  str = str.replace(/\/22026$/, '/2/2026'); // 5/22026 -> 5/2/2026
  
  // تنسيق DD/MM/YYYY
  const match1 = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,5})$/);
  if (match1) {
    let y = match1[3];
    if (y.length === 2) y = '20' + y;
    if (y === '206' || y === '026') y = '2026';
    if (y === '20262' || y === '20026' || y === '20263') y = '2026';
    return `${y.padStart(4,'0')}-${match1[2].padStart(2,'0')}-${match1[1].padStart(2,'0')}`;
  }

  // تنسيق DD/YYYY (شهر مفقود)
  const match3 = str.match(/^(\d{1,2})\/(\d{4})$/);
  if (match3) {
    return `${match3[2]}-01-${match3[1].padStart(2,'0')}`;
  }
  
  // تنسيق YYYY-MM-DD
  const match2 = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match2) return str;
  
  return str;
}

// ========================================================
// 5. دالة تطبيع الاسم للتطابق
// ========================================================
function normalizeFacility(name) {
  if (!name) return '';
  name = String(name).trim();
  
  let result = null;
  // بحث مباشر في القاموس
  if (facilityMap[name]) result = facilityMap[name];
  
  // بحث بدون مسافات زائدة
  if (!result) {
    const trimmed = name.trim();
    if (facilityMap[trimmed]) result = facilityMap[trimmed];
    else {
      // بحث بالجزء الأول
      for (const key of Object.keys(facilityMap)) {
        if (trimmed.includes(key) || key.includes(trimmed)) {
          result = facilityMap[key];
          break;
        }
      }
    }
  }
  
  // تصحيح إلزامي لاسم مصحة الحكيم في حال كان مسجلاً بالاسم القديم في ملف المطابقة
  if (result === 'مركز الحكيم - اسنان طبرق') {
    result = 'مصحة الحكيم - طبرق';
  }
  
  return result; // قد يرجع null إذا لم يجد مطابقة
}

// ========================================================
// 6. تحليل الأقسام وقراءة جميع الصفوف
// ========================================================
/**
 * الملف يحتوي على أقسام متعددة بترويسات مختلفة.
 * الترويسة الأولى (صف 0): [اسم المريض, رقم التأمين, رقم الموافقة, القيمة المالية, التاريخ, ملاحظات, المرفق الصحي]
 * الترويسات الأخرى:       [اسم المريض, رقم التامين, رقم الموافقة, التاريخ, القيمة المالية, الجيهة, ...]
 * قسم واحد مختلف (row 261): [اسم المريض, رقم التامين, رقم الموافقة, القيمة المالية, الجيهة, التاريخ, ...]
 */

const sections = [];
let currentSection = null;

for (let i = 0; i < rawData.length; i++) {
  const row = rawData[i];
  if (!row || row.length === 0) continue;
  
  // اكتشاف ترويسة قسم جديد
  if (row[0] === 'اسم المريض') {
    // حفظ القسم السابق
    if (currentSection) sections.push(currentSection);
    
    // تحديد ترتيب الأعمدة
    const cols = row.map(c => String(c || '').trim());
    currentSection = {
      headerRow: i,
      colName: cols.indexOf('اسم المريض'),
      colIns: cols.findIndex(c => c.includes('رقم التأمين') || c.includes('رقم التامين')),
      colApproval: cols.findIndex(c => c.includes('رقم الموافقة')),
      colAmount: cols.findIndex(c => c.includes('القيمة المالية')),
      colDate: cols.findIndex(c => c.includes('التاريخ')),
      colFacility: cols.findIndex(c => c.includes('المرفق') || c.includes('الجيهة') || c.includes('الجهة')),
      colNotes: cols.findIndex(c => c.includes('ملاحظات') || c.includes('الملاحظات')),
      rows: []
    };
    continue;
  }
  
  // إضافة الصف إلى القسم الحالي
  if (currentSection) {
    currentSection.rows.push({ rowIndex: i, data: row });
  }
}
if (currentSection) sections.push(currentSection);

console.log('📑 عدد الأقسام المكتشفة:', sections.length);
sections.forEach(s => {
  const validRows = s.rows.filter(r => {
    const ins = String(r.data[s.colIns] || '').trim();
    return ins && ins.match(/^[A-Za-z]/);
  });
  console.log(`  - قسم صف ${s.headerRow}: ${validRows.length} صف صالح`);
});

// ========================================================
// 7. تجميع الحركات لكل شركة
// ========================================================
const companyData = {}; // code -> [{name, ins, approval, amount, date, facility, notes}]
const unmatchedFacilities = new Set();
const unmatchedRows = []; // صفوف المرافق غير المطابقة

for (const section of sections) {
  for (const rowObj of section.rows) {
    const row = rowObj.data;
    
    const ins = String(row[section.colIns] || '').trim();
    if (!ins || !ins.match(/^[A-Za-z]/)) continue;
    
    const name = String(row[section.colName] || '').trim();
    const approval = String(row[section.colApproval] || '').trim();
    const amountRaw = row[section.colAmount];
    const dateRaw = row[section.colDate];
    const facilityRaw = section.colFacility >= 0 ? row[section.colFacility] : '';
    const notesRaw = section.colNotes >= 0 ? row[section.colNotes] : '';
    
    // استخراج كود الشركة
    const codeMatch = ins.match(/^([A-Za-z]+)/);
    if (!codeMatch) continue;
    const companyCode = codeMatch[1].toUpperCase();
    
    // معالجة القيمة المالية
    let amount = 0;
    if (amountRaw !== null && amountRaw !== undefined && amountRaw !== '' && amountRaw !== ' ') {
      const numStr = String(amountRaw).replace(/[^\d.]/g, '');
      amount = numStr ? parseFloat(numStr) : 0;
    }
    
    // معالجة التاريخ
    let date = parseDate(dateRaw);
    
    // معالجة المرفق الصحي
    const facilityName = String(facilityRaw || '').trim();
    let mappedFacility = '';
    
    if (facilityName && facilityName !== ' ' && facilityName !== '') {
      const matched = normalizeFacility(facilityName);
      if (matched) {
        mappedFacility = matched;
      } else {
        // تحقق من أنه اسم مرفق حقيقي (ليس ملاحظة)
        const isNote = facilityName.match(/سقف|مطالبة|متبقي|تخطي|ملغي|خصم|استوفى|تعديل|موافقة|كشف|منظومة|cash|استثنائي|بدون|كليم|مكرر|\?|ا\s*$/i);
        if (!isNote) {
          unmatchedFacilities.add(facilityName);
          unmatchedRows.push({
            name, ins, approval, amount, date,
            facilityOriginal: facilityName,
            notes: String(notesRaw || '').trim()
          });
          mappedFacility = facilityName; // استخدام الاسم الأصلي
        }
      }
    }
    
    const notes = String(notesRaw || '').trim();
    
    if (!companyData[companyCode]) companyData[companyCode] = [];
    
    companyData[companyCode].push({
      name,
      ins,
      approval,
      amount,
      date,
      facility: mappedFacility,
      facilityOriginal: facilityName,
      notes,
      matched: !!normalizeFacility(facilityName)
    });
  }
}

console.log('\n📊 إحصائيات الشركات:');
const sortedCodes = Object.keys(companyData).sort();
let totalAll = 0;
for (const code of sortedCodes) {
  const count = companyData[code].length;
  totalAll += count;
  console.log(`  ${code}: ${count} حركة`);
}
console.log(`  ━━━━━━━━━━━━━━━━━`);
console.log(`  الإجمالي: ${totalAll} حركة`);

// ========================================================
// 8. دالة توليد ملف Excel للشركة
// ========================================================
const HEADER = ['اسم المريض', 'رقم التأمين ', 'رقم الموافقة ', 'القيمة المالية', 'التاريخ', 'ملاحظات', 'المرفق الصحي'];

function generateCompanyFile(code, rows, outputPath) {
  const wsData = [HEADER];
  rows.forEach(r => {
    wsData.push([
      r.name,
      r.ins,
      r.approval,
      r.amount,
      r.date,
      r.notes,
      r.facility || r.facilityOriginal
    ]);
  });
  
  const wb_out = XLSX.utils.book_new();
  const ws_out = XLSX.utils.aoa_to_sheet(wsData);
  
  // تنسيق العرض
  ws_out['!cols'] = [
    { wch: 35 }, // اسم المريض
    { wch: 22 }, // رقم التأمين
    { wch: 15 }, // رقم الموافقة
    { wch: 14 }, // القيمة المالية
    { wch: 14 }, // التاريخ
    { wch: 25 }, // ملاحظات
    { wch: 35 }, // المرفق الصحي
  ];
  
  XLSX.utils.book_append_sheet(wb_out, ws_out, 'الاسنان');
  XLSX.writeFile(wb_out, outputPath);
}

// ========================================================
// 9. توليد ملفات الشركات
// ========================================================
console.log('\n📝 توليد ملفات الشركات...');

// خريطة أكواد الشركات للملفات (تعامل مع OG* -> O3G/OGW/OGS/OGD)
const codeToFile = {
  'LCC': 'LCC_Transactions.xlsx',
  'O': 'O3G_Transactions.xlsx',    // OG -> O3G
  'O3G': 'O3G_Transactions.xlsx',
  'OGD': 'O3G_Transactions.xlsx',
  'OGS': 'O3G_Transactions.xlsx',
  'OGW': 'O3G_Transactions.xlsx',
  'OG': 'O3G_Transactions.xlsx',
  'TOSY': 'TOSY_Transactions.xlsx',
  'WAAD': 'WAAD_Transactions.xlsx',
  'WAD': 'WAAD_Transactions.xlsx', // WAD -> WAAD
  'WAHA': 'WAHA_Transactions.xlsx',
  'JFZ': 'JFZ_Transactions.xlsx',
  'VINS': 'VISN_Transactions.xlsx',
  'FUTU': 'FUT_Transactions.xlsx',
  'JMR': 'JMR_Transactions.xlsx',
  'ARCAD': 'ARCD_Transactions.xlsx',
  'WAB': 'WAB_Transactions.xlsx',
  'WCA': 'WCA_Transactions.xlsx',
  'RWG': 'RWG_Transactions.xlsx',
  'HJR': 'HJR_Transactions.xlsx',
};

// دمج الشركات المرتبطة
const mergedCompanies = {};
for (const code of sortedCodes) {
  const fileName = codeToFile[code];
  if (!fileName) {
    console.log(`  ⚠️  كود غير معروف: ${code} (${companyData[code].length} حركة) -> سيُوضع في ملف مستقل`);
    mergedCompanies[`${code}_Transactions.xlsx`] = [
      ...(mergedCompanies[`${code}_Transactions.xlsx`] || []),
      ...companyData[code]
    ];
    continue;
  }
  mergedCompanies[fileName] = [
    ...(mergedCompanies[fileName] || []),
    ...companyData[code]
  ];
}

// توليد الملفات
let fileCount = 0;
for (const [fileName, rows] of Object.entries(mergedCompanies)) {
  const filePath = path.join(outputDir, fileName);
  generateCompanyFile(fileName.replace('_Transactions.xlsx', ''), rows, filePath);
  fileCount++;
  console.log(`  ✅ ${fileName}: ${rows.length} حركة`);
}

// ========================================================
// 10. ملف المرافق غير المطابقة
// ========================================================
if (unmatchedRows.length > 0) {
  console.log(`\n⚠️  مرافق غير مطابقة: ${unmatchedFacilities.size} مرفق، ${unmatchedRows.length} حركة`);
  
  const unmatchedPath = path.join(outputDir, 'UNMATCHED_Facilities.xlsx');
  const wsData = [
    ['اسم المريض', 'رقم التأمين', 'رقم الموافقة', 'القيمة المالية', 'التاريخ', 'المرفق الأصلي (غير مطابق)', 'ملاحظات']
  ];
  unmatchedRows.forEach(r => {
    wsData.push([r.name, r.ins, r.approval, r.amount, r.date, r.facilityOriginal, r.notes]);
  });
  
  const wb_un = XLSX.utils.book_new();
  const ws_un = XLSX.utils.aoa_to_sheet(wsData);
  ws_un['!cols'] = [
    { wch: 35 }, { wch: 22 }, { wch: 15 }, { wch: 14 }, { wch: 14 }, { wch: 35 }, { wch: 25 }
  ];
  XLSX.utils.book_append_sheet(wb_un, ws_un, 'مرافق غير مطابقة');
  XLSX.writeFile(wb_un, unmatchedPath);
  console.log(`  📄 ملف المرافق غير المطابقة: UNMATCHED_Facilities.xlsx`);
  
  console.log('\n  قائمة المرافق غير المطابقة:');
  [...unmatchedFacilities].forEach(f => console.log('    -', f));
}

// ========================================================
// 11. ملف الإحصائيات
// ========================================================
const statsPath = path.join(outputDir, 'STATISTICS.xlsx');
const statsData = [
  ['ملخص إحصائيات ملفات حركات الأسنان'],
  [],
  ['كود الشركة', 'اسم الملف', 'عدد الحركات', 'إجمالي القيم المالية'],
];

for (const [fileName, rows] of Object.entries(mergedCompanies)) {
  const total = rows.reduce((sum, r) => sum + (r.amount || 0), 0);
  statsData.push([
    fileName.replace('_Transactions.xlsx', ''),
    fileName,
    rows.length,
    Math.round(total * 100) / 100
  ]);
}

const totalRows = Object.values(mergedCompanies).reduce((sum, rows) => sum + rows.length, 0);
const totalAmount = Object.values(mergedCompanies).reduce((sum, rows) => 
  sum + rows.reduce((s, r) => s + (r.amount || 0), 0), 0);

statsData.push([]);
statsData.push(['الإجمالي', '', totalRows, Math.round(totalAmount * 100) / 100]);
statsData.push([]);
statsData.push(['المرافق غير المطابقة:', unmatchedFacilities.size]);
statsData.push(['حركات المرافق غير المطابقة:', unmatchedRows.length]);

const wb_stats = XLSX.utils.book_new();
const ws_stats = XLSX.utils.aoa_to_sheet(statsData);
ws_stats['!cols'] = [{ wch: 20 }, { wch: 30 }, { wch: 15 }, { wch: 20 }];
XLSX.utils.book_append_sheet(wb_stats, ws_stats, 'الإحصائيات');
XLSX.writeFile(wb_stats, statsPath);

console.log(`\n✅ تم توليد ${fileCount} ملف حركات في مجلد: ${outputDir}`);
console.log(`📊 إجمالي الحركات: ${totalRows}`);
console.log(`💰 إجمالي القيم المالية: ${Math.round(totalAmount).toLocaleString()} د.ل`);
console.log(`📈 ملف الإحصائيات: STATISTICS.xlsx`);
