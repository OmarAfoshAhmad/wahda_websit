const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function csvEscape(value) {
  const raw = String(value ?? "");
  return `"${raw.replace(/"/g, '""')}"`;
}

async function main() {
  const facilities = await prisma.facility.findMany({
    where: {
      deleted_at: null,
      must_change_password: true,
    },
    select: {
      id: true,
      name: true,
      username: true,
      created_at: true,
    },
    orderBy: {
      username: "asc",
    },
  });

  const outDir = path.join(process.cwd(), "reports");
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const filePath = path.join(outDir, "facilities-must-change-password.csv");
  const lines = ["id,name,username,created_at"];

  for (const f of facilities) {
    lines.push(
      [
        csvEscape(f.id),
        csvEscape(f.name),
        csvEscape(f.username),
        csvEscape(f.created_at.toISOString()),
      ].join(",")
    );
  }

  fs.writeFileSync(filePath, lines.join("\n"), "utf8");

  console.log(`count=${facilities.length}`);
  console.log(`file=${filePath}`);
  console.table(
    facilities.slice(0, 20).map((f, i) => ({
      n: i + 1,
      username: f.username,
      name: f.name,
    }))
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
