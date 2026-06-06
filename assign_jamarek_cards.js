/**
 * assign_jamarek_cards.js
 * يعيّن أرقام بطاقات تأمين للسجلات الناقصة في ملف جمارك
 * بنفس نمط الترقيم: JMR2025{رقم وظيفي}{لاحقة}
 */
const XLSX = require('xlsx');
const fs   = require('fs');
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

// =============================================
// 1. تحميل جميع البطاقات الموجودة (Import + Source)
// =============================================
const wbI = XLSX.readFile('اسماء شركات الاسنان جاهزة للاستيراد/Jamarek_List_Import.xlsx');
const wsI = wbI.Sheets[wbI.SheetNames[0]];
const dataI = XLSX.utils.sheet_to_json(wsI, { header: 1 });
const existingCards = new Set(
  dataI.slice(1).map(r => String(r[1]||'').trim().toUpperCase()).filter(c => c)
);

// بناء خريطة البطاقات حسب رقم الموظف لمعرفة أقصى لاحقة مستخدمة
// مثال: JMR202523307 -> { W: 1, S: 2, D: 3, F: 1, M: 1 }
const usedSuffixes = {}; // empId -> { W: max, S: max, D: max, F: max, M: max }
existingCards.forEach(card => {
  const m = card.match(/^JMR2025(\d+)([WSDMF])(\d+)$/i);
  if (m) {
    const empId = m[1];
    const type  = m[2].toUpperCase();
    const num   = parseInt(m[3]);
    if (!usedSuffixes[empId]) usedSuffixes[empId] = {};
    if (!usedSuffixes[empId][type] || usedSuffixes[empId][type] < num) {
      usedSuffixes[empId][type] = num;
    }
  }
});

// =============================================
// 2. قراءة ملف المصدر وجمع السجلات بدون بطاقة
// =============================================
const wb = XLSX.readFile('اسماء شركات الاسنان/جمارك دمج - Copy.xlsx');
const ws = wb.Sheets['قوة العمومية '];
const data = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
const validData = data.slice(2);

let currentEmpId = null;

// جمع كل السجلات مع حفظ السياق (الموظف الرئيسي)
const noCardRecords = [];
validData.forEach(r => {
  if (r[1] && typeof r[1] === 'number') currentEmpId = r[1];
  const name = String(r[2] || '').trim();
  const rel  = String(r[3] || '').trim();
  const dob  = parseDate(r[4]);
  const card = r[5];
  const note = String(r[6] || '').trim();

  // تجاهل صفوف الترويسة المكررة أو الفارغة
  const isHeader = name.includes('اسم') || name.includes('الاســـ');

  if (name && !isHeader && typeof currentEmpId === 'number' && (!card || card === null || card === 0)) {
    noCardRecords.push({ empId: currentEmpId, name, rel, dob, note });
  }
});

console.log(`📋 إجمالي السجلات بدون بطاقة: ${noCardRecords.length}`);

// =============================================
// 3. خريطة العلاقة → نوع اللاحقة
// =============================================
const relToType = r => {
  const s = (r || '').trim();
  if (s.match(/زوج[ةه]?|زوجته/))         return 'W';
  if (s.match(/ابن|ولد|نجل|صبي/))         return 'S';
  if (s.match(/ابن[هة]|بنت|بنت[هة]|ابنة|نجلة/)) return 'D';
  if (s.match(/أب|اب[^ن]|والد[ه]?$|الأب|الاب/)) return 'F';
  if (s.match(/أم|ام[^ة]|والد[هة]?$|الأم|الام/)) return 'M';
  if (s.match(/رب الاسرة|رب العائلة|المؤمن|الموظف|عضو/)) return 'MAIN';
  if (s.match(/الزوج$/))                   return 'W'; // زوج (أنثى موظفة)
  if (s.match(/صله|صلة/))                  return 'UNKNOWN';
  return 'UNKNOWN';
};

// =============================================
// 4. تعيين الأرقام
// =============================================
// نسخة قابلة للتعديل من usedSuffixes لتتبع ما نعيّنه الآن
const assignedSuffixes = JSON.parse(JSON.stringify(usedSuffixes));

const assigned = [];
const skipped  = [];

// نجمّع الأفراد حسب رقم الموظف لمعالجتهم معاً بالترتيب
const byEmp = {};
noCardRecords.forEach(r => {
  if (!byEmp[r.empId]) byEmp[r.empId] = [];
  byEmp[r.empId].push(r);
});

