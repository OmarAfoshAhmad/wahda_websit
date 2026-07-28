import prisma from "@/lib/prisma";
import { normalizeCardNumber } from "@/lib/normalize";
import { parseImportBirthDate } from "@/lib/import-jobs";

export type ImportDemographicEvidence = {
  cardNumber: string;
  relationship: string;
  childCode: "S" | "D" | null;
  spouseCode: "W" | "H" | null;
  isEmployee: boolean;
  isSpouse: boolean;
  birthDate: Date | null;
  sourceJobId: string;
};

function normalizeText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    if (Array.isArray(objectValue.richText)) {
      return objectValue.richText.map((part) => String((part as { text?: unknown }).text ?? "")).join("").trim();
    }
    if ("result" in objectValue) return String(objectValue.result ?? "").trim();
    if ("text" in objectValue) return String(objectValue.text ?? "").trim();
  }
  return String(value).trim();
}

function getField(row: Record<string, unknown>, keys: string[]): unknown {
  const normalizedEntries = Object.entries(row).map(([key, value]) => [key.trim().toLowerCase(), value] as const);
  for (const key of keys) {
    const found = normalizedEntries.find(([candidate]) => candidate === key.toLowerCase());
    if (found) return found[1];
  }
  return undefined;
}

export function relationshipToChildCode(value: unknown): "S" | "D" | null {
  const relation = normalizeText(value).toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه");
  if (!relation) return null;
  if (/^(ابنه|بنت|انثى|daughter|female)$/.test(relation)) return "D";
  if (/^(ابن|ولد|ذكر|son|male)$/.test(relation)) return "S";
  return null;
}

export function isEmployeeRelationship(value: unknown): boolean {
  const relation = normalizeText(value).toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه");
  return /^(موظف|الموظف|موظفه|الموظفه|موظف نفسه|الموظف نفسه|موظفه نفسها|الموظفه نفسها|مشترك|المشترك|مشتركه|المشتركه|رئيسي|المستفيد الرئيسي|رب الاسره|رب عائله|employee|self|subscriber|principal)$/.test(relation);
}

export function relationshipToSpouseCode(value: unknown): "W" | "H" | null {
  const relation = normalizeText(value).toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه");
  if (/^(زوجه|الزوجه|wife)$/.test(relation)) return "W";
  if (/^(زوج|الزوج|husband)$/.test(relation)) return "H";
  return null;
}

export function isSpouseRelationship(value: unknown): boolean {
  const relation = normalizeText(value).toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه");
  return /^(زوجه|الزوجه|wife|spouse)$/.test(relation);
}

export function shouldTreatAsSoleEmployee(
  familyCount: number,
  evidence: Pick<ImportDemographicEvidence, "isEmployee" | "spouseCode" | "childCode"> | undefined,
): boolean {
  if (familyCount !== 1) return false;
  if (evidence?.spouseCode || evidence?.childCode) return false;
  return evidence?.isEmployee === true || evidence === undefined || (!evidence.spouseCode && !evidence.childCode);
}

export function stripCardMemberSuffix(cardNumber: string): string | null {
  const card = normalizeCardNumber(cardNumber).toUpperCase();
  const match = card.match(/^(.+?)([A-Z])(\d+)?$/);
  if (!match || !/\d/.test(match[1])) return null;
  return match[1];
}

export function replaceCardSuffix(cardNumber: string, code: "W" | "H" | "S" | "D"): string | null {
  const card = normalizeCardNumber(cardNumber).toUpperCase();
  const match = card.match(/^(.+?)([A-Z])(\d+)?$/);
  if (!match || !/\d/.test(match[1])) return null;
  const index = match[3] || "1";
  return `${match[1]}${code}${index}`;
}

export async function loadLatestImportDemographicEvidence(companyId: string) {
  const jobs = await prisma.importJob.findMany({
    where: { company_id: companyId, status: "COMPLETED" },
    select: { id: true, payload: true, completed_at: true, created_at: true },
    orderBy: [{ completed_at: "desc" }, { created_at: "desc" }],
    take: 25,
  });

  const evidenceByCard = new Map<string, ImportDemographicEvidence>();
  for (const job of jobs) {
    if (!Array.isArray(job.payload)) continue;
    for (const raw of job.payload) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const row = raw as Record<string, unknown>;
      const cardNumber = normalizeCardNumber(normalizeText(getField(row, [
        "card_number", "رقم البطاقة", "رقم_البطاقة", "الرقم", "رقم_بطاقة", "الرقم الوظيفي", "لرقم الوظيفي", "رقم الموظف", "ر.م", "insurance profile",
      ]))).toUpperCase();
      if (!cardNumber || evidenceByCard.has(cardNumber)) continue;
      const relationship = normalizeText(getField(row, ["relationship", "صلة القرابة", "القرابة", "الصلة", "صلة", "المستفيد", "نوع المستفيد", "status"]));
      const birthRaw = getField(row, ["birth_date", "date_of_birth", "birthdate", "تاريخ_الميلاد", "تاريخ الميلاد", "تاريخ الملاد", "الميلاد", "المواليد", "مواليد", "dob"]);
      evidenceByCard.set(cardNumber, {
        cardNumber,
        relationship,
        childCode: relationshipToChildCode(relationship),
        spouseCode: relationshipToSpouseCode(relationship),
        isEmployee: isEmployeeRelationship(relationship),
        isSpouse: isSpouseRelationship(relationship),
        birthDate: parseImportBirthDate(birthRaw),
        sourceJobId: job.id,
      });
    }
  }
  return evidenceByCard;
}
