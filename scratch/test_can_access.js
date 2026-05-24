const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// Mock hasPermission logic from src/lib/permissions.ts
function hasPermission(session, permission) {
  if (!session) return false;
  if (session.is_admin === true) return true;
  
  if (session.is_manager || session.is_employee) {
    let perms = session.manager_permissions;
    if (!perms) return false;

    try {
      const permsObj = typeof perms === "string" ? JSON.parse(perms) : perms;
      const val = permsObj[permission];
      return !!val && (val === true || val === "true" || val === 1 || val === "1");
    } catch (e) {
      console.error("Error parsing permissions:", e);
      return false;
    }
  }
  return false;
}

async function main() {
  const dbRecord = await prisma.facility.findUnique({
    where: { username: "aya" },
    select: { 
      is_admin: true,
      is_manager: true, 
      is_employee: true, 
      manager_permissions: true,
      name: true,
      deleted_at: true,
      facility_type: true
    },
  });

  const session = {
    id: dbRecord.id,
    is_admin: dbRecord.is_admin,
    is_manager: dbRecord.is_manager,
    is_employee: dbRecord.is_employee,
    name: dbRecord.name,
    facility_type: dbRecord.facility_type,
    manager_permissions: dbRecord.manager_permissions
  };

  const canAccess = session.is_admin || (session.is_manager && hasPermission(session, "dental_services")) || session.facility_type === "DENTAL";
  console.log("canAccess value for aya is:", canAccess);
  console.log("session values are:", JSON.stringify(session, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
