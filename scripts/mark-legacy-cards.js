/**
 * سكريبت وسم أصحاب البطاقات القديمة (is_legacy_card = true)
 * يعتمد على ملف CSV البسيط ليعمل داخل حاوية الإنتاج بدون أي مكتبات خارجية
 */
const { PrismaClient } = require('@prisma/client');
const path = require('path');
const fs = require('fs');

const p = new PrismaClient();

function normalizeCard(s) {
  if (!s) return '';
  return String(s).replace(/[\s\-]/g, '').toUpperCase().trim();
}

async function main() {
  console.log('=== بدء عملية وسم البطاقات القديمة من ملف CSV ===');
  
  // 1. تحديد مسار ملف CSV
  const csvPath = path.join(process.cwd(), 'card_analysis_result.csv');
  
  if (!fs.existsSync(csvPath)) {
    console.error(`❌ خطأ: لم يتم العثور على ملف النتائج في المسار:\n${csvPath}`);
    console.log('يرجى التأكد من نسخ أو رفع ملف card_analysis_result.csv إلى الحاوية أولاً.');
    process.exit(1);
  }

  console.log('📖 جاري قراءة وتحليل ملف CSV...');
  const csvContent = fs.readFileSync(csvPath, 'utf8');
  
  // تقسيم الأسطر
  const lines = csvContent.split('\n');
  const targetCards = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // تقسيم الأعمدة (رقم_البطاقة,الاسم,الحالة)
    const parts = line.split(',');
    if (parts.length < 3) continue;
    
    const cardNo = parts[0].replace(/^\uFEFF/, '').trim(); // إزالة BOM إن وجد
    const status = parts[2].trim();
    
    // إذا كانت الحالة "غير_موجود_في_جدول_الحقيقة" نقوم بضمها للوسم
    if (status.includes('غير_موجود_في_جدول_الحقيقة')) {
      targetCards.push(normalizeCard(cardNo));
    }
  }

  console.log(`🎯 عدد البطاقات المستهدفة للوسم من الملف: ${targetCards.length}`);

  if (targetCards.length === 0) {
    console.log('✓ لا توجد بطاقات تحتاج للوسم في الملف.');
    return;
  }

  // 2. تحديث قاعدة البيانات
  console.log('🔄 جاري تحديث قاعدة البيانات (وضع العلامة is_legacy_card = true)...');
  
  const updateResult = await p.$executeRaw`
    UPDATE "Beneficiary"
    SET "is_legacy_card" = true
    WHERE "deleted_at" IS NULL
      AND REPLACE(REPLACE(UPPER("card_number"), ' ', ''), '-', '') = ANY(${targetCards}::text[])
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
