import { NextRequest, NextResponse } from "next/server";
import { requireActiveFacilitySession } from "@/lib/session-guard";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { encryptBackup } from "@/lib/backup-crypto";
import { hasPermission } from "@/lib/permissions";

export async function GET(request: NextRequest) {
  const session = await requireActiveFacilitySession();
  if (!session || (!session.is_admin && !hasPermission(session, "manage_backup"))) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 403 });
  }

  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (process.env.NODE_ENV === "production" && forwardedProto && forwardedProto !== "https") {
    return NextResponse.json({ error: "يجب استخدام HTTPS" }, { status: 400 });
  }

  const includeSensitive = true;

  try {
    const [facilities, beneficiaries, transactions, auditLogs, notifications, familyImportArchive] = await Promise.all([
      prisma.facility.findMany({ orderBy: { created_at: "asc" } }),
      prisma.beneficiary.findMany({ orderBy: { created_at: "asc" } }),
      prisma.transaction.findMany({ orderBy: { created_at: "asc" } }),
      prisma.auditLog.findMany({ orderBy: { created_at: "asc" } }),
      prisma.notification.findMany({ orderBy: { created_at: "asc" } }),
      prisma.familyImportArchive.findMany({ orderBy: { family_base_card: "asc" } }),
    ]);

    const backup = {
      version: "1.1" as const,
      exported_at: new Date().toISOString(),
      created_by: session.username,
      includes_sensitive: includeSensitive,
      manifest: {
        facilities: facilities.length,
        beneficiaries: beneficiaries.length,
        transactions: transactions.length,
        transaction_amount: transactions.reduce((sum, row) => sum + Number(row.amount), 0),
        family_import_archive: familyImportArchive.length,
        family_used_balance: familyImportArchive.reduce((sum, row) => sum + Number(row.used_balance_from_file), 0),
      },
      data: {
        users: facilities.map((f) => ({
          id: f.id,
          name: f.name,
          username: f.username,
          password_hash: includeSensitive ? f.password_hash : null,
          is_admin: f.is_admin,
          is_manager: f.is_manager,
          manager_permissions: f.manager_permissions,
          must_change_password: f.must_change_password,
          facility_type: f.facility_type,
          deleted_at: f.deleted_at?.toISOString() ?? null,
          created_at: f.created_at.toISOString(),
        })),
        providers: beneficiaries.map((b) => ({
          id: b.id,
          card_number: b.card_number,
          name: b.name,
          birth_date: b.birth_date?.toISOString() ?? null,
          city: b.city,
          batch_number: b.batch_number,
          total_balance: Number(b.total_balance),
          remaining_balance: Number(b.remaining_balance),
          status: b.status,
          completed_via: b.completed_via,
          is_legacy_card: b.is_legacy_card,
          pin_hash: includeSensitive ? (b.pin_hash ?? null) : null,
          failed_attempts: b.failed_attempts,
          locked_until: b.locked_until?.toISOString() ?? null,
          deleted_at: b.deleted_at?.toISOString() ?? null,
          created_at: b.created_at.toISOString(),
        })),
        transactions: transactions.map((t) => ({
          id: t.id,
          beneficiary_id: t.beneficiary_id,
          facility_id: t.facility_id,
          amount: Number(t.amount),
          type: t.type,
          is_cancelled: t.is_cancelled,
          original_transaction_id: t.original_transaction_id,
          idempotency_key: t.idempotency_key,
          created_at: t.created_at.toISOString(),
        })),
        audit_logs: auditLogs.map((a) => ({
          id: a.id,
          facility_id: a.facility_id,
          user: a.user,
          action: a.action,
          metadata: a.metadata,
          created_at: a.created_at.toISOString(),
        })),
        notifications: notifications.map((n) => ({
          id: n.id,
          beneficiary_id: n.beneficiary_id,
          title: n.title,
          message: n.message,
          amount: n.amount ? Number(n.amount) : null,
          is_read: n.is_read,
          created_at: n.created_at.toISOString(),
        })),
        family_import_archive: familyImportArchive.map((row) => ({
          family_base_card: row.family_base_card,
          family_count_from_file: row.family_count_from_file,
          total_balance_from_file: Number(row.total_balance_from_file),
          used_balance_from_file: Number(row.used_balance_from_file),
          source_row_number: row.source_row_number,
          imported_by: row.imported_by,
          last_imported_at: row.last_imported_at.toISOString(),
          created_at: row.created_at.toISOString(),
          updated_at: row.updated_at.toISOString(),
          source_file_name: row.source_file_name,
        })),
      },
    };

    await prisma.auditLog.create({
      data: {
        facility_id: session.id,
        user: session.username,
        action: "BACKUP_EXPORT",
        metadata: {
          includes_sensitive: includeSensitive,
          users: facilities.length,
          providers: beneficiaries.length,
          transactions: transactions.length,
          audit_logs: auditLogs.length,
          notifications: notifications.length,
          family_import_archive: familyImportArchive.length,
        },
      },
    });

    const jsonData = JSON.stringify(backup);
    const encrypted = encryptBackup(jsonData);
    const filename = `wahda-backup-${new Date().toISOString().slice(0, 10)}.wbk`;

    return new NextResponse(new Uint8Array(encrypted), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Backup-Records": String(
          facilities.length + beneficiaries.length + transactions.length +
          auditLogs.length + notifications.length + familyImportArchive.length
        ),
      },
    });
  } catch (error) {
    logger.error("Backup export failed", { error: String(error) });
    return NextResponse.json({ error: "تعذر إنشاء النسخة الاحتياطية" }, { status: 500 });
  }
}
