import prisma from "@/lib/prisma";
import ExcelJS from "exceljs";
import { ParsedRow } from "./types";
import { normalizeUsedBalanceForImport } from "./utils";

/** Waad company facility ID (optional fallback) */
export function getWaadFacilityId(): string | undefined {
  const id = process.env.WAAD_FACILITY_ID?.trim();
  return id || undefined;
}

export async function resolveImportFacilityId(username: string, selectedFacilityId?: string): Promise<string> {
  // نثبت الاستيراد باسم/معرف المستخدم الحالي فقط (المسجل دخول)
  void selectedFacilityId;

  const actorFacility = await prisma.facility.findFirst({
    where: { username, deleted_at: null },
    select: { id: true },
  });

  if (actorFacility?.id) return actorFacility.id;

  const configuredId = getWaadFacilityId();
  if (configuredId) {
    const configuredFacility = await prisma.facility.findFirst({
      where: { id: configuredId, deleted_at: null },
      select: { id: true },
    });

    if (configuredFacility?.id) {
      return configuredFacility.id;
    }
  }

  throw new Error("WAAD_FACILITY_ID points to non-existing facility");
}

export function parseExcelRows(workbook: ExcelJS.Workbook): ParsedRow[] {
  const ws = workbook.worksheets[0];
  if (!ws) return [];

  // ── التحقق من هيكل ملف Excel (عدد الأعمدة) ──
  const headerRow = ws.getRow(1);
  if (headerRow) {
    const headerVals = headerRow.values as unknown[];
    const nonEmptyCols = (headerVals || []).filter((v, i) => i > 0 && v != null && String(v).trim() !== "");
    if (nonEmptyCols.length < 5) {
      throw new Error(
        "هيكل الملف غير صحيح: يجب أن يحتوي على 5 أعمدة على الأقل (رقم البطاقة، الاسم، عدد الأفراد، الرصيد الكلي، الرصيد المستخدم)",
      );
    }
  }

  const rows: ParsedRow[] = [];
  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return; // skip header

    const vals = row.values as unknown[];
    const cardNumber = String(vals[1] ?? "").trim();
    const name = String(vals[2] ?? "").trim();
    const familyCount = Number(vals[3]) || 0;
    const totalBalance = Number(vals[4]) || 0;
    const usedBalance = normalizeUsedBalanceForImport(vals[5]);

    if (cardNumber) {
      rows.push({ rowNumber: rowNum, cardNumber, name, familyCount, totalBalance, usedBalance });
    }
  });

  return rows;
}
