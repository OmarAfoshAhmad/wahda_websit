import prisma from "@/lib/prisma";
import { INITIAL_BALANCE } from "@/lib/config";

const MIN_INITIAL_BALANCE = 1;
const MAX_INITIAL_BALANCE = 1_000_000;

function parseInitialBalance(value: unknown): number | null {
  const asNumber = Number(value);
  if (!Number.isFinite(asNumber)) return null;
  if (!Number.isInteger(asNumber)) return null;
  if (asNumber < MIN_INITIAL_BALANCE || asNumber > MAX_INITIAL_BALANCE) return null;
  return asNumber;
}

export function getInitialBalanceRange() {
  return { min: MIN_INITIAL_BALANCE, max: MAX_INITIAL_BALANCE };
}

export async function getCurrentInitialBalance(): Promise<number> {
  try {
    const latest = await prisma.auditLog.findFirst({
      where: { action: "SET_INITIAL_BALANCE" },
      orderBy: { created_at: "desc" },
      select: { metadata: true },
    });

    if (!latest?.metadata || typeof latest.metadata !== "object") {
      return INITIAL_BALANCE;
    }

    const metadata = latest.metadata as Record<string, unknown>;
    const parsed = parseInitialBalance(metadata.value);
    return parsed ?? INITIAL_BALANCE;
  } catch {
    return INITIAL_BALANCE;
  }
}

export function normalizeInitialBalance(value: unknown): number | null {
  return parseInitialBalance(value);
}
