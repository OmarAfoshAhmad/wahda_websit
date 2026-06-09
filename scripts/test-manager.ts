import { PrismaClient } from "@prisma/client";
import { normalizeManagerPermissionsForRole } from "../src/lib/permission-catalog";

const prisma = new PrismaClient();

async function test() {
  const facility = await prisma.facility.findFirst({
    where: { role: "MANAGER" },
  });
  console.log("Facility:", facility?.username);

  if (facility) {
    const managerPermissions = normalizeManagerPermissionsForRole("MANAGER", facility.manager_permissions);
    console.log("Permissions:", managerPermissions);
  }
}

test().catch(console.error).finally(() => prisma.$disconnect());