Object.entries(byEmp).sort((a,b) => Number(a[0]) - Number(b[0])).forEach(([empId, members]) => {
  const empKey = String(empId);
  if (!assignedSuffixes[empKey]) assignedSuffixes[empKey] = {};

  // رتّب: رب الأسرة أولاً، ثم الزوجات، ثم الأبناء، البنات، الآباء، الأمهات
  const order = { MAIN: 0, W: 1, S: 2, D: 3, F: 4, M: 5, UNKNOWN: 6 };
  members.sort((a, b) => (order[relToType(a.rel)]||6) - (order[relToType(b.rel)]||6));

  members.forEach(member => {
    const type = relToType(member.rel);
    const baseCard = `JMR2025${empId}`;

    let newCard = '';
    if (type === 'MAIN') {
      // بطاقة رئيسية - تحقق إذا كانت موجودة
      if (existingCards.has(baseCard.toUpperCase())) {
        skipped.push({ ...member, reason: `البطاقة الرئيسية ${baseCard} موجودة بالفعل` });
        return;
      }
      newCard = baseCard;
    } else if (type === 'UNKNOWN') {
      // صلة غير واضحة - ضع في المحتاج مراجعة
      skipped.push({ ...member, reason: `صلة القرابة غير واضحة: "${member.rel}"` });
      return;
    } else {
      // حساب الرقم التالي للنوع
      const current = assignedSuffixes[empKey][type] || 0;
      const next = current + 1;
      assignedSuffixes[empKey][type] = next;
      newCard = `${baseCard}${type}${next}`;
    }

    // تأكد من عدم التكرار
    if (existingCards.has(newCard.toUpperCase())) {
      // الرقم محجوز، جرّب التالي
      const type2 = type === 'MAIN' ? type : type;
      if (type !== 'MAIN') {
        let attempt = assignedSuffixes[empKey][type];
        while (existingCards.has(`${baseCard}${type}${attempt}`.toUpperCase())) {
          attempt++;
        }
        assignedSuffixes[empKey][type] = attempt;
        newCard = `${baseCard}${type}${attempt}`;
      } else {
        skipped.push({ ...member, reason: `تعارض في الرقم ${newCard}` });
        return;
      }
    }

    assigned.push({ ...member, newCard, type, empId: Number(empId) });
  });
});

console.log(`✅ تم تعيين أرقام لـ: ${assigned.length} سجل`);
console.log(`⚠️  يحتاج مراجعة: ${skipped.length} سجل`);

// =============================================
// 5. طباعة النتائج
// =============================================
console.log('\n📋 الأرقام المُعيَّنة:');
let lastEmp = null;
assigned.forEach(r => {
  if (r.empId !== lastEmp) {
    console.log(`\n  ── موظف #${r.empId} ──`);
    lastEmp = r.empId;
  }
  console.log(`    ${r.newCard.padEnd(25)} | ${r.name.padEnd(30)} | ${r.rel}`);
});

if (skipped.length > 0) {
  console.log('\n⚠️  سجلات تحتاج مراجعة يدوية:');
  skipped.forEach(r => console.log(`    موظف#${r.empId} | ${r.name} | ${r.rel} | ${r.reason}`));
}

// =============================================
// 6. توليد ملفات الإخراج
// =============================================
const outputDir = 'النواقص - مؤمنين غير مستوردين';
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

const outWb = XLSX.utils.book_new();

// ورقة 1: جاهز للاستيراد (بنفس تنسيق Jamarek_List_Import.xlsx)
const importSheet = [['اسم المستفيد', 'رقم البطاقة', 'تاريخ الميلاد']];
assigned.forEach(r => importSheet.push([r.name, r.newCard, r.dob]));
const wsImport = XLSX.utils.aoa_to_sheet(importSheet);
wsImport['!cols'] = [{ wch: 35 }, { wch: 25 }, { wch: 14 }];
XLSX.utils.book_append_sheet(outWb, wsImport, 'جاهز للاستيراد');

