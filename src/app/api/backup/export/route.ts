import { NextRequest, NextResponse } from "next/server";
import { requireActiveFacilitySession } from "@/lib/session-guard";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { encryptBackup } from "@/lib/backup-crypto";

const BATCH_SIZE = 5000;

async function fetchBatches<T extends { id: string }>(
  model: { findMany: (args: object) => Promise<T[]> },
  orderBy: object,
  select?: object,
): Promise<T[]> {
  const results: T[] = [];
  let cursor: string | null = null;
  let hasMore = true;

  while (hasMore) {
    const batch = await model.findMany({
      ...(select ? { select } : {}),
      orderBy,
      take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    results.push(...batch);
    hasMore = batch.length === BATCH_SIZE;
    if (hasMore) {
      cursor = batch[batch.length - 1].id;
    }
  }

  return results;
}

export async function GET(request: NextRequest) {
  const session = await requireActiveFacilitySession();
  if (!session || session.role_v2 !== "SUPER_ADMIN") {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const includeSensitive = true;
  const searchParams = request.nextUrl.searchParams;
  const scope = searchParams.get("scope") === "company" ? "company" : "full";
  const companyId = (searchParams.get("companyId") ?? "").trim();

  try {
    const selectedCompany = scope === "company"
      ? await prisma.insuranceCompany.findFirst({
          where: { id: companyId, deleted_at: null },
        })
      : null;
    if (scope === "company" && !selectedCompany) {
      return NextResponse.json({ error: "يجب اختيار شركة صالحة لإنشاء نسخة شركة واحدة" }, { status: 400 });
    }

    const beneficiaryWhere = scope === "company" ? { company_id: companyId } : {};
    const transactionWhere = scope === "company"
      ? {
          OR: [
            { company_id: companyId },
            { beneficiary: { company_id: companyId } },
          ],
        }
      : {};
    const auditWhere = scope === "company" ? { company_id: companyId } : {};
    const notificationWhere = scope === "company"
      ? { beneficiary: { company_id: companyId } }
      : {};
    const claimWhere = scope === "company"
      ? {
          OR: [
            { company_id: companyId },
            { beneficiary: { company_id: companyId } },
          ],
        }
      : {};

    const [facilities, beneficiaries, transactions, auditLogs, notifications] = await Promise.all([
      fetchBatches(prisma.facility, { created_at: "asc" }),
      fetchBatches({ findMany: (args) => prisma.beneficiary.findMany({ ...args, where: beneficiaryWhere }) }, { created_at: "asc" }),
      fetchBatches({ findMany: (args) => prisma.transaction.findMany({ ...args, where: transactionWhere }) }, { created_at: "asc" }),
      fetchBatches({ findMany: (args) => prisma.auditLog.findMany({ ...args, where: auditWhere }) }, { created_at: "asc" }),
      fetchBatches({ findMany: (args) => prisma.notification.findMany({ ...args, where: notificationWhere }) }, { created_at: "asc" }),
    ]);
    const [
      companies,
      serviceTypes,
      servicePolicies,
      serviceMappings,
      walletConsumptions,
      claims,
      familyImportArchives,
      accountCompanyAccesses,
    ] = await Promise.all([
      scope === "company"
        ? Promise.resolve(selectedCompany ? [selectedCompany] : [])
        : fetchBatches(prisma.insuranceCompany, { created_at: "asc" }),
      fetchBatches(prisma.serviceType, { created_at: "asc" }),
      fetchBatches({ findMany: (args) => prisma.servicePolicy.findMany({ ...args, where: scope === "company" ? { company_id: companyId } : {} }) }, { created_at: "asc" }),
      fetchBatches({ findMany: (args) => prisma.serviceTypeMapping.findMany({ ...args, where: scope === "company" ? { company_id: companyId } : {} }) }, { id: "asc" }),
      fetchBatches({ findMany: (args) => prisma.walletConsumption.findMany({ ...args, where: scope === "company" ? { company_id: companyId } : {} }) }, { created_at: "asc" }),
      fetchBatches({ findMany: (args) => prisma.claim.findMany({ ...args, where: claimWhere }) }, { created_at: "asc" }),
      fetchBatches({ findMany: (args) => prisma.familyImportArchive.findMany({ ...args, where: scope === "company" ? { company_id: companyId } : {} }) }, { created_at: "asc" }),
      fetchBatches({ findMany: (args) => prisma.accountCompanyAccess.findMany({ ...args, where: scope === "company" ? { company_id: companyId } : {} }) }, { created_at: "asc" }),
    ]);

    const backup = {
      version: "1.0" as const,
      scope,
      company: selectedCompany ? { id: selectedCompany.id, name: selectedCompany.name, code: selectedCompany.code } : null,
      exported_at: new Date().toISOString(),
      created_by: session.username,
      includes_sensitive: includeSensitive,
      data: {
        companies: companies.map((c) => ({
          id: c.id,
          name: c.name,
          code: c.code,
          card_pattern: c.card_pattern,
          is_active: c.is_active,
          deleted_at: c.deleted_at?.toISOString() ?? null,
          created_at: c.created_at.toISOString(),
          updated_at: c.updated_at.toISOString(),
          service_type_mappings: c.service_type_mappings,
          logo: c.logo,
          dental_ceiling: c.dental_ceiling ? Number(c.dental_ceiling) : null,
          dental_coverage: Number(c.dental_coverage),
          general_ceiling: c.general_ceiling ? Number(c.general_ceiling) : null,
          general_coverage: Number(c.general_coverage),
          medicine_ceiling: c.medicine_ceiling ? Number(c.medicine_ceiling) : null,
          medicine_coverage: Number(c.medicine_coverage),
          dental_settings: c.dental_settings,
          service_aliases: c.service_aliases,
        })),
        service_types: serviceTypes.map((s) => ({
          id: s.id,
          code: s.code,
          name: s.name,
          is_active: s.is_active,
          created_at: s.created_at.toISOString(),
          updated_at: s.updated_at.toISOString(),
        })),
        service_policies: servicePolicies.map((p) => ({
          id: p.id,
          company_id: p.company_id,
          service_type_id: p.service_type_id,
          ceiling_amount: p.ceiling_amount ? Number(p.ceiling_amount) : null,
          coverage_percent: Number(p.coverage_percent),
          frequency_months: p.frequency_months,
          is_active: p.is_active,
          created_at: p.created_at.toISOString(),
          updated_at: p.updated_at.toISOString(),
        })),
        service_mappings: serviceMappings,
        wallet_consumptions: walletConsumptions.map((w) => ({
          id: w.id,
          beneficiary_id: w.beneficiary_id,
          company_id: w.company_id,
          wallet_type: w.wallet_type,
          fiscal_year: w.fiscal_year,
          consumed_amount: Number(w.consumed_amount),
          version: w.version,
          created_at: w.created_at.toISOString(),
          updated_at: w.updated_at.toISOString(),
        })),
        claims: claims.map((claim) => ({
          id: claim.id,
          beneficiary_id: claim.beneficiary_id,
          company_id: claim.company_id,
          service_type: claim.service_type,
          wallet_type: claim.wallet_type,
          requested_amount: Number(claim.requested_amount),
          approved_amount: Number(claim.approved_amount),
          status: claim.status,
          transaction_id: claim.transaction_id,
          idempotency_key: claim.idempotency_key,
          created_at: claim.created_at.toISOString(),
          updated_at: claim.updated_at.toISOString(),
        })),
        family_import_archives: familyImportArchives.map((row) => ({
          id: row.id,
          company_id: row.company_id,
          family_base_card: row.family_base_card,
          family_count_from_file: row.family_count_from_file,
          total_balance_from_file: row.total_balance_from_file ? Number(row.total_balance_from_file) : null,
          used_balance_from_file: row.used_balance_from_file ? Number(row.used_balance_from_file) : null,
          source_row_number: row.source_row_number,
          source_file_name: row.source_file_name,
          imported_by: row.imported_by,
          last_imported_at: row.last_imported_at.toISOString(),
          created_at: row.created_at.toISOString(),
          updated_at: row.updated_at.toISOString(),
        })),
        account_company_accesses: accountCompanyAccesses.map((access) => ({
          id: access.id,
          account_id: access.account_id,
          company_id: access.company_id,
          created_by_id: access.created_by_id,
          permissions: access.permissions,
          created_at: access.created_at.toISOString(),
          updated_at: access.updated_at.toISOString(),
        })),
        users: facilities.map((f) => ({
          id: f.id,
          name: f.name,
          username: f.username,
          password_hash: includeSensitive ? f.password_hash : null,
          is_admin: f.is_admin,
          is_manager: f.is_manager,
          is_employee: f.is_employee,
          role: f.role,
          role_v2: f.role_v2,
          parent_manager_id: f.parent_manager_id,
          created_by_id: f.created_by_id,
          facility_type: f.facility_type,
          manager_permissions: f.manager_permissions,
          must_change_password: f.must_change_password,
          deleted_at: f.deleted_at?.toISOString() ?? null,
          created_at: f.created_at.toISOString(),
        })),
        providers: beneficiaries.map((b) => ({
          id: b.id,
          card_number: b.card_number,
          name: b.name,
          birth_date: b.birth_date?.toISOString() ?? null,
          total_balance: Number(b.total_balance),
          remaining_balance: Number(b.remaining_balance),
          status: b.status,
          pin_hash: includeSensitive ? (b.pin_hash ?? null) : null,
          failed_attempts: b.failed_attempts,
          locked_until: b.locked_until?.toISOString() ?? null,
          deleted_at: b.deleted_at?.toISOString() ?? null,
          completed_via: b.completed_via,
          is_legacy_card: b.is_legacy_card,
          city: b.city,
          batch_number: b.batch_number,
          phone_number: b.phone_number,
          company_id: b.company_id,
          birth_date_synced_from_truth: b.birth_date_synced_from_truth,
          custom_ceilings: b.custom_ceilings,
          created_at: b.created_at.toISOString(),
        })),
        transactions: transactions.map((t) => ({
          id: t.id,
          beneficiary_id: t.beneficiary_id,
          facility_id: t.facility_id,
          amount: Number(t.amount),
          type: t.type,
          company_id: t.company_id,
          service_category: t.service_category,
          service_type_id: t.service_type_id,
          actual_company_share: t.actual_company_share ? Number(t.actual_company_share) : null,
          actual_patient_share: t.actual_patient_share ? Number(t.actual_patient_share) : null,
          original_company_share: t.original_company_share ? Number(t.original_company_share) : null,
          original_patient_share: t.original_patient_share ? Number(t.original_patient_share) : null,
          remaining_ceiling_before: t.remaining_ceiling_before ? Number(t.remaining_ceiling_before) : null,
          remaining_ceiling_after: t.remaining_ceiling_after ? Number(t.remaining_ceiling_after) : null,
          ceiling_consumed: t.ceiling_consumed ? Number(t.ceiling_consumed) : null,
          consumed_before: t.consumed_before ? Number(t.consumed_before) : null,
          consumed_after: t.consumed_after ? Number(t.consumed_after) : null,
          policy_snapshot: t.policy_snapshot,
          calc_metadata: t.calc_metadata,
          idempotency_key: t.idempotency_key,
          is_cancelled: t.is_cancelled,
          original_transaction_id: t.original_transaction_id,
          created_at: t.created_at.toISOString(),
        })),
        audit_logs: auditLogs.map((a) => ({
          id: a.id,
          facility_id: a.facility_id,
          user: a.user,
          action: a.action,
          metadata: a.metadata,
          ip_address: a.ip_address,
          company_id: a.company_id,
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
      },
    };

    await prisma.auditLog.create({
      data: {
        facility_id: session.id,
        user: session.username,
        action: "BACKUP_EXPORT",
        metadata: {
          includes_sensitive: includeSensitive,
          scope,
          company: selectedCompany ? { id: selectedCompany.id, name: selectedCompany.name, code: selectedCompany.code } : null,
          users: facilities.length,
          companies: companies.length,
          providers: beneficiaries.length,
          transactions: transactions.length,
          audit_logs: auditLogs.length,
          notifications: notifications.length,
        },
      },
    });

    const jsonData = JSON.stringify(backup);
    const encrypted = encryptBackup(jsonData);
    const safeCode = selectedCompany?.code?.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
    const filename = scope === "company"
      ? `wahda-company-${safeCode}-${new Date().toISOString().slice(0, 10)}.wbk`
      : `wahda-full-${new Date().toISOString().slice(0, 10)}.wbk`;

    return new NextResponse(new Uint8Array(encrypted), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Backup-Records": String(
          facilities.length + beneficiaries.length + transactions.length +
          auditLogs.length + notifications.length
        ),
      },
    });
  } catch (error) {
    logger.error("Backup export failed", { error: String(error) });
    return NextResponse.json({ error: "تعذر إنشاء النسخة الاحتياطية" }, { status: 500 });
  }
}
