const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const KNOWN_PASSWORDS = [
  '123456',
  'ImportOnly-ChangeMe-2026',
  'Admin123',
  'Admin123456',
];

function csvEscape(value) {
  const raw = String(value ?? '');
  return `"${raw.replace(/"/g, '""')}"`;
}

async function detectKnownPassword(hash) {
  for (const candidate of KNOWN_PASSWORDS) {
    if (await bcrypt.compare(candidate, hash)) {
      return candidate;
    }
  }
  return null;
}

async function main() {
  const facilities = await prisma.facility.findMany({
    where: { deleted_at: null },
    select: {
      id: true,
      name: true,
      username: true,
      password_hash: true,
      must_change_password: true,
      created_at: true,
      is_admin: true,
      is_manager: true,
    },
    orderBy: { username: 'asc' },
  });

  const hashGroupsMap = new Map();
  for (const facility of facilities) {
    const list = hashGroupsMap.get(facility.password_hash) ?? [];
    list.push(facility);
    hashGroupsMap.set(facility.password_hash, list);
  }

  const hashGroups = [];
  for (const [hash, members] of hashGroupsMap.entries()) {
    const knownPassword = await detectKnownPassword(hash);
    hashGroups.push({
      hash,
      knownPassword,
      members,
      count: members.length,
      mustChangeCount: members.filter((m) => m.must_change_password).length,
    });
  }

  hashGroups.sort((a, b) => b.count - a.count || a.hash.localeCompare(b.hash));

  const suspiciousFacilities = hashGroups
    .filter((group) => !group.knownPassword)
    .flatMap((group) => group.members.map((member) => ({
      id: member.id,
      name: member.name,
      username: member.username,
      must_change_password: member.must_change_password,
      is_admin: member.is_admin,
      is_manager: member.is_manager,
      created_at: member.created_at,
      hash: group.hash,
      hash_group_count: group.count,
    })));

  const outDir = path.join(process.cwd(), 'reports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const summaryPath = path.join(outDir, 'facility-password-hash-groups.csv');
  const suspiciousPath = path.join(outDir, 'facility-passwords-likely-random.csv');

  const summaryLines = ['count,must_change_count,known_password,hash'];
  for (const group of hashGroups) {
    summaryLines.push([
      csvEscape(group.count),
      csvEscape(group.mustChangeCount),
      csvEscape(group.knownPassword ?? 'UNKNOWN'),
      csvEscape(group.hash),
    ].join(','));
  }
  fs.writeFileSync(summaryPath, summaryLines.join('\n'), 'utf8');

  const suspiciousLines = ['id,name,username,must_change_password,is_admin,is_manager,created_at,hash_group_count,hash'];
  for (const row of suspiciousFacilities) {
    suspiciousLines.push([
      csvEscape(row.id),
      csvEscape(row.name),
      csvEscape(row.username),
      csvEscape(row.must_change_password),
      csvEscape(row.is_admin),
      csvEscape(row.is_manager),
      csvEscape(row.created_at.toISOString()),
      csvEscape(row.hash_group_count),
      csvEscape(row.hash),
    ].join(','));
  }
  fs.writeFileSync(suspiciousPath, suspiciousLines.join('\n'), 'utf8');

  console.log(JSON.stringify({
    totalActiveFacilities: facilities.length,
    distinctHashes: hashGroups.length,
    groups: hashGroups.map((group) => ({
      count: group.count,
      mustChangeCount: group.mustChangeCount,
      knownPassword: group.knownPassword ?? 'UNKNOWN',
      hash: group.hash,
      sampleUsernames: group.members.slice(0, 20).map((member) => member.username),
    })),
    suspiciousFacilitiesCount: suspiciousFacilities.length,
    summaryPath,
    suspiciousPath,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
