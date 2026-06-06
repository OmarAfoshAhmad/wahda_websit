/**
 * find_missing_insured.js
 * يجد الأشخاص الناقصين في ملفات الاستيراد مقارنة بملفات المصدر
 * ويولد ملف لكل شركة في مجلد جديد
 */
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const outputDir = 'النواقص - مؤمنين غير مستوردين';
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
  console.log('📁 تم إنشاء مجلد:', outputDir);
}

// =============================================
// دالة مساعدة: قراءة بطاقات ملف الاستيراد
// =============================================
function getImportCards(fileName) {
  const filePath = path.join('اسماء شركات الاسنان جاهزة للاستيراد', fileName);
  if (!fs.existsSync(filePath)) return new Set();
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const cards = new Set();
  data.slice(1).forEach(r => {
    const c = String(r[1] || '').trim();
    if (c) cards.add(c.toUpperCase());
  });
  return cards;
}

// =============================================
// دالة: توليد ملف النواقص
// =============================================
function saveMissingFile(companyName, missingRows) {
  if (!missingRows || missingRows.length === 0) {
    console.log(`  ✅ ${companyName}: لا يوجد نقص`);
    return 0;
  }
  const wb = XLSX.utils.book_new();
  const wsData = [['اسم المستفيد', 'رقم البطاقة', 'تاريخ الميلاد', 'الصفة / العلاقة', 'ملاحظات']];
  missingRows.forEach(r => wsData.push(r));
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = [{ wch: 35 }, { wch: 22 }, { wch: 16 }, { wch: 20 }, { wch: 25 }];
  XLSX.utils.book_append_sheet(wb, ws, 'النواقص');
  const outPath = path.join(outputDir, `${companyName}_MISSING.xlsx`);
  XLSX.writeFile(wb, outPath);
  console.log(`  ❌ ${companyName}: ${missingRows.length} ناقص → ${path.basename(outPath)}`);
  return missingRows.length;
}

// =============================================
// دالة: تحويل التاريخ من رقم إلى نص
// =============================================
function parseDate(val) {
  if (!val) return '';
  if (typeof val === 'number') {
    try {
      const d = XLSX.SSF.parse_date_code(val);
      if (d) return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
    } catch(e) {}
    return String(val);
  }
  return String(val).trim();
}

const summary = [];
console.log('\n🔍 بدء البحث عن النواقص...\n');

// =============================================
// 1. جمارك (JMR) — الأكبر نقصاً -158
// =============================================
console.log('══ جمارك ══');
{
  const importCards = getImportCards('Jamarek_List_Import.xlsx');
  const wb = XLSX.readFile('اسماء شركات الاسنان/جمارك دمج - Copy.xlsx');
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
  
  // تخطي الصفوف غير البيانات
  const validRows = data.filter(r => r[5] && String(r[5]).match(/^JMR/i));
  
  const missing = [];
  validRows.forEach(r => {
    const card = String(r[5] || '').trim().toUpperCase();
    if (!importCards.has(card)) {
      missing.push([
        String(r[2] || '').trim(),  // الاسم
        card,                        // رقم البطاقة
        parseDate(r[4]),             // تاريخ الميلاد
        String(r[3] || '').trim(),   // الصفة
        ''
      ]);
    }
  });
  const n = saveMissingFile('جمارك_JMR', missing);
  summary.push({ company: 'جمارك', code: 'JMR', sourceTotal: validRows.length, importTotal: importCards.size, missing: n });
}

// =============================================
// 2. توسيالي (TOSY) — -40
// =============================================
console.log('\n══ توسيالي ══');
{
  const importCards = getImportCards('Tosyali_List_Import.xlsx');
  const wb = XLSX.readFile('اسماء شركات الاسنان/Tosyali_List (2).xlsx');
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const validRows = data.filter(r => r[5] && String(r[5]).match(/^TOSY/i));
  
  const missing = [];
  validRows.forEach(r => {
    const card = String(r[5] || '').trim().toUpperCase();
    if (!importCards.has(card)) {
      missing.push([
        String(r[1] || '').trim(),
        card,
        parseDate(r[2]),
        String(r[4] || '').trim(),
        ''
      ]);
    }
  });
  const n = saveMissingFile('توسيالي_TOSY', missing);
  summary.push({ company: 'توسيالي', code: 'TOSY', sourceTotal: validRows.length, importTotal: importCards.size, missing: n });
}

