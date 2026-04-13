const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function csvEscape(value) {
  const raw = String(value ?? "");
  return `"${raw.replace(/"/g, '""')}"`;
}

async function main() {
  const rows = await prisma.facility.findMany({
    where: {
      deleted_at: null,
      must_change_password: true,
    },
    select: {
      id: true,
      name: true,
      username: true,
      created_at: true,
      password_hash: true,
    },
    orderBy: { username: "asc" },
  });

  const groupsMap = new Map();
  for (const row of rows) {
    const list = groupsMap.get(row.password_hash) ?? [];
    list.push(row);
    groupsMap.set(row.password_hash, list);
  }

  const groups = [...groupsMap.entries()]
    .map(([hash, facilities]) => ({ hash, facilities, count: facilities.length }))
    .sort((a, b) => b.count - a.count || a.hash.localeCompare(b.hash));

  const outDir = path.join(process.cwd(), "reports");
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const markdownPath = path.join(outDir, "facilities-must-change-password-by-hash.md");
  const csvPath = path.join(outDir, "facilities-must-change-password-hash-summary.csv");

  const md = [];
  md.push("# Facilities Must Change Password Grouped By Hash");
  md.push("");
  md.push(`Total facilities: ${rows.length}`);
  md.push(`Distinct hashes: ${groups.length}`);
  md.push("");

  groups.forEach((group, index) => {
    md.push(`## Group ${index + 1} - ${group.count} facilities`);
    md.push("");
    md.push(`Hash: ${group.hash}`);
    md.push("");
    md.push("| # | Username | Name | Created At | ID |");
    md.push("|---|---|---|---|---|");
    group.facilities.forEach((facility, idx) => {
      md.push(`| ${idx + 1} | ${facility.username} | ${facility.name} | ${facility.created_at.toISOString()} | ${facility.id} |`);
    });
    md.push("");
  });

  fs.writeFileSync(markdownPath, md.join("\n"), "utf8");

  const csv = ["group_no,count,hash,username,name,created_at,id"];
  groups.forEach((group, index) => {
    group.facilities.forEach((facility) => {
      csv.push([
        csvEscape(index + 1),
        csvEscape(group.count),
        csvEscape(group.hash),
        csvEscape(facility.username),
        csvEscape(facility.name),
        csvEscape(facility.created_at.toISOString()),
        csvEscape(facility.id),
      ].join(","));
    });
  });
  fs.writeFileSync(csvPath, csv.join("\n"), "utf8");

  console.log(`total=${rows.length}`);
  console.log(`distinctHashes=${groups.length}`);
  console.log(`markdown=${markdownPath}`);
  console.log(`csv=${csvPath}`);
  console.table(groups.map((group, index) => ({ group: index + 1, count: group.count, hash: group.hash })));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
