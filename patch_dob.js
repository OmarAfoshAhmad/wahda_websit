const { PrismaClient } = require('@prisma/client');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');

const prisma = new PrismaClient();

async function main() {
    const filePath = process.argv[2];
    if (!filePath) {
        console.error("يرجى تزويد مسار ملف الإكسيل الذي يحتوي على تاريخ الميلاد");
        console.error("مثال: node patch_dob.js C:\\path\\to\\file.xlsx");
        process.exit(1);
    }

    if (!fs.existsSync(filePath)) {
        console.error(`الملف غير موجود: ${filePath}`);
        process.exit(1);
    }

    console.log(`جاري قراءة الملف: ${filePath}`);
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(sheet);

    console.log(`تم العثور على ${data.length} صف في الملف.`);

    let updated = 0;
    let notFound = 0;
    let skipped = 0;
    let errors = 0;

    for (const row of data) {
        const cardNumber = row['رقم البطاقة'];
        const birthDateStr = row['تاريخ الميلاد'];

        if (!cardNumber || !birthDateStr) {
            skipped++;
            continue;
        }

        const normCard = cardNumber.toString().trim().toUpperCase();
        let birthDate;
        
        try {
            if (typeof birthDateStr === 'number') {
                // Excel date number (1900 date system)
                birthDate = new Date(Math.round((birthDateStr - 25569) * 86400 * 1000));
            } else {
                birthDate = new Date(birthDateStr);
            }
            if (isNaN(birthDate.getTime())) throw new Error("تاريخ غير صالح");
            
            // تحقق منطقي للتاريخ (بين 1900 و 2100)
            const year = birthDate.getFullYear();
            if (year < 1900 || year > 2100) {
                 throw new Error("تاريخ خارج النطاق المعقول");
            }

        } catch (e) {
            console.log(`تخطي تاريخ غير صالح (${birthDateStr}) للبطاقة ${normCard}`);
            errors++;
            continue;
        }

        // البحث في جدول المستفيدين المباشر
        const beneficiary = await prisma.beneficiary.findFirst({
            where: {
                card_number: {
                    equals: normCard,
                    mode: 'insensitive'
                },
                deleted_at: null
            }
        });

        if (beneficiary) {
            await prisma.beneficiary.update({
                where: { id: beneficiary.id },
                data: { birth_date: birthDate }
            });
            updated++;
            console.log(`تم التحديث: ${normCard} -> ${birthDate.toISOString().split('T')[0]}`);
        } else {
            console.log(`لم يتم العثور على البطاقة في المنظومة: ${normCard}`);
            notFound++;
        }
    }

    console.log(`\n============== الخلاصة ==============`);
    console.log(`تم التحديث بنجاح: ${updated}`);
    console.log(`بطاقات غير موجودة: ${notFound}`);
    console.log(`أخطاء في التاريخ: ${errors}`);
    console.log(`صفوف فارغة/متخطاة: ${skipped}`);
    console.log(`=====================================\n`);
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
