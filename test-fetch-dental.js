import { SignJWT } from "jose";

async function main() {
  const payload = {
    "id": "cm08f1h20000j1xxxxxxx",
    "username": "aya_mgr",
    "name": "Dr. Aya",
    "role": "MANAGER",
    "is_admin": false,
    "is_manager": true,
    "is_employee": false,
    "must_change_password": false,
    "facility_type": "DENTAL",
    "manager_permissions": {
      "view_dashboard": true,
      "view_transactions": true,
      "import_beneficiaries": true,
      "add_beneficiary": true,
      "edit_beneficiary": true,
      "delete_beneficiary": true,
      "add_facility": true,
      "edit_facility": true,
      "delete_facility": true,
      "cancel_transactions": true,
      "correct_transactions": true,
      "edit_transaction": true,
      "manage_recycle_bin": true,
      "export_data": true,
      "print_cards": true,
      "view_audit_log": true,
      "view_reports": true,
      "view_facilities": true,
      "view_beneficiaries": true,
      "view_dental_beneficiaries": true,
      "deduct_balance": true,
      "delete_transaction": true,
      "cash_claim": true,
      "manage_card_numbering": true,
      "migrate_card_numbering": true,
      "manage_users": true,
      "manage_companies": true,
      "dental_services": true,
      "add_manual_transaction": true
    }
  };

  const key = new TextEncoder().encode("SUPER_SECRET_KEY_1234567890123456");
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(key);

  console.log("Token:", token);

  try {
    const res = await fetch("http://127.0.0.1:3000/admin/dental-services", {
      headers: {
        "Cookie": `session=${token}`,
        "User-Agent": "Mozilla/5.0",
      }
    });
    
    const text = await res.text();
    console.log("Status:", res.status);
    console.log("Headers size:", JSON.stringify([...res.headers.entries()]).length);
    console.log("Content size:", text.length);
    if (res.status === 500) {
      console.log("Response starts with:", text.substring(0, 500));
    }
  } catch (err) {
    console.error("Fetch error:", err);
  }
}

main();
