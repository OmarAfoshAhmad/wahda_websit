import { redirect } from "next/navigation";
import { getBeneficiarySession } from "@/lib/beneficiary-auth";
import { familyHasPassword, listFamilyMembers, relationLabel } from "@/lib/beneficiary-family";
import { ChooseMemberClient } from "./client";

/** «لمن الدواء؟»: اختيار فرد الأسرة الذي تُسجَّل عليه الطلبات. أسرة من فرد واحد تذهب مباشرة إلى الرئيسية. */
export default async function ChooseMemberPage() {
  const session = await getBeneficiarySession();
  if (!session) redirect("/beneficiary/login");
  // لا دخول للبوابة قبل إنشاء كلمة مرور الأسرة بعد التحقق بالرمز.
  if (!(await familyHasPassword(session.account_id ?? session.id))) redirect("/beneficiary/setup-pin");
  const accountId = session.account_id ?? session.id;
  const members = await listFamilyMembers(accountId);
  if (members.length <= 1) redirect("/beneficiary/dashboard");

  return (
    <ChooseMemberClient
      currentId={session.id}
      members={members.map((member) => ({ id: member.id, name: member.name, relation: relationLabel(member.card_number, member.id === accountId) }))}
    />
  );
}
