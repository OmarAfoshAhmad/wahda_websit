/**
 * generate_pt_transactions.js
 * يولد ملفات حركات العلاج الطبيعي لكل شركة من الملف المجمع
 */

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

// ========================================================
// 1. تحديد مجلد الإخراج
// ========================================================
const outputDir = 'حركات الشركات للعلاج الطبيعي';
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
  console.log('📁 تم إنشاء المجلد:', outputDir);
}

// ========================================================
// 2. قراءة ملف حركات العلاج الطبيعي
// ========================================================
const wb = XLSX.readFile('العلاج الطبية اخر نسخة.xlsx');
const sheetName = 'علاج الطبيعي';
const ws = wb.Sheets[sheetName] || wb.Sheets[wb.SheetNames[0]];
if (!ws) {
  console.error(`❌ لم يتم العثور على أي شيت في الملف.`);
  process.exit(1);
}
const rawData = XLSX.utils.sheet_to_json(ws, { header: 1 });

console.log('📊 إجمالي صفوف الملف:', rawData.length);

// ========================================================
// 3. دالة تحويل التاريخ
// ========================================================
function parseDate(val) {
  if (!val) return '';
  
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
  
  let str = String(val).trim();
  if (!str || str === ' ') return '';
  
  str = str.replace(/2026\d$/, '2026'); 
  str = str.replace(/20026$/, '2026'); 
  str = str.replace(/\/026$/, '/2026');   
  str = str.replace(/\/206$/, '/2026');   
  str = str.replace(/\/22026$/, '/2/2026'); 
  
  const match1 = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,5})$/);
  if (match1) {
    let y = match1[3];
    if (y.length === 2) y = '20' + y;
    if (y === '206' || y === '026') y = '2026';
    if (y === '20262' || y === '20026' || y === '20263') y = '2026';
    return `${y.padStart(4,'0')}-${match1[2].padStart(2,'0')}-${match1[1].padStart(2,'0')}`;
  }

  const match3 = str.match(/^(\d{1,2})\/(\d{4})$/);
  if (match3) {
    return `${match3[2]}-01-${match3[1].padStart(2,'0')}`;
  }
  
  const match2 = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match2) return str;
  
  return str;
}

// ========================================================
// 4. تحليل الأقسام وقراءة جميع الصفوف
// ========================================================
const sections = [];
let currentSection = null;

