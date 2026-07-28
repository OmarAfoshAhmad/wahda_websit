"use server";

import { revalidatePath } from "next/cache";
import prisma from "@/lib/prisma";
import { normalizeCardNumber } from "@/lib/normalize";
import { assertCompanyAccessForSession } from "@/lib/company-scope";
import { resolveVerifiedSuperAdminActor } from "@/lib/super-admin-actor";
import { loadLatestImportDemographicEvidence, replaceCardSuffix, shouldTreatAsSoleEmployee, stripCardMemberSuffix } from "@/lib/import-demographic-evidence";

export type DemographicRepairMode = "employee_base" | "complete_plain_h" | "children_sd" | "restore_birth_dates";

export async function runDemographicRepairAction(input: { companyId: string; mode: DemographicRepairMode }) {
  const session = await resolveVerifiedSuperAdminActor();
  if (!session) return { success: false, processed_count: 0, skipped_count: 0, conflict_count: 0, error: "غير مصرح" };
  await assertCompanyAccessForSession(session, input.companyId);

  const evidence = await loadLatestImportDemographicEvidence(input.companyId);
  const beneficiaries = await prisma.beneficiary.findMany({
    where: { company_id: input.companyId, deleted_at: null },
    select: { id: true, name: true, card_number: true, birth_date: true },
  });
  const activeCardOwners = new Map(beneficiaries.map((row) => [normalizeCardNumber(row.card_number).toUpperCase(), row.id]));
  const familyCounts = new Map<string, number>();
  for (const row of beneficiaries) {
    const base = stripCardMemberSuffix(row.card_number) ?? normalizeCardNumber(row.card_number).toUpperCase();
    familyCounts.set(base, (familyCounts.get(base) ?? 0) + 1);
  }
  let processed = 0;
  let skipped = 0;
  let conflicts = 0;
  const undo: Array<Record<string, unknown>> = [];
  const details: Array<Record<string, unknown>> = [];

  for (const beneficiary of beneficiaries) {
    const card = normalizeCardNumber(beneficiary.card_number).toUpperCase();
    const source = evidence.get(card);
    let nextCard: string | null = null;
    let nextBirth: Date | null = null;

    const baseCard = stripCardMemberSuffix(card);
    const familyCount = baseCard ? (familyCounts.get(baseCard) ?? 0) : 0;
    if (input.mode === "employee_base" && baseCard && shouldTreatAsSoleEmployee(familyCount, source)) {
      nextCard = baseCard;
    } else if (input.mode === "complete_plain_h" && /H$/i.test(card) && familyCount > 1) {
      nextCard = `${card}1`;
    } else if (input.mode === "children_sd" && source?.childCode && /[A-Z]\d*$/i.test(card)) {
      nextCard = replaceCardSuffix(card, source.childCode);
    } else if (input.mode === "restore_birth_dates" && !beneficiary.birth_date && source?.birthDate) {
      nextBirth = source.birthDate;
    } else {
      continue;
    }

    if (nextCard && nextCard === card) continue;
    const ownerId = nextCard ? activeCardOwners.get(nextCard) : null;
    if (ownerId && ownerId !== beneficiary.id) {
      conflicts += 1;
      details.push({ id: beneficiary.id, name: beneficiary.name, old_card: card, proposed_card: nextCard, result: "conflict" });
      continue;
    }

    try {
      await prisma.$transaction(async (tx) => {
        if (nextCard) {
          await tx.beneficiary.update({ where: { id: beneficiary.id }, data: { card_number: nextCard } });
        } else if (nextBirth) {
          await tx.beneficiary.update({
            where: { id: beneficiary.id },
            data: { birth_date: nextBirth, birth_date_synced_from_truth: false },
          });
        }
      });
      if (nextCard) {
        activeCardOwners.delete(card);
        activeCardOwners.set(nextCard, beneficiary.id);
      }
      processed += 1;
      undo.push({ id: beneficiary.id, old_card_number: card, new_card_number: nextCard, old_birth_date: null, new_birth_date: nextBirth?.toISOString() ?? null });
      details.push({ id: beneficiary.id, name: beneficiary.name, old_card: card, new_card: nextCard, birth_date: nextBirth?.toISOString() ?? null, source_job_id: source?.sourceJobId ?? null, relationship: source?.relationship ?? null, result: "updated" });
    } catch {
      skipped += 1;
    }
  }

  await prisma.auditLog.create({
    data: {
      user: session.username,
      action: "FIX_DEMOGRAPHIC_CARD_PATTERNS",
      company_id: input.companyId,
      metadata: { mode: input.mode, processed_count: processed, skipped_count: skipped, conflict_count: conflicts, details: details.slice(0, 500), undo_snapshot: undo },
    },
  });
  revalidatePath("/admin/duplicates");
  return { success: true, processed_count: processed, skipped_count: skipped, conflict_count: conflicts };
}
