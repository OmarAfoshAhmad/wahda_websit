const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const summary = await prisma.$queryRaw`
    SELECT
      COUNT(*)::int AS total,
      SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END)::int AS deleted,
      SUM(CASE WHEN password_hash IS NULL OR BTRIM(password_hash) = '' THEN 1 ELSE 0 END)::int AS empty_hash,
      SUM(CASE WHEN password_hash IS NOT NULL AND BTRIM(password_hash) <> '' AND password_hash !~ '^\\$2[aby]\\$.{56}$' THEN 1 ELSE 0 END)::int AS non_bcrypt_hash,
      SUM(CASE WHEN username <> BTRIM(username) THEN 1 ELSE 0 END)::int AS username_has_spaces,
      SUM(CASE WHEN username <> LOWER(username) THEN 1 ELSE 0 END)::int AS username_not_lower
    FROM "Facility"
  `;

  const suspicious = await prisma.$queryRaw`
    SELECT
      id,
      name,
      username,
      LEFT(COALESCE(password_hash, ''), 30) AS hash_prefix,
      COALESCE(LENGTH(password_hash), 0)::int AS hash_len,
      must_change_password,
      deleted_at
    FROM "Facility"
    WHERE password_hash IS NULL
      OR BTRIM(password_hash) = ''
      OR password_hash !~ '^\\$2[aby]\\$.{56}$'
      OR username <> BTRIM(username)
      OR username <> LOWER(username)
    ORDER BY created_at DESC
    LIMIT 100
  `;

  console.log("=== FACILITY LOGIN DIAGNOSTICS ===");
  console.log(summary[0]);
  console.log("\n=== SUSPICIOUS FACILITIES ===");
  console.table(suspicious);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