for (let i = 0; i < rawData.length; i++) {
  const row = rawData[i];
  if (!row || row.length === 0) continue;
  
  const rowStr = row.map(c => String(c || '').trim()).join(' ');
  if (rowStr.includes('اسم المريض')) {
    if (currentSection) sections.push(currentSection);
    
    const cols = Array.from({length: row.length}, (_, idx) => String(row[idx] || '').trim());
    currentSection = {
      headerRow: i,
      colName: cols.indexOf('اسم المريض') !== -1 ? cols.indexOf('اسم المريض') : cols.findIndex(c => c && c.includes('اسم المريض')),
      colIns: cols.findIndex(c => c && (c.includes('رقم التأمين') || c.includes('رقم التامين'))),
      colApproval: cols.findIndex(c => c && c.includes('رقم الموافقة')),
      colAmount: cols.findIndex(c => c && c.includes('القيمة المالية')),
      colDate: cols.findIndex(c => c && c.includes('التاريخ')),
      colFacility: cols.findIndex(c => c && (c.includes('المرفق') || c.includes('الجيهة') || c.includes('الجهة'))),
      colSessions: cols.findIndex(c => c && (c.includes('عدد جلسات') || c.includes('عدد الجلسات'))),
      colNotes: cols.findIndex(c => c && (c.includes('ملاحظات') || c.includes('الملاحظات'))),
      rows: []
    };
    
    // Fallbacks if not found
    if (currentSection.colName === -1) currentSection.colName = 1;
    if (currentSection.colIns === -1) currentSection.colIns = 2;
    if (currentSection.colApproval === -1) currentSection.colApproval = 3;
    if (currentSection.colDate === -1) currentSection.colDate = 4;
    if (currentSection.colAmount === -1) currentSection.colAmount = 5;
    if (currentSection.colFacility === -1) currentSection.colFacility = 6;
    if (currentSection.colSessions === -1) currentSection.colSessions = 7;
    if (currentSection.colNotes === -1) currentSection.colNotes = 8;

    continue;
  }
  
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
// 5. تجميع الحركات لكل شركة
// ========================================================
const companyData = {}; 

for (const section of sections) {
  for (const rowObj of section.rows) {
    const row = rowObj.data;
    
    const ins = String(row[section.colIns] || '').trim();
    if (!ins || !ins.match(/^[A-Za-z]/)) continue;
    
    const name = String(row[section.colName] || '').trim();
    const approval = String(row[section.colApproval] || '').trim();
    const amountRaw = section.colAmount >= 0 ? row[section.colAmount] : null;
    const dateRaw = section.colDate >= 0 ? row[section.colDate] : null;
    const facilityRaw = section.colFacility >= 0 ? row[section.colFacility] : '';
    const sessionsRaw = section.colSessions >= 0 ? row[section.colSessions] : '';
    const notesRaw = section.colNotes >= 0 ? row[section.colNotes] : '';
    
    const codeMatch = ins.match(/^([A-Za-z]+)/);
    if (!codeMatch) continue;
    const companyCode = codeMatch[1].toUpperCase();
    
    let amount = 0;
    if (amountRaw !== null && amountRaw !== undefined && amountRaw !== '' && amountRaw !== ' ') {
      const numStr = String(amountRaw).replace(/[^\d.]/g, '');
      amount = numStr ? parseFloat(numStr) : 0;
    }
    
    let date = parseDate(dateRaw);
    const facilityName = String(facilityRaw || '').trim();
    
    let notes = String(notesRaw || '').trim();
    const sessions = String(sessionsRaw || '').trim();
    if (sessions) {
      notes = notes ? `${sessions} - ${notes}` : sessions;
    }
    
    if (!companyData[companyCode]) companyData[companyCode] = [];
    
    companyData[companyCode].push({
      name,
      ins,
      approval,
      amount,
      date,
      facility: facilityName,
      notes,
    });
  }
}

console.log('\n📊 إحصائيات الشركات للعلاج الطبيعي:');
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
// 6. دالة توليد ملف Excel للشركة
// ========================================================
const HEADER = ['اسم المريض', 'رقم التأمين ', 'رقم الموافقة ', 'القيمة المالية', 'التاريخ', 'المرفق الصحي', 'ملاحظات'];

function generateCompanyFile(code, rows, outputPath) {
  const wsData = [HEADER];
  rows.forEach(r => {
    wsData.push([
      r.name,
      r.ins,
      r.approval,
      r.amount,
      r.date,
      r.facility,
      r.notes
    ]);
  });
  
  const wb_out = XLSX.utils.book_new();
  const ws_out = XLSX.utils.aoa_to_sheet(wsData);
  
  ws_out['!cols'] = [
    { wch: 35 }, 
    { wch: 22 }, 
    { wch: 15 }, 
    { wch: 14 }, 
    { wch: 14 }, 
    { wch: 35 }, 
    { wch: 40 }, 
  ];
  
  XLSX.utils.book_append_sheet(wb_out, ws_out, 'العلاج الطبيعي');
  XLSX.writeFile(wb_out, outputPath);
}

// ========================================================
// 7. توليد ملفات الشركات
// ========================================================
console.log('\n📝 توليد ملفات الشركات للعلاج الطبيعي...');

const codeToFile = {
  'LCC': 'LCC_Transactions_PT.xlsx',
  'O': 'O3G_Transactions_PT.xlsx',    
  'O3G': 'O3G_Transactions_PT.xlsx',
  'OGD': 'O3G_Transactions_PT.xlsx',
  'OGS': 'O3G_Transactions_PT.xlsx',
  'OGW': 'O3G_Transactions_PT.xlsx',
  'OG': 'O3G_Transactions_PT.xlsx',
  'TOSY': 'TOSY_Transactions_PT.xlsx',
  'WAAD': 'WAAD_Transactions_PT.xlsx',
  'WAD': 'WAAD_Transactions_PT.xlsx', 
  'WAHA': 'WAHA_Transactions_PT.xlsx',
  'JFZ': 'JFZ_Transactions_PT.xlsx',
  'VINS': 'VISN_Transactions_PT.xlsx',
  'FUTU': 'FUT_Transactions_PT.xlsx',
  'JMR': 'JMR_Transactions_PT.xlsx',
  'ARCAD': 'ARCD_Transactions_PT.xlsx',
  'WAB': 'WAB_Transactions_PT.xlsx',
  'WCA': 'WCA_Transactions_PT.xlsx',
  'RWG': 'RWG_Transactions_PT.xlsx',
  'HJR': 'HJR_Transactions_PT.xlsx',
};

const mergedCompanies = {};
for (const code of sortedCodes) {
  const fileName = codeToFile[code] || `${code}_Transactions_PT.xlsx`;
  mergedCompanies[fileName] = [
    ...(mergedCompanies[fileName] || []),
    ...companyData[code]
  ];
}

let fileCount = 0;
for (const [fileName, rows] of Object.entries(mergedCompanies)) {
  const filePath = path.join(outputDir, fileName);
  generateCompanyFile(fileName.replace('_Transactions_PT.xlsx', ''), rows, filePath);
  fileCount++;
  console.log(`  ✅ ${fileName}: ${rows.length} حركة`);
}

// ========================================================
// 8. ملف الإحصائيات
// ========================================================
const statsPath = path.join(outputDir, 'STATISTICS_PT.xlsx');
const statsData = [
  ['ملخص إحصائيات ملفات حركات العلاج الطبيعي'],
  [],
  ['كود الشركة', 'اسم الملف', 'عدد الحركات', 'إجمالي القيم المالية'],
];

for (const [fileName, rows] of Object.entries(mergedCompanies)) {
  const total = rows.reduce((sum, r) => sum + (r.amount || 0), 0);
  statsData.push([
    fileName.replace('_Transactions_PT.xlsx', ''),
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

const wb_stats = XLSX.utils.book_new();
const ws_stats = XLSX.utils.aoa_to_sheet(statsData);
ws_stats['!cols'] = [{ wch: 20 }, { wch: 30 }, { wch: 15 }, { wch: 20 }];
XLSX.utils.book_append_sheet(wb_stats, ws_stats, 'الإحصائيات');
XLSX.writeFile(wb_stats, statsPath);

console.log(`\n✅ تم توليد ${fileCount} ملف حركات في مجلد: ${outputDir}`);
console.log(`📊 إجمالي الحركات: ${totalRows}`);
console.log(`💰 إجمالي القيم المالية: ${Math.round(totalAmount).toLocaleString()} د.ل`);
console.log(`📈 ملف الإحصائيات: STATISTICS_PT.xlsx`);