// =============================================
// 3. اوزون (O3G) — -16
// =============================================
console.log('\n══ اوزون ══');
{
  const importCards = getImportCards('OZONE_List_Import.xlsx');
  const wb = XLSX.readFile('اسماء شركات الاسنان/OZONE_List.xlsx');
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const validRows = data.filter(r => r[9] && String(r[9]).match(/^O3G/i));
  
  const missing = [];
  validRows.forEach(r => {
    const card = String(r[9] || '').trim().toUpperCase();
    if (!importCards.has(card)) {
      missing.push([
        String(r[1] || '').trim(),
        card,
        parseDate(r[8]),
        String(r[6] || '').trim(),
        String(r[12] || '') === '1' ? 'مطبوع' : 'غير مطبوع'
      ]);
    }
  });
  const n = saveMissingFile('اوزون_O3G', missing);
  summary.push({ company: 'اوزون', code: 'O3G', sourceTotal: validRows.length, importTotal: importCards.size, missing: n });
}

// =============================================
// 4. الاسمنت (LCC) — -8
// =============================================
console.log('\n══ الاسمنت ══');
{
  const importCards = getImportCards('Cement_List_Import.xlsx');
  const wb = XLSX.readFile('اسماء شركات الاسنان/دمج الاسمنت.xlsx');
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const validRows = data.filter(r => r[2] && String(r[2]).match(/^LCC/i));
  
  const missing = [];
  validRows.forEach(r => {
    const card = String(r[2] || '').trim().toUpperCase();
    if (!importCards.has(card)) {
      missing.push([
        String(r[3] || '').trim(),  // الاسم عربي
        card,
        parseDate(r[7]),            // تاريخ الميلاد
        String(r[6] || '').trim(),  // الحالة
        String(r[5] || '').trim()   // الادارة
      ]);
    }
  });
  const n = saveMissingFile('الاسمنت_LCC', missing);
  summary.push({ company: 'الاسمنت', code: 'LCC', sourceTotal: validRows.length, importTotal: importCards.size, missing: n });
}

// =============================================
// 5. فيوتشر (FUTU) — -3
// =============================================
console.log('\n══ فيوتشر ══');
{
  const importCards = getImportCards('Future_List_Import.xlsx');
  const wb = XLSX.readFile('اسماء شركات الاسنان/فيوتشر للموظفين المستوفين البيانات.xlsx');
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const validRows = data.filter(r => r[9] && String(r[9]).match(/^FUTU/i));
  
  const missing = [];
  validRows.forEach(r => {
    const card = String(r[9] || '').trim().toUpperCase();
    if (!importCards.has(card)) {
      missing.push([
        String(r[2] || '').trim(),
        card,
        parseDate(r[8]),
        String(r[4] || '').trim(),
        String(r[7] || '').trim()
      ]);
    }
  });
  
  // أيضاً تحقق من ملف الملحق
  const wb2 = XLSX.readFile('اسماء شركات الاسنان/قائمة فيوتشر المدمجة.xlsx');
  const ws2 = wb2.Sheets[wb2.SheetNames[0]];
  const data2 = XLSX.utils.sheet_to_json(ws2, { header: 1 });
  const validRows2 = data2.filter(r => r[9] && String(r[9]).match(/^FUTU/i));
  const addedCards = new Set(validRows.map(r => String(r[9]).trim().toUpperCase()));
  validRows2.forEach(r => {
    const card = String(r[9] || '').trim().toUpperCase();
    if (!importCards.has(card) && !addedCards.has(card)) {
      missing.push([
        String(r[2] || '').trim(),
        card,
        parseDate(r[8]),
        String(r[4] || '').trim(),
        'من ملف الملحق'
      ]);
      addedCards.add(card);
    }
  });
  
  const n = saveMissingFile('فيوتشر_FUTU', missing);
  summary.push({ company: 'فيوتشر', code: 'FUTU', sourceTotal: validRows.length + validRows2.length, importTotal: importCards.size, missing: n });
}

// =============================================
// 6. فيجن (VISN) — -2
// =============================================
console.log('\n══ فيجن ══');
{
  const importCards = getImportCards('Vision_List_Import.xlsx');
  const wb = XLSX.readFile('اسماء شركات الاسنان/Vision_List.xlsx');
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const validRows = data.filter(r => r[7] && String(r[7]).match(/^VISN/i));
  
  const missing = [];
  validRows.forEach(r => {
    const card = String(r[7] || '').trim().toUpperCase();
    if (!importCards.has(card)) {
      missing.push([
        String(r[2] || '').trim(),
        card,
        parseDate(r[5]),
        String(r[4] || '').trim(),
        String(r[8] === '2' ? 'مطبوع' : 'غير مطبوع')
      ]);
    }
  });
  const n = saveMissingFile('فيجن_VISN', missing);
  summary.push({ company: 'فيجن', code: 'VISN', sourceTotal: validRows.length, importTotal: importCards.size, missing: n });
}