// ورقة 2: تفصيلي مع الرقم الوظيفي والملاحظات
const detailSheet = [
  ['تعيين أرقام بطاقات جمارك - السجلات بدون #N/A'],
  [],
  ['الرقم الوظيفي', 'اسم المستفيد', 'رقم البطاقة الجديد', 'صلة القرابة', 'تاريخ الميلاد', 'نوع اللاحقة', 'سبب الغياب', 'ملاحظة']
];
assigned.forEach(r => {
  const action = r.note.includes('خطء') || r.note.includes('خطأ')
    ? '⚠️ يحتاج تصحيح الرقم الوطني أو تاريخ الميلاد قبل الرفع'
    : '✅ جاهز للاستيراد بعد التحقق';
  detailSheet.push([
    r.empId,
    r.name,
    r.newCard,
    r.rel,
    r.dob,
    r.type,
    r.note || '—',
    action
  ]);
});
const wsDetail = XLSX.utils.aoa_to_sheet(detailSheet);
wsDetail['!cols'] = [
  { wch: 14 }, { wch: 35 }, { wch: 25 }, { wch: 14 },
  { wch: 14 }, { wch: 8  }, { wch: 40 }, { wch: 45 }
];
XLSX.utils.book_append_sheet(outWb, wsDetail, 'تفصيلي مع الملاحظات');

// ورقة 3: يحتاج مراجعة
const reviewSheet = [
  ['سجلات تحتاج مراجعة يدوية'],
  [],
  ['الرقم الوظيفي', 'اسم المستفيد', 'صلة القرابة', 'تاريخ الميلاد', 'سبب التأجيل']
];
skipped.forEach(r => reviewSheet.push([r.empId, r.name, r.rel, r.dob, r.reason]));
const wsReview = XLSX.utils.aoa_to_sheet(reviewSheet);
wsReview['!cols'] = [{ wch: 14 }, { wch: 35 }, { wch: 14 }, { wch: 14 }, { wch: 50 }];
XLSX.utils.book_append_sheet(outWb, wsReview, 'يحتاج مراجعة');

// ورقة 4: ملخص
const totalMain  = assigned.filter(r => r.type === 'MAIN').length;
const totalW     = assigned.filter(r => r.type === 'W').length;
const totalS     = assigned.filter(r => r.type === 'S').length;
const totalD     = assigned.filter(r => r.type === 'D').length;
const totalF     = assigned.filter(r => r.type === 'F').length;
const totalM     = assigned.filter(r => r.type === 'M').length;
const needFix    = assigned.filter(r => r.note && (r.note.includes('خطء')||r.note.includes('خطأ'))).length;

const summarySheet = [
  ['ملخص عملية الترقيم - جمارك'],
  [],
  ['البيان', 'العدد'],
  ['إجمالي سجلات تم ترقيمها', assigned.length],
  ['يحتاج مراجعة (لم يُرقَّم)', skipped.length],
  [],
  ['توزيع حسب نوع البطاقة', ''],
  ['أرباب أسر (بطاقة رئيسية)', totalMain],
  ['زوجات (Wx)', totalW],
  ['أبناء (Sx)', totalS],
  ['بنات (Dx)', totalD],
  ['آباء (Fx)', totalF],
  ['أمهات (Mx)', totalM],
  [],
  ['يحتاج تصحيح بيانات قبل الاستيراد', needFix],
  ['جاهز للاستيراد مباشرة', assigned.length - needFix],
  [],
  ['نمط الترقيم المستخدم', 'JMR2025{رقم وظيفي}{لاحقة}'],
  ['مثال أب',    'JMR2025{رقم وظيفي}F1'],
  ['مثال أم',    'JMR2025{رقم وظيفي}M1'],
  ['مثال زوجة', 'JMR2025{رقم وظيفي}W1'],
  ['مثال ابن',   'JMR2025{رقم وظيفي}S1'],
  ['مثال ابنة',  'JMR2025{رقم وظيفي}D1'],
];
const wsSummary = XLSX.utils.aoa_to_sheet(summarySheet);
wsSummary['!cols'] = [{ wch: 40 }, { wch: 12 }];
XLSX.utils.book_append_sheet(outWb, wsSummary, 'ملخص');

const outPath = path.join(outputDir, 'جمارك_JMR_بدون_بطاقة_مرقّمة.xlsx');
XLSX.writeFile(outWb, outPath);
console.log(`\n📁 تم حفظ الملف: ${outPath}`);
console.log(`   ورقة 1: ${assigned.length} سجل جاهز للاستيراد`);
console.log(`   ورقة 2: تفصيلي مع الملاحظات والإجراءات`);
console.log(`   ورقة 3: ${skipped.length} سجل يحتاج مراجعة يدوية`);
console.log(`   ورقة 4: ملخص إحصائي`);
console.log(`\n⚠️  تنبيه: ${needFix} سجل يحتاج تصحيح بيانات (رقم وطني / تاريخ ميلاد) قبل الاستيراد`);
