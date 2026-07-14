import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

async function main() {
  const adminPassword = process.env.ADMIN_SEED_PASSWORD;
  if (!adminPassword) {
    throw new Error("ADMIN_SEED_PASSWORD environment variable is required for seeding.");
  }
  const passwordHash = await bcrypt.hash(adminPassword, 10);
  
  const facility = await db.facility.upsert({
    where: { username: "admin" },
    update: { is_admin: true },
    create: {
      name: "شركة وعد - الإدارة",
      username: "admin",
      password_hash: passwordHash,
      is_admin: true,
    },
  });

  console.log({ facility });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