// =============================================
// 7. أركاديا (ARCAD) — ملف المصدر MERG
// =============================================
console.log('\n══ أركاديا ══');
{
  const importCards = getImportCards('Arcadia_List_Import.xlsx');
  const dir = 'MERG ARCADIA';
  const f = fs.readdirSync(dir)[0];
  const wb = XLSX.readFile(path.join(dir, f));
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const validRows = data.filter(r => r[9] && String(r[9]).match(/^ARCAD/i));
  
  const missing = [];
  validRows.forEach(r => {
    const card = String(r[9] || '').trim().toUpperCase();
    if (!importCards.has(card)) {
      missing.push([
        String(r[1] || '').trim(),
        card,
        parseDate(r[3]),
        String(r[8] || '').trim(),
        String(r[10] || '').trim()
      ]);
    }
  });
  const n = saveMissingFile('أركاديا_ARCAD', missing);
  summary.push({ company: 'أركاديا', code: 'ARCAD', sourceTotal: validRows.length, importTotal: importCards.size, missing: n });
}

// =============================================
// 8. حجر الماس (HJR) — +5 في الاستيراد (لا نقص من المصدر)
// =============================================
console.log('\n══ حجر الماس ══');
{
  const importCards = getImportCards('Hajar_List_Import.xlsx');
  const dir = 'MERG HJR';
  const f = fs.readdirSync(dir)[0];
  const wb = XLSX.readFile(path.join(dir, f));
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const validRows = data.filter(r => typeof r[0] === 'number' && r[0] > 0);
  
  const missing = [];
  validRows.forEach(r => {
    const card = String(r[4] || '').trim().toUpperCase();
    if (card && card.match(/^HJR/) && !importCards.has(card)) {
      missing.push([
        String(r[1] || '').trim(),
        card,
        parseDate(r[9]),
        'موظف',
        ''
      ]);
    }
    // بدون بطاقة
    if (!card || !card.match(/^HJR/)) {
      missing.push([
        String(r[1] || '').trim(),
        card || 'بدون بطاقة',
        parseDate(r[9]),
        'موظف',
        '⚠️ بدون رقم تأمين'
      ]);
    }
  });
  const n = saveMissingFile('حجر_الماس_HJR', missing);
  summary.push({ company: 'حجر الماس', code: 'HJR', sourceTotal: validRows.length, importTotal: importCards.size, missing: n });
}

// =============================================
// 9. وعد (WAAD) — +3 في الاستيراد
// =============================================
console.log('\n══ وعد ══');
{
  const importCards = getImportCards('Waad_List_Import.xlsx');
  const dir = 'merg waad -tpa';
  const files = fs.readdirSync(dir);
  const f = files[0];
  const wb = XLSX.readFile(path.join(dir, f));
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const validRows = data.filter(r => r[6] && String(r[6]).match(/^WAAD/i));
  
  const missing = [];
  validRows.forEach(r => {
    const card = String(r[6] || '').trim().toUpperCase();
    if (!importCards.has(card)) {
      missing.push([
        String(r[2] || '').trim(),
        card,
        parseDate(r[5]),
        String(r[3] || '').trim(),
        ''
      ]);
    }
  });
  const n = saveMissingFile('وعد_WAAD', missing);
  summary.push({ company: 'وعد', code: 'WAAD', sourceTotal: validRows.length, importTotal: importCards.size, missing: n });
}

// =============================================
// 10. وعد المعماري (WCA) — مطابق ✅
// =============================================
console.log('\n══ وعد المعماري ══');
{
  const importCards = getImportCards('Waad_Architect_List_Import.xlsx');
  const dir = 'merg waad architect';
  const f = fs.readdirSync(dir)[0];
  const wb = XLSX.readFile(path.join(dir, f));
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const validRows = data.filter(r => r[8] && String(r[8]).match(/^WCA/i));
  
  const missing = [];
  validRows.forEach(r => {
    const card = String(r[8] || '').trim().toUpperCase();
    if (!importCards.has(card)) {
      missing.push([
        String(r[1] || '').trim(),
        card,
        parseDate(r[7]),
        String(r[5] || '').trim(),
        ''
      ]);
    }
  });
  const n = saveMissingFile('وعد_المعماري_WCA', missing);
  summary.push({ company: 'وعد المعماري', code: 'WCA', sourceTotal: validRows.length, importTotal: importCards.size, missing: n });
}

