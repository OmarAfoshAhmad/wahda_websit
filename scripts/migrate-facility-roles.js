const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Copy inferFacilityTypeFromText from src/lib/facility-type.ts
function inferFacilityTypeFromText(name, username) {
  const text = `${name ?? ""} ${username ?? ""}`.toLowerCase();

  const pharmacyHints = ["صيدلية", "صيدليه", "pharmacy", "drugstore"];
  const dentalHints = ["أسنان", "اسنان", "dental", "dentist", "tooth"];
  const opticsHints = ["بصريات", "عيون", "نظارات", "optics", "optician", "eye"];
  const hospitalHints = ["مستشفى", "مشفى", "hospital", "clinic", "medical", "health"];

  if (pharmacyHints.some((hint) => text.includes(hint))) {
    return "PHARMACY";
  }
  if (dentalHints.some((hint) => text.includes(hint))) {
    return "DENTAL";
  }
  if (opticsHints.some((hint) => text.includes(hint))) {
    return "OPTICS";
  }
  if (hospitalHints.some((hint) => text.includes(hint))) {
    return "HOSPITAL";
  }

  return "HOSPITAL";
}

function normalizeFacilityTypeOverride(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  if (
    normalized === "HOSPITAL" ||
    normalized === "PHARMACY" ||
    normalized === "DENTAL" ||
    normalized === "OPTICS"
  ) {
    return normalized;
  }
  return null;
}

async function run() {
  console.log("Starting facility roles and types migration...");

  const facilities = await prisma.facility.findMany();
  console.log(`Found ${facilities.length} facility records in database.`);

  for (const f of facilities) {
    let resolvedRole = "FACILITY";
    if (f.is_admin) {
      resolvedRole = "ADMIN";
    } else if (f.is_manager) {
      resolvedRole = "MANAGER";
    } else if (f.is_employee) {
      resolvedRole = "EMPLOYEE";
    } else {
      // If is_manager/is_admin/is_employee are all false, but they have manager_permissions JSON,
      // it means they were incorrectly entered as a facility but they are actually managers/employees!
      if (f.manager_permissions && Object.keys(f.manager_permissions).length > 0) {
        // Let's check if the name/username has employee hints, otherwise promote to MANAGER
        const text = `${f.name} ${f.username}`.toLowerCase();
        if (text.includes("موظف") || text.includes("emp") || f.is_employee) {
          resolvedRole = "EMPLOYEE";
        } else {
          resolvedRole = "MANAGER";
        }
        console.log(`[PROMOTION] Promoting facility '${f.username}' (${f.name}) to ${resolvedRole} because they have manager_permissions.`);
      }
    }

    // Resolve facility type
    let resolvedType = null;
    if (resolvedRole === "FACILITY") {
      // Fetch updated facility override from AuditLog
      const facilityTypeOverrideRows = await prisma.$queryRaw`
        SELECT (metadata->>'facility_type_override') AS facility_type_override
        FROM "AuditLog"
        WHERE action IN ('CREATE_FACILITY', 'UPDATE_FACILITY')
          AND (metadata->>'facility_id') = ${f.id}
          AND metadata ? 'facility_type_override'
        ORDER BY created_at DESC
        LIMIT 1
      `;

      const override = facilityTypeOverrideRows[0]?.facility_type_override;
      resolvedType = normalizeFacilityTypeOverride(override) ?? inferFacilityTypeFromText(f.name, f.username);
    } else {
      // Admins, managers, employees do not have a facility type
      resolvedType = null;
    }

    // Update the database record
    await prisma.facility.update({
      where: { id: f.id },
      data: {
        role: resolvedRole,
        facility_type: resolvedType,
        // Also sync old boolean flags just in case
        is_manager: resolvedRole === "MANAGER",
        is_employee: resolvedRole === "EMPLOYEE",
        is_admin: resolvedRole === "ADMIN",
      }
    });

    console.log(`Updated '${f.username}': role=${resolvedRole}, type=${resolvedType}`);
  }

  console.log("Migration completed successfully!");
}

run()
  .catch(err => {
    console.error("Migration failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
