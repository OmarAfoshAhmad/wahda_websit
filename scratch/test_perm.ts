import { PrismaClient } from "@prisma/client";
import { hasPermission } from "../src/lib/permissions";

const prisma = new PrismaClient();

async function main() {
  const dbRecord = await prisma.facility.findFirst({ where: { username: "aya_d" } });
  if (!dbRecord) {
    console.log("No dbRecord found!");
    return;
  }
  const session = {
    id: dbRecord.id,
    name: dbRecord.name,
    username: dbRecord.username,
    is_admin: dbRecord.is_admin,
    is_manager: dbRecord.is_manager,
    is_employee: dbRecord.is_employee,
    manager_permissions: dbRecord.manager_permissions as any,
    must_change_password: dbRecord.must_change_password
  };
  console.log("session:", session);
  console.log("hasPermission(dental_services):", hasPermission(session, "dental_services"));
}

main();
