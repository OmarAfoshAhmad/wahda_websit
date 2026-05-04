const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const facility = await prisma.facility.findFirst({
    where: { username: 'om' }
  });
  
  if (!facility) {
    console.log('User om not found');
    return;
  }

  const updatedPermissions = {
    cash_claim: true,
    view_facilities: true,
    manage_card_numbering: true,
    view_beneficiaries: true,
    view_audit_log: true,
    manage_users: false,
    export_data: true,
    print_cards: true
  };

  await prisma.facility.update({
    where: { id: facility.id },
    data: {
      is_employee: true,
      is_manager: false,
      manager_permissions: updatedPermissions
    }
  });

  console.log('Successfully updated om permissions');
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
