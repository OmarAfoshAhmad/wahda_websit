const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const facilities = await prisma.facility.findMany({
    select: {
      id: true,
      name: true,
      username: true,
      deleted_at: true,
      must_change_password: true,
      created_at: true,
      password_hash: true,
    },
    orderBy: { created_at: 'desc' },
  });

  const [loginLogs, resetLogs] = await Promise.all([
    prisma.auditLog.findMany({
      where: { action: 'LOGIN' },
      select: { facility_id: true, user: true, created_at: true },
      orderBy: { created_at: 'desc' },
      take: 50000,
    }),
    prisma.auditLog.findMany({
      where: { action: 'UPDATE_FACILITY' },
      select: { metadata: true, created_at: true, user: true },
      orderBy: { created_at: 'desc' },
      take: 50000,
    }),
  ]);

  const lastLoginByFacilityId = new Map();
  const lastLoginByUsername = new Map();
  for (const log of loginLogs) {
    if (log.facility_id && !lastLoginByFacilityId.has(log.facility_id)) {
      lastLoginByFacilityId.set(log.facility_id, log.created_at);
    }
    if (log.user && !lastLoginByUsername.has(log.user)) {
      lastLoginByUsername.set(log.user, log.created_at);
    }
  }

  const lastResetByFacilityId = new Map();
  for (const log of resetLogs) {
    const m = log.metadata || {};
    if (typeof m !== 'object' || m === null) continue;
    const facilityId = m.facility_id;
    const reset = m.reset_password;
    if (typeof facilityId === 'string' && reset === true && !lastResetByFacilityId.has(facilityId)) {
      lastResetByFacilityId.set(facilityId, { at: log.created_at, by: log.user });
    }
  }

  const rows = facilities.map((f) => {
    const hash = f.password_hash || '';
    const hashLooksValidBcrypt = /^\$2[aby]\$.{56}$/.test(hash);
    const lastLoginAt = lastLoginByFacilityId.get(f.id) || lastLoginByUsername.get(f.username) || null;
    const resetInfo = lastResetByFacilityId.get(f.id) || null;
    const lastResetAt = resetInfo ? resetInfo.at : null;
    const resetNoLogin = !!(lastResetAt && (!lastLoginAt || lastLoginAt < lastResetAt));

    return {
      id: f.id,
      name: f.name,
      username: f.username,
      deleted: !!f.deleted_at,
      must_change_password: f.must_change_password,
      hash_valid_bcrypt: hashLooksValidBcrypt,
      hash_len: hash.length,
      created_at: f.created_at,
      last_login_at: lastLoginAt,
      last_reset_at: lastResetAt,
      reset_no_login: resetNoLogin,
    };
  });

  const summary = {
    total: rows.length,
    deleted: rows.filter((r) => r.deleted).length,
    active: rows.filter((r) => !r.deleted).length,
    invalid_hash: rows.filter((r) => !r.hash_valid_bcrypt).length,
    must_change_password_active: rows.filter((r) => !r.deleted && r.must_change_password).length,
    never_logged_in_active: rows.filter((r) => !r.deleted && !r.last_login_at).length,
    reset_but_not_logged_after_reset_active: rows.filter((r) => !r.deleted && r.reset_no_login).length,
  };

  console.log('=== FACILITY AUTH STATE SUMMARY ===');
  console.log(summary);

  const top = rows
    .filter((r) => !r.deleted && (r.reset_no_login || r.must_change_password || !r.last_login_at || !r.hash_valid_bcrypt))
    .slice(0, 120)
    .map((r) => ({
      username: r.username,
      name: r.name,
      must_change_password: r.must_change_password,
      hash_valid_bcrypt: r.hash_valid_bcrypt,
      last_login_at: r.last_login_at,
      last_reset_at: r.last_reset_at,
      reset_no_login: r.reset_no_login,
    }));

  console.log('\n=== AT-RISK / BLOCKED-LIKE ACTIVE FACILITIES (sample) ===');
  console.table(top);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
