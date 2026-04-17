import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireActiveFacilitySession } from "@/lib/session-guard";

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function toFamilyBaseCard(cardNumber: string): string {
  // Strip only known family-member suffixes (e.g. M, F, H2, M1) and keep normal card numbers intact.
  return cardNumber.replace(/([WSDMFHV]\d*)$/i, "");
}

async function ensureFamilyImportArchiveTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "FamilyImportArchive" (
      "family_base_card" TEXT PRIMARY KEY,
      "family_count_from_file" INTEGER NOT NULL DEFAULT 0,
      "total_balance_from_file" NUMERIC(12, 2) NOT NULL DEFAULT 0,
      "used_balance_from_file" NUMERIC(12, 2) NOT NULL DEFAULT 0,
      "source_row_number" INTEGER,
      "imported_by" TEXT,
      "last_imported_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ transactionId: string }> },
) {
  const session = await requireActiveFacilitySession();
  if (!session) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  }
  if (!session.is_admin) {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  const { transactionId } = await params;
  const cleanId = String(transactionId ?? "").trim();
  if (!cleanId) {
    return NextResponse.json({ error: "معرف الحركة غير صالح" }, { status: 400 });
  }

  try {
    await ensureFamilyImportArchiveTable();

    const tx = await prisma.transaction.findFirst({
      where: { id: cleanId },
      select: {
        id: true,
        type: true,
        amount: true,
        created_at: true,
        beneficiary: {
          select: {
            id: true,
            card_number: true,
            name: true,
          },
        },
      },
    });

    if (!tx) {
      return NextResponse.json({ error: "الحركة غير موجودة" }, { status: 404 });
    }

    if (tx.type !== "IMPORT") {
      return NextResponse.json({ error: "هذه الحركة ليست استيراد" }, { status: 400 });
    }

    const familyBaseCard = toFamilyBaseCard(tx.beneficiary.card_number);

    const members = await prisma.$queryRaw<Array<{
      id: string;
      name: string;
      card_number: string;
      status: string;
      total_balance: number;
      remaining_balance: number;
      import_deducted: number;
      manual_deducted: number;
      consumed_total: number;
    }>>`
      SELECT
        b.id,
        b.name,
        b.card_number,
        b.status::text,
        b.total_balance::float8,
        b.remaining_balance::float8,
        COALESCE(SUM(CASE WHEN t.is_cancelled = false AND t.type = 'IMPORT' THEN t.amount ELSE 0 END), 0)::float8 AS import_deducted,
        COALESCE(SUM(CASE WHEN t.is_cancelled = false AND t.type <> 'CANCELLATION' AND t.type <> 'IMPORT' THEN t.amount ELSE 0 END), 0)::float8 AS manual_deducted,
        COALESCE(SUM(CASE WHEN t.is_cancelled = false AND t.type <> 'CANCELLATION' THEN t.amount ELSE 0 END), 0)::float8 AS consumed_total
      FROM "Beneficiary" b
      LEFT JOIN "Transaction" t ON t.beneficiary_id = b.id
      WHERE b.deleted_at IS NULL
        AND REGEXP_REPLACE(b.card_number, '([WSDMFHV][0-9]*)$', '') = ${familyBaseCard}
      GROUP BY b.id, b.name, b.card_number, b.status, b.total_balance, b.remaining_balance
      ORDER BY b.card_number ASC
    `;

    const archiveRows = await prisma.$queryRaw<Array<{
      family_count_from_file: number;
      total_balance_from_file: number;
      used_balance_from_file: number;
      source_row_number: number | null;
      last_imported_at: Date;
    }>>`
      SELECT
        "family_count_from_file"::int AS family_count_from_file,
        "total_balance_from_file"::float8 AS total_balance_from_file,
        "used_balance_from_file"::float8 AS used_balance_from_file,
        "source_row_number"::int AS source_row_number,
        "last_imported_at"
      FROM "FamilyImportArchive"
      WHERE "family_base_card" = ${familyBaseCard}
      LIMIT 1
    `;

    const archive = archiveRows[0] ?? null;
    const sourceUsedRaw = archive ? Number(archive.used_balance_from_file ?? 0) : 0;
    const expectedDeduction = Math.max(0, Math.round(sourceUsedRaw));
    const actualDeduction = round2(members.reduce((sum, m) => sum + Number(m.import_deducted ?? 0), 0));

    return NextResponse.json(
      {
        detail: {
          transaction: {
            id: tx.id,
            created_at: tx.created_at,
            clicked_import_amount: Number(tx.amount),
            beneficiary_name: tx.beneficiary.name,
            beneficiary_card_number: tx.beneficiary.card_number,
          },
          family_base_card: familyBaseCard,
          source: {
            family_count_from_file: archive ? Number(archive.family_count_from_file ?? 0) : null,
            total_balance_from_file: archive ? round2(Number(archive.total_balance_from_file ?? 0)) : null,
            used_balance_from_file: archive ? round2(sourceUsedRaw) : null,
            source_row_number: archive?.source_row_number ?? null,
            last_imported_at: archive?.last_imported_at ?? null,
          },
          system: {
            found_in_system_count: members.length,
          },
          amounts: {
            expected_deduction: expectedDeduction,
            actual_deduction: actualDeduction,
            deduction_diff: round2(actualDeduction - expectedDeduction),
          },
          members: members.map((m) => ({
            id: m.id,
            name: m.name,
            card_number: m.card_number,
            status: m.status,
            total_balance: Number(m.total_balance),
            remaining_balance: Number(m.remaining_balance),
            import_deducted: round2(Number(m.import_deducted)),
            manual_deducted: round2(Number(m.manual_deducted)),
            consumed_total: round2(Number(m.consumed_total)),
          })),
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[import-details] failed", error);
    return NextResponse.json({ error: "تعذر جلب تفاصيل الاستيراد" }, { status: 500 });
  }
}
