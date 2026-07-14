"use server";

import { requireActiveFacilitySession, hasPermission } from "@/lib/session-guard";
import { createImportJob } from "@/lib/import-jobs";

export async function queueBeneficiariesImport(data: unknown[]) {
  const session = await requireActiveFacilitySession();
  if (!session) {
    return { error: "غير مصرح" };
  }
  if (!hasPermission(session, 'import_beneficiaries')) {
    return { error: "هذه العملية تتطلب صلاحية استيراد المستفيدين" };
  }

  return createImportJob(data, session.username);
}
