const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function exportUsers() {
  try {
    console.log('جاري تصدير المستخدمين (المرافق والمدراء)...');
    
    const users = await prisma.facility.findMany({
      where: {
        deleted_at: null, // لا تقم بتصدير المستخدمين المحذوفين
      },
      select: {
        id: true,
        name: true,
        username: true,
        password_hash: true,
        role: true,
        is_admin: true,
        is_manager: true,
        is_employee: true,
        facility_type: true,
        must_change_password: true,
        manager_permissions: true,
        created_at: true,
      }
    });

    const outputPath = path.join(__dirname, 'exported_users.json');
    fs.writeFileSync(outputPath, JSON.stringify(users, null, 2), 'utf-8');
    
    console.log(`✅ تم تصدير ${users.length} مستخدم بنجاح!`);
    console.log(`📂 تم الحفظ في: ${outputPath}`);
    
  } catch (error) {
    console.error('❌ حدث خطأ أثناء التصدير:', error);
  } finally {
    await prisma.$disconnect();
  }
}

exportUsers();
