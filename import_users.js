const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function importUsers() {
  try {
    const inputPath = path.join(__dirname, 'exported_users.json');
    
    if (!fs.existsSync(inputPath)) {
      console.error('❌ لم يتم العثور على ملف exported_users.json. يرجى التأكد من مسار الملف.');
      return;
    }

    const fileContent = fs.readFileSync(inputPath, 'utf-8');
    const users = JSON.parse(fileContent);
    
    console.log(`جاري استيراد ${users.length} مستخدم...`);

    let importedCount = 0;
    let skippedCount = 0;

    for (const user of users) {
      // التحقق مما إذا كان المستخدم موجود مسبقاً بناءً على اسم المستخدم
      const existingUser = await prisma.facility.findUnique({
        where: { username: user.username }
      });

      if (existingUser) {
        console.log(`⚠️ المستخدم ${user.username} موجود مسبقاً. سيتم تخطيه (أو يمكنك تعديل الكود لعمل Update).`);
        skippedCount++;
        continue;
      }

      // تحويل الصلاحيات القديمة إلى النظام الجديد
      let newRole = "FACILITY";
      if (user.is_admin) newRole = "ADMIN";
      else if (user.is_manager) newRole = "MANAGER";
      else if (user.is_employee) newRole = "EMPLOYEE";

      await prisma.facility.create({
        data: {
          id: user.id, // الاحتفاظ بنفس المعرف
          name: user.name,
          username: user.username,
          password_hash: user.password_hash,
          role: newRole,
          is_admin: Boolean(user.is_admin),
          is_manager: Boolean(user.is_manager),
          is_employee: Boolean(user.is_employee),
          facility_type: user.facility_type || null,
          must_change_password: Boolean(user.must_change_password),
          manager_permissions: user.manager_permissions ? user.manager_permissions : undefined,
          created_at: user.created_at ? new Date(user.created_at) : undefined,
        }
      });
      
      importedCount++;
    }
    
    console.log('-----------------------------------');
    console.log(`✅ تمت عملية الاستيراد بنجاح!`);
    console.log(`📥 إجمالي المستوردين: ${importedCount}`);
    console.log(`⏭️ إجمالي المتخطين (موجودين مسبقاً): ${skippedCount}`);
    console.log('-----------------------------------');
    
  } catch (error) {
    console.error('❌ حدث خطأ أثناء الاستيراد:', error);
  } finally {
    await prisma.$disconnect();
  }
}

importUsers();
