import { NextResponse } from "next/server";
import { requireActiveFacilitySession } from "@/lib/session-guard";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { z } from "zod";

type TargetFilter = "all" | "beneficiaries" | "transactions" | "facilities";

const clearAuditLogSchema = z.object({
  target: z.enum(["all", "beneficiaries", "transactions", "facilities"]).optional().default("all"),
  actor: z.string().max(100).optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
});

const TARGET_ACTIONS: Record<TargetFilter, string[]> = {
  all: [
    "CREATE_BENEFICIARY",
    "IMPORT_BENEFICIARIES_BACKGROUND",
    "DELETE_BENEFICIARY",
    "PERMANENT_DELETE_BENEFICIARY",
    "RESTORE_BENEFICIARY",
    "DEDUCT_BALANCE",
    "CANCEL_TRANSACTION",
    "REVERT_CANCELLATION",
    "SOFT_DELETE_TRANSACTION",
    "RESTORE_SOFT_DELETED_TRANSACTION",
    "PERMANENT_DELETE_TRANSACTION",
    "BULK_CANCEL_TRANSACTION",
    "BULK_REDEDUCT_TRANSACTION",
    "IMPORT_TRANSACTIONS",
    "CREATE_FACILITY",
    "IMPORT_FACILITIES",
    "DELETE_FACILITY",
  ],
  beneficiaries: [
    "CREATE_BENEFICIARY",
    "IMPORT_BENEFICIARIES_BACKGROUND",
    "DELETE_BENEFICIARY",
    "PERMANENT_DELETE_BENEFICIARY",
    "RESTORE_BENEFICIARY",
  ],
  transactions: [
    "DEDUCT_BALANCE",
    "CANCEL_TRANSACTION",
    "REVERT_CANCELLATION",
    "SOFT_DELETE_TRANSACTION",
    "RESTORE_SOFT_DELETED_TRANSACTION",
    "PERMANENT_DELETE_TRANSACTION",
    "BULK_CANCEL_TRANSACTION",
    "BULK_REDEDUCT_TRANSACTION",
    "IMPORT_TRANSACTIONS",
  ],
  facilities: ["CREATE_FACILITY", "IMPORT_FACILITIES", "DELETE_FACILITY"],
};

export async function POST(request: Request) {
  const session = await requireActiveFacilitySession();
  if (!session) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  if (!session.is_admin) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const rawBody = await request.json().catch(() => ({}));
  const parsed = clearAuditLogSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "بيانات غير صالحة" }, { status: 400 });
  }

  const body = parsed.data;
  const target: TargetFilter = body.target;

  const createdAtFilter: { gte?: Date; lte?: Date } = {};
  if (body.start_date) {
    const d = new Date(body.start_date);
    if (!isNaN(d.getTime())) createdAtFilter.gte = d;
  }
  if (body.end_date) {
    const d = new Date(body.end_date);
    if (!isNaN(d.getTime())) {
      d.setHours(23, 59, 59, 999);
      createdAtFilter.lte = d;
    }
  }

  const where = {
    action: { in: TARGET_ACTIONS[target] },
    ...(body.actor?.trim() ? { user: { contains: body.actor.trim(), mode: "insensitive" as const } } : {}),
    ...(Object.keys(createdAtFilter).length > 0 ? { created_at: createdAtFilter } : {}),
  };

  try {
    const deleted = await prisma.auditLog.deleteMany({ where });

    await prisma.auditLog.create({
      data: {
        facility_id: session.id,
        user: session.username,
        action: "CLEAR_AUDIT_LOG",
        metadata: {
          deleted_count: deleted.count,
          target,
          actor: body.actor?.trim() ?? "",
          start_date: body.start_date ?? "",
          end_date: body.end_date ?? "",
        },
      },
    });

    return NextResponse.json({ success: true, deletedCount: deleted.count });
  } catch (error) {
    logger.error("Audit log clear failed", { error: String(error) });
    return NextResponse.json({ error: "تعذر تفريغ سجل المراقبة" }, { status: 500 });
  }
}
