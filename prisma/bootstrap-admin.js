/* eslint-disable @typescript-eslint/no-require-imports */
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const db = new PrismaClient();

async function bootstrapServiceTypes() {
  const defaultServices = [
    { code: "DENTAL", name: "الأسنان", is_active: true },
    { code: "OPTICS", name: "البصريات", is_active: true }
  ];

  for (const service of defaultServices) {
    await db.serviceType.upsert({
      where: { code: service.code },
      update: { name: service.name },
      create: service,
    });
  }
  console.log("[bootstrap-admin] Service types (DENTAL, OPTICS) are ready.");
}

async function main() {
  const username = process.env.DEFAULT_ADMIN_USERNAME;
  const password = process.env.DEFAULT_ADMIN_PASSWORD;
  const name = process.env.DEFAULT_ADMIN_NAME || "System Admin";

  if (!username || !password) {
    console.log("[bootstrap-admin] skipped: DEFAULT_ADMIN_USERNAME or DEFAULT_ADMIN_PASSWORD is not set");
    return;
  }

  const activeAdmins = await db.facility.count({
    where: {
      is_admin: true,
      deleted_at: null,
    },
  });

  if (activeAdmins > 0) {
    console.log("[bootstrap-admin] skipped: active admin already exists");
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  await db.facility.upsert({
    where: { username },
    update: {
      name,
      password_hash: passwordHash,
      is_admin: true,
      must_change_password: true,
      deleted_at: null,
    },
    create: {
      name,
      username,
      password_hash: passwordHash,
      is_admin: true,
      must_change_password: true,
    },
  });

  console.log(`[bootstrap-admin] admin account is ready for username: ${username}`);
  
  // Initialize default service types
  await bootstrapServiceTypes();
}

main()
  .catch((err) => {
    console.error("[bootstrap-admin] failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
