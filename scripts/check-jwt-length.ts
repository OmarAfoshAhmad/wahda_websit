import { SignJWT } from "jose";

async function test() {
  const payload = {
    id: "cmpi4z8bo00rdu9mkkmx5nf8o",
    name: "Some Name",
    username: "aya_d",
    role: "MANAGER",
    is_admin: false,
    is_manager: true,
    is_employee: false,
    must_change_password: false,
    manager_permissions: {
      view_dashboard: true,
      view_transactions: true,
      import_beneficiaries: false,
      add_beneficiary: false,
      edit_beneficiary: true,
      delete_beneficiary: false,
      manage_recycle_bin: false,
      view_facilities: true,
      add_facility: true,
      edit_facility: false,
      delete_facility: false,
      deduct_balance: true,
      cancel_transactions: false,
      correct_transactions: false,
      edit_transaction: true,
      delete_transaction: true,
      add_manual_transaction: false,
      view_beneficiaries: true,
      view_dental_beneficiaries: false,
      view_reports: false,
      view_audit_log: false,
      export_data: false,
      print_cards: false,
      manage_card_numbering: false,
      migrate_card_numbering: false,
      cash_claim: true,
      manage_users: false,
      manage_companies: false,
      dental_services: true
    }
  };

  const secret = new TextEncoder().encode("SUPER_SECRET_JWT_KEY_FOR_TESTING");
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(secret);

  console.log("Token length:", token.length);
}

test().catch(console.error);
