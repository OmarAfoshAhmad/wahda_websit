const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

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
  const aya = await prisma.facility.findUnique({
    where: { username: "aya" }
  });
  console.log("Aya DB record:", {
    id: aya.id,
    name: aya.name,
    is_manager: aya.is_manager,
    manager_permissions: aya.manager_permissions
  });
  const hasDental = hasPermission(aya, "dental_services");
  console.log("hasDental permission:", hasDental);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
