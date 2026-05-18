/**
 * سكريبت وسم أصحاب البطاقات القديمة (is_legacy_card = true)
 * يستثني تلقائياً كل من له دفعة في جدول الحقيقة (CardIssuanceRegistry)
 */
const ExcelJS = require('exceljs');
const { PrismaClient } = require('@prisma/client');
const path = require('path');
const fs = require('fs');

const p = new PrismaClient();

function normalizeCard(s) {
  if (!s) return '';
  return String(s).replace(/[\s\-]/g, '').toUpperCase().trim();
}

async function main() {
  console.log('=== بدء عملية وسم البطاقات القديمة ===');
  
  // 1. تحديد مسار ملف الإكسل
  const excelPath = path.join(process.cwd(), 'استيرا مستفيدين من الحركات.xlsx');
  
  if (!fs.existsSync(excelPath)) {
    console.error(`خطأ: لم يتم العثور على ملف الإكسل في المسار:\n${excelPath}`);
    console.log('يرجى التأكد من رفع ملف الإكسل بنفس الاسم في المجلد الرئيسي للمشروع على السيرفر.');
    process.exit(1);
  }

  console.log('📖 جاري قراءة ملف الإكسل...');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(excelPath);
  const ws = wb.worksheets[0];

  const excelCards = [];
  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return; // skip header
    const cardRaw = row.getCell(1).value;
    const name = row.getCell(2).value;
    if (!cardRaw) return;
    excelCards.push({
      card_number: String(cardRaw).trim(),
      card_upper: normalizeCard(String(cardRaw)),
      name: name ? String(name).trim() : '',
    });
  });

  console.log(`✅ تم تحميل ${excelCards.length} بطاقة من الملف.`);

  // 2. جلب جميع أرقام البطاقات الموجودة في جدول الحقيقة (بما في ذلك الأرشيف الشامل)
  console.log('🔍 جاري التحقق من جدول الحقيقة على قاعدة البيانات...');
  const cardUppers = excelCards.map(c => c.card_upper).filter(Boolean);

  const [inRegistry, inRegistryAll] = await Promise.all([
    p.$queryRaw`
      SELECT card_number_upper
      FROM "CardIssuanceRegistry"
      WHERE card_number_upper = ANY(${cardUppers}::text[])
    `,
    p.$queryRaw`
      SELECT card_number_upper
      FROM "CardIssuanceRegistryAll"
      WHERE card_number_upper = ANY(${cardUppers}::text[])
    `,
  ]);

  const inRegSet = new Set([
    ...inRegistry.map(r => r.card_number_upper),
    ...inRegistryAll.map(r => r.card_number_upper),
  ]);

  // 3. فلترة الحالات التي ليس لها دفعة
  const toMark = excelCards.filter(c => !inRegSet.has(c.card_upper));
  console.log(`📌 وجدنا ${excelCards.length - toMark.length} شخصاً مسجلاً في جدول الحقيقة (تم استثناؤهم).`);
  console.log(`🎯 المستهدفون للوسم كبطاقة قديمة: ${toMark.length} شخصاً.`);

  if (toMark.length === 0) {
    console.log('✓ لا توجد بطاقات تحتاج للوسم.');
    return;
  }

  // 4. تحديث قاعدة البيانات بوسم القديم
  console.log('🔄 جاري تحديث قاعدة البيانات (وضع العلامة is_legacy_card = true)...');
  
  const toMarkUppers = toMark.map(c => c.card_upper);
  
  // سنقوم بتحديث جميع المستفيدين الذين يطابق رقم بطاقتهم القائمة المستهدفة
  const updateResult = await p.$executeRaw`
    UPDATE "Beneficiary"
    SET "is_legacy_card" = true
    WHERE "deleted_at" IS NULL
      AND REPLACE(REPLACE(UPPER("card_number"), ' ', ''), '-', '') = ANY(${toMarkUppers}::text[])
  `;

  console.log(`\n============================================`);
  console.log(`🎉 اكتملت العملية بنجاح!`);
  console.log(`👥 عدد المستفيدين الذين تم وسمهم ببطاقة قديمة فعلياً: ${updateResult}`);
  console.log(`============================================`);
  
  await p.$disconnect();
}

main().catch(async e => {
  console.error('❌ حدث خطأ غير متوقع:', e.message);
  await p.$disconnect();
  process.exit(1);
});
