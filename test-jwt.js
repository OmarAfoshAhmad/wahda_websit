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
  };

  const key = new TextEncoder().encode("SUPER_SECRET_KEY_1234567890123456");
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(key);

  console.log("Cookie size in bytes:", Buffer.from(token).length);
}

main();