// =============================================
// 11. الواحة (WAHA) — +1
// =============================================
console.log('\n══ الواحة ══');
{
  const importCards = getImportCards('Waha_List_Import.xlsx');
  const dir = 'merg waha';
  const f = fs.readdirSync(dir)[0];
  const wb = XLSX.readFile(path.join(dir, f));
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const validRows = data.filter(r => r[5] && String(r[5]).match(/^WAHA/i));
  
  const missing = [];
  validRows.forEach(r => {
    const card = String(r[5] || '').trim().toUpperCase();
    if (!importCards.has(card)) {
      missing.push([
        String(r[2] || '').trim(),
        card,
        parseDate(r[5]),
        String(r[4] || '').trim(),
        ''
      ]);
    }
  });
  const n = saveMissingFile('الواحة_WAHA', missing);
  summary.push({ company: 'الواحة', code: 'WAHA', sourceTotal: validRows.length, importTotal: importCards.size, missing: n });
}

// =============================================
// 12. الرواق (RWG) — مطابق ✅
// =============================================
console.log('\n══ الرواق ══');
{
  const importCards = getImportCards('Rewaq_List_Import.xlsx');
  const wb = XLSX.readFile('اسماء شركات الاسنان/قائمة اسماء شركة رواق.xlsx');
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const validRows = data.filter(r => r[5] && String(r[5]).match(/^RWG/i));
  
  const missing = [];
  validRows.forEach(r => {
    const card = String(r[5] || '').trim().toUpperCase();
    if (!importCards.has(card)) {
      missing.push([
        String(r[1] || '').trim(),
        card,
        parseDate(r[3]),
        String(r[2] || '').trim(),
        ''
      ]);
    }
  });
  const n = saveMissingFile('الرواق_RWG', missing);
  summary.push({ company: 'الرواق', code: 'RWG', sourceTotal: validRows.length, importTotal: importCards.size, missing: n });
}

// =============================================
// ملف الملخص الإجمالي
// =============================================
console.log('\n' + '═'.repeat(70));
console.log('  ملخص النواقص');
console.log('═'.repeat(70));

const totalMissing = summary.reduce((s, r) => s + r.missing, 0);
console.log('\nالشركة'.padEnd(18) + '│ مصدر  │ استيراد │ ناقص');
console.log('─'.repeat(50));
summary.forEach(r => {
  const status = r.missing === 0 ? '✅' : `❌ ${r.missing}`;
  console.log(r.company.padEnd(18) + '│ ' + String(r.sourceTotal).padEnd(6) + '│ ' + String(r.importTotal).padEnd(8) + '│ ' + status);
});
console.log('─'.repeat(50));
console.log('إجمالي النواقص:'.padEnd(38) + totalMissing);

// ملف الملخص
const summaryWb = XLSX.utils.book_new();
const summaryData = [
  ['ملخص النواقص - مؤمنين غير مستوردين'],
  [],
  ['الشركة', 'الكود', 'عدد المصدر', 'عدد الاستيراد', 'النواقص', 'الملف'],
];
summary.forEach(r => {
  summaryData.push([
    r.company,
    r.code,
    r.sourceTotal,
    r.importTotal,
    r.missing,
    r.missing > 0 ? `${r.company}_${r.code}_MISSING.xlsx` : '—'
  ]);
});
summaryData.push([]);
summaryData.push(['الإجمالي', '', summary.reduce((s,r)=>s+r.sourceTotal,0), summary.reduce((s,r)=>s+r.importTotal,0), totalMissing, '']);

const summaryWs = XLSX.utils.aoa_to_sheet(summaryData);
summaryWs['!cols'] = [{ wch: 18 }, { wch: 10 }, { wch: 14 }, { wch: 16 }, { wch: 10 }, { wch: 35 }];
XLSX.utils.book_append_sheet(summaryWb, summaryWs, 'الملخص');
XLSX.writeFile(summaryWb, path.join(outputDir, 'SUMMARY_النواقص.xlsx'));

console.log(`\n📁 تم حفظ جميع الملفات في: ${outputDir}`);
console.log(`📊 إجمالي النواقص المكتشفة: ${totalMissing} شخص`);
