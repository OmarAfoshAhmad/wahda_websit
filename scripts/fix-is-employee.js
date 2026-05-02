const { PrismaClient } = require("@prisma/client");

function buildPrisma(url) {
  if (url && url.trim()) {
    return new PrismaClient({ datasources: { db: { url: url.trim() } } });
  }
  return new PrismaClient();
}

function maskDbUrl(url) {
  if (!url) return "(from local env)";
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.hostname}:${parsed.port || "5432"}/${parsed.pathname.replace(/^\//, "")}`;
  } catch {
    return "(custom url)";
  }
}

function parseArgs(argv) {
  const args = { apply: false, byCashClaim: false, usernames: [], url: "" };

  for (const arg of argv) {
    if (arg === "--apply") {
      args.apply = true;
      continue;
    }

    if (arg === "--cash-claim") {
      args.byCashClaim = true;
      continue;
    }

    if (arg.startsWith("--usernames=")) {
      const raw = arg.slice("--usernames=".length);
      args.usernames = raw
        .split(",")
        .map((v) => v.trim().toLowerCase())
        .filter(Boolean);
      continue;
    }

    if (arg.startsWith("--url=")) {
      args.url = arg.slice("--url=".length).trim();
      continue;
    }
  }

  // Default mode: fix accounts where cash_claim=true.
  if (!args.byCashClaim && args.usernames.length === 0) {
    args.byCashClaim = true;
  }

  return args;
}

function printUsage() {
  console.log("الاستخدام:");
  console.log("  node scripts/fix-is-employee.js [--cash-claim] [--usernames=u1,u2] [--url=DATABASE_URL] [--apply]");
  console.log("");
  console.log("أمثلة:");
  console.log("  node scripts/fix-is-employee.js --cash-claim");
  console.log("  node scripts/fix-is-employee.js --cash-claim --url=\"postgresql://.../wahda_db\"");
  console.log("  node scripts/fix-is-employee.js --cash-claim --apply");
  console.log("  node scripts/fix-is-employee.js --usernames=hajar,test_e --apply");
}

async function getCandidatesByCashClaim(prisma) {
  return prisma.$queryRaw`
    SELECT id, username, name, is_employee
    FROM "Facility"
    WHERE deleted_at IS NULL
      AND COALESCE((manager_permissions->>'cash_claim')::boolean, false) = true
      AND is_employee = false
    ORDER BY username ASC
  `;
}

async function getCandidatesByUsernames(prisma, usernames) {
  return prisma.$queryRaw`
    SELECT id, username, name, is_employee
    FROM "Facility"
    WHERE deleted_at IS NULL
      AND LOWER(username) = ANY(${usernames}::text[])
      AND is_employee = false
    ORDER BY username ASC
  `;
}

async function applyByCashClaim(prisma) {
  return prisma.$queryRaw`
    UPDATE "Facility"
    SET is_employee = true
    WHERE deleted_at IS NULL
      AND COALESCE((manager_permissions->>'cash_claim')::boolean, false) = true
      AND is_employee = false
    RETURNING id, username, name, is_employee
  `;
}

async function applyByUsernames(prisma, usernames) {
  return prisma.$queryRaw`
    UPDATE "Facility"
    SET is_employee = true
    WHERE deleted_at IS NULL
      AND LOWER(username) = ANY(${usernames}::text[])
      AND is_employee = false
    RETURNING id, username, name, is_employee
  `;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prisma = buildPrisma(args.url);

  if (!args.byCashClaim && args.usernames.length === 0) {
    printUsage();
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }

  console.log(`قاعدة البيانات المستهدفة: ${maskDbUrl(args.url)}`);

  let candidates = [];
  if (args.usernames.length > 0) {
    candidates = await getCandidatesByUsernames(prisma, args.usernames);
  } else {
    candidates = await getCandidatesByCashClaim(prisma);
  }

  console.log(`عدد الحسابات المرشحة للتعديل: ${candidates.length}`);
  if (candidates.length > 0) {
    console.table(candidates);
  }

  if (!args.apply) {
    console.log("وضع المعاينة فقط. لإجراء التعديل فعليًا أعد التشغيل مع --apply");
    return;
  }

  let updated = [];
  if (args.usernames.length > 0) {
    updated = await applyByUsernames(prisma, args.usernames);
  } else {
    updated = await applyByCashClaim(prisma);
  }

  console.log(`تم تحديث ${updated.length} حساب إلى is_employee=true`);
  if (updated.length > 0) {
    console.table(updated);
  }
}

main()
  .catch((error) => {
    console.error("فشل تنفيذ السكربت:", error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
