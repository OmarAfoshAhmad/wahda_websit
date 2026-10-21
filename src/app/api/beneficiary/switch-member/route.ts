import { NextRequest, NextResponse } from "next/server";
import { beneficiaryLogin, getBeneficiarySessionFromRequest } from "@/lib/beneficiary-auth";
import { listFamilyMembers } from "@/lib/beneficiary-family";

/** يحدد فرد الأسرة الذي يُطلب له الدواء: يجب أن يكون من أسرة صاحب الحساب في الجلسة. */
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (origin && host && new URL(origin).host !== host) {
    return NextResponse.json({ error: "طلب غير مسموح" }, { status: 403 });
  }

  const session = await getBeneficiarySessionFromRequest(req);
  if (!session) return NextResponse.json({ error: "انتهت الجلسة" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const memberId = typeof body?.beneficiary_id === "string" ? body.beneficiary_id : "";

  const accountId = session.account_id ?? session.id;
  const member = (await listFamilyMembers(accountId)).find((item) => item.id === memberId);
  if (!member) return NextResponse.json({ error: "هذا الشخص ليس من أفراد الأسرة" }, { status: 403 });

  await beneficiaryLogin({ id: member.id, name: member.name, card_number: member.card_number, account_id: accountId, auth: session.auth, otp_at: session.otp_at });
  return NextResponse.json({ status: "ok" });
}
