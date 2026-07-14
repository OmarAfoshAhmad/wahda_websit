import { createHash } from "crypto";
import prisma from "@/lib/prisma";

/**
 * SEC-FIX: سلسلة hash لسلامة سجلات التدقيق.
 * كل سجل يحتوي على hash مبني على بيانات السجل + hash السجل السابق.
 * أي تلاعب بسجل واحد يكسر السلسلة بالكامل.
 */

export function computeAuditHash(data: {
  prev_hash: string;
  user: string;
  action: string;
  metadata: unknown;
  created_at: string;
}): string {
  const payload = [
    data.prev_hash,
    data.user,
    data.action,
    JSON.stringify(data.metadata ?? null),
    data.created_at,
  ].join("|");

  return createHash("sha256").update(payload, "utf8").digest("hex");
}

/**
 * جلب آخر hash في السلسلة.
 * يُستخدم عند إنشاء سجل جديد لربطه بالسلسلة.
 */
export async function getLatestAuditHash(): Promise<string> {
  const latest = await prisma.auditLog.findFirst({
    orderBy: { created_at: "desc" },
    select: { metadata: true },
  });

  const metadata = (latest?.metadata ?? null) as Record<string, unknown> | null;
  const hash = metadata?._integrity_hash;
  return typeof hash === "string" && hash.length > 0 ? hash : "GENESIS";
}

/**
 * إنشاء سجل تدقيق مع hash سلامة مرتبط بالسلسلة.
 * يُستخدم كبديل مباشر لـ prisma.auditLog.create()
 */
export async function createAuditLogWithIntegrity(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0] | typeof prisma,
  data: {
    facility_id?: string;
    user: string;
    action: string;
    metadata?: unknown;
  },
) {
  // جلب آخر hash من الـ transaction context لضمان الترتيب
  const latest = await (tx as typeof prisma).auditLog.findFirst({
    orderBy: { created_at: "desc" },
    select: { metadata: true },
  });

  const latestMetadata = (latest?.metadata ?? null) as Record<string, unknown> | null;
  const prevHashFromMetadata = latestMetadata?._integrity_hash;
  const prevHash = typeof prevHashFromMetadata === "string" && prevHashFromMetadata.length > 0
    ? prevHashFromMetadata
    : "GENESIS";
  const now = new Date();

  const integrityHash = computeAuditHash({
    prev_hash: prevHash,
    user: data.user,
    action: data.action,
    metadata: data.metadata,
    created_at: now.toISOString(),
  });

  return (tx as typeof prisma).auditLog.create({
    data: {
      facility_id: data.facility_id,
      user: data.user,
      action: data.action,
      metadata: {
        ...((data.metadata && typeof data.metadata === "object" ? data.metadata : {}) as Record<string, unknown>),
        _integrity_prev_hash: prevHash,
        _integrity_hash: integrityHash,
      } as never,
      created_at: now,
    },
  });
}
