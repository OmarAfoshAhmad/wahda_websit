const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const username = process.argv[2];
  if (!username) {
    throw new Error('Usage: node scripts/inspect-facility-password.js <username>');
  }

  const facility = await prisma.facility.findUnique({
    where: { username },
    select: {
      id: true,
      name: true,
      username: true,
      password_hash: true,
      must_change_password: true,
      deleted_at: true,
      created_at: true,
    },
  });

  if (!facility) {
    console.log('FACILITY_NOT_FOUND');
    return;
  }

  const auditLogs = await prisma.auditLog.findMany({
    where: {
      OR: [
        { facility_id: facility.id },
        { user: facility.username },
        {
          action: 'UPDATE_FACILITY',
          metadata: {
            path: ['facility_id'],
            equals: facility.id,
          },
        },
      ],
    },
    orderBy: { created_at: 'desc' },
    take: 50,
    select: {
      action: true,
      user: true,
      created_at: true,
      metadata: true,
    },
  });

  const knownCandidates = [
    '123456',
    'ImportOnly-ChangeMe-2026',
    'Admin123',
    'Admin123456',
  ];

  const matches = [];
  for (const candidate of knownCandidates) {
    const ok = await bcrypt.compare(candidate, facility.password_hash);
    if (ok) matches.push(candidate);
  }

  console.log(JSON.stringify({
    facility: {
      id: facility.id,
      name: facility.name,
      username: facility.username,
      must_change_password: facility.must_change_password,
      deleted_at: facility.deleted_at,
      created_at: facility.created_at,
      hash_prefix: facility.password_hash.slice(0, 10),
      hash_length: facility.password_hash.length,
    },
    knownPasswordMatches: matches,
    recentAuditLogs: auditLogs,
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
