import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/prisma";
import { deductBalance } from "@/app/actions/deduction";
import { cancelTransaction } from "@/app/actions/cancel-transaction";
import { updateTransactionEntry } from "@/app/actions/transaction";
import { calculateBeneficiaryBalance } from "@/lib/tx-balance-guard";
import { getCappedConsumption } from "@/lib/insurance/consumption";
import { getFiscalYear } from "@/lib/insurance/fiscal-year";

/**
 * اختبار الثبات المالي على قاعدة حقيقية:
 * بعد كل عملية (خصم، إلغاء، تعديل مبلغ، تغيير تاريخ) يجب أن يتساوى
 *   - الرصيد المخزَّن مع الرصيد المحسوب من الدفتر،
 *   - واستهلاك السقف المحسوب مع مجموع الحركات غير الملغاة فقط.
 * أي انجراف هنا = عطل في مسار الكتابة، لا في البيانات.
 */

const sessionState = vi.hoisted(() => ({ session: {} as Record<string, unknown> }));
vi.mock("@/lib/session-guard", () => ({
  requireActiveFacilitySession: vi.fn(async () => sessionState.session),
  hasPermission: vi.fn(() => true),
}));
vi.mock("@/lib/company-scope", () => ({
  assertCompanyAccessForSession: vi.fn(async () => undefined),
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => null) }));
vi.mock("@/lib/sse-notifications", () => ({ emitNotification: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const SUFFIX = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const CARD = `INV${SUFFIX}`;
const DENTAL_CEILING = 1000;
const DENTAL_COVERAGE = 80;
const TOTAL_BALANCE = 600;

let companyId: string;
let facilityId: string;
let beneficiaryId: string;
let dentalPolicyId: string;
let createdServiceType = false;

async function assertMoneyInvariants(label: string) {
  const stored = await prisma.beneficiary.findUniqueOrThrow({
    where: { id: beneficiaryId },
    select: { remaining_balance: true, status: true },
  });
  const ledger = await calculateBeneficiaryBalance(prisma, beneficiaryId);
  expect(Number(stored.remaining_balance), `${label}: الرصيد المخزَّن ≠ الدفتر`).toBe(ledger.remaining_balance);
  expect(stored.status, `${label}: الحالة المخزَّنة ≠ المتوقعة`).toBe(ledger.status);

  for (const year of [getFiscalYear(new Date()), getFiscalYear(new Date()) - 1]) {
    const viaFunction = await getCappedConsumption(prisma, { beneficiaryId, walletType: "DENTAL", fiscalYear: year });
    const rows = await prisma.transaction.findMany({
      where: { beneficiary_id: beneficiaryId, type: "DENTAL", is_cancelled: false },
      select: { ceiling_consumed: true, created_at: true },
    });
    const expected = rows
      .filter((r) => getFiscalYear(r.created_at) === year)
      .reduce((s, r) => s + Number(r.ceiling_consumed ?? 0), 0);
    expect(viaFunction, `${label}: استهلاك ${year} ≠ مجموع الحركات غير الملغاة`).toBeCloseTo(expected, 2);
  }
}

async function storedRemaining(): Promise<number> {
  const b = await prisma.beneficiary.findUniqueOrThrow({ where: { id: beneficiaryId }, select: { remaining_balance: true } });
  return Number(b.remaining_balance);
}

async function dentalConsumption(year = getFiscalYear(new Date())): Promise<number> {
  return getCappedConsumption(prisma, { beneficiaryId, walletType: "DENTAL", fiscalYear: year });
}

async function lastTransactionId(type: "MEDICINE" | "DENTAL"): Promise<string> {
  const t = await prisma.transaction.findFirstOrThrow({
    where: { beneficiary_id: beneficiaryId, type, is_cancelled: false },
    orderBy: { created_at: "desc" },
    select: { id: true },
  });
  return t.id;
}

describe("money invariants across deduct / cancel / edit", () => {
  beforeAll(async () => {
    const databaseName = new URL(process.env.DATABASE_URL!).pathname.slice(1);
    expect(databaseName).toMatch(/test|testing|snapshot/i);

    let dentalType = await prisma.serviceType.findUnique({ where: { code: "DENTAL" } });
    if (!dentalType) {
      dentalType = await prisma.serviceType.create({ data: { code: "DENTAL", name: "الأسنان" } });
      createdServiceType = true;
    }

    const company = await prisma.insuranceCompany.create({
      data: { name: `شركة اختبار الثبات ${SUFFIX}`, code: `INV${SUFFIX}`, is_active: true },
    });
    companyId = company.id;

    const policy = await prisma.servicePolicy.create({
      data: {
        company_id: companyId,
        service_type_id: dentalType.id,
        ceiling_amount: DENTAL_CEILING,
        coverage_percent: DENTAL_COVERAGE,
        is_active: true,
      },
    });
    dentalPolicyId = policy.id;

    const facility = await prisma.facility.create({
      data: {
        name: `مرفق اختبار الثبات ${SUFFIX}`,
        username: `inv_${SUFFIX}`,
        password_hash: "x",
        is_admin: true,
        role_v2: "SUPER_ADMIN",
        facility_type: "HOSPITAL",
      },
    });
    facilityId = facility.id;
    sessionState.session = {
      id: facilityId,
      name: facility.name,
      username: facility.username,
      is_admin: true,
      is_manager: false,
      is_employee: false,
      role_v2: "SUPER_ADMIN",
      facility_type: "HOSPITAL",
    };

    const beneficiary = await prisma.beneficiary.create({
      data: {
        name: `مستفيد الثبات ${SUFFIX}`,
        card_number: CARD,
        total_balance: TOTAL_BALANCE,
        remaining_balance: TOTAL_BALANCE,
        status: "ACTIVE",
        company_id: companyId,
      },
    });
    beneficiaryId = beneficiary.id;
  });

  afterAll(async () => {
    if (!beneficiaryId) return;
    await prisma.notification.deleteMany({ where: { beneficiary_id: beneficiaryId } });
    await prisma.transaction.deleteMany({ where: { beneficiary_id: beneficiaryId } });
    await prisma.beneficiary.delete({ where: { id: beneficiaryId } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ facility_id: facilityId }, { company_id: companyId }] } });
    await prisma.facility.delete({ where: { id: facilityId } });
    await prisma.servicePolicy.delete({ where: { id: dentalPolicyId } });
    await prisma.insuranceCompany.delete({ where: { id: companyId } });
    if (createdServiceType) await prisma.serviceType.delete({ where: { code: "DENTAL" } });
  });

  it("keeps stored balance and ceiling consumption equal to the ledger through the whole lifecycle", async () => {
    // مصرف الوحدة فقط يخصم من الرصيد الأساسي؛ لهذا الاختبار نربط المستفيد بلا شركة أثناء الخصم العام.
    await prisma.beneficiary.update({ where: { id: beneficiaryId }, data: { company_id: null } });

    // 1. خصم أساسي
    const d1 = await deductBalance({ card_number: CARD, amount: 100, type: "MEDICINE" });
    expect(d1.error).toBeUndefined();
    expect(await storedRemaining()).toBe(500);
    await assertMoneyInvariants("بعد خصم أساسي 100");

    // 2. خصم أسنان (معزول): الرصيد الأساسي لا يتغير، والاستهلاك = حصة الشركة 80%
    await prisma.beneficiary.update({ where: { id: beneficiaryId }, data: { company_id: companyId } });
    const d2 = await deductBalance({ card_number: CARD, amount: 300, type: "DENTAL" });
    expect(d2.error).toBeUndefined();
    expect(await storedRemaining()).toBe(500);
    expect(await dentalConsumption()).toBeCloseTo(240, 2);
    await assertMoneyInvariants("بعد خصم أسنان 300");

    // 3. إلغاء حركة الأسنان: الاستهلاك يعود إلى صفر — لا إلى −240 (العكس المزدوج)
    const dentalId = await lastTransactionId("DENTAL");
    const c1 = await cancelTransaction(dentalId);
    expect(c1.error).toBeUndefined();
    expect(await dentalConsumption()).toBeCloseTo(0, 2);
    expect(await storedRemaining()).toBe(500);
    await assertMoneyInvariants("بعد إلغاء أسنان");

    // 4. تعديل مبلغ حركة أساسية 100 → 150
    await prisma.beneficiary.update({ where: { id: beneficiaryId }, data: { company_id: null } });
    const medicineId = await lastTransactionId("MEDICINE");
    const today = new Date().toISOString().slice(0, 10);
    const e1 = await updateTransactionEntry({ id: medicineId, amount: 150, type: "MEDICINE", transactionDate: today });
    expect(e1.error).toBeUndefined();
    expect(await storedRemaining()).toBe(450);
    await assertMoneyInvariants("بعد تعديل مبلغ أساسي");

    // 5. حركة أسنان جديدة ثم نقل تاريخها إلى السنة السابقة: الاستهلاك ينتقل معها
    await prisma.beneficiary.update({ where: { id: beneficiaryId }, data: { company_id: companyId } });
    const d3 = await deductBalance({ card_number: CARD, amount: 200, type: "DENTAL" });
    expect(d3.error).toBeUndefined();
    expect(await dentalConsumption()).toBeCloseTo(160, 2);
    const dental2Id = await lastTransactionId("DENTAL");
    const lastYear = getFiscalYear(new Date()) - 1;
    const e2 = await updateTransactionEntry({ id: dental2Id, amount: 200, type: "DENTAL", transactionDate: `${lastYear}-06-15` });
    expect(e2.error).toBeUndefined();
    expect(await dentalConsumption()).toBeCloseTo(0, 2);
    expect(await dentalConsumption(lastYear)).toBeCloseTo(160, 2);
    expect(await storedRemaining()).toBe(450);
    await assertMoneyInvariants("بعد نقل حركة أسنان لسنة سابقة");

    // 6. إلغاء الحركة الأساسية: الرصيد يعود كاملاً
    const c2 = await cancelTransaction(medicineId);
    expect(c2.error).toBeUndefined();
    expect(await storedRemaining()).toBe(TOTAL_BALANCE);
    await assertMoneyInvariants("بعد إلغاء الحركة الأساسية");
  });

  it("rejects a dental claim that exceeds the annual ceiling instead of shifting it to the patient", async () => {
    await prisma.beneficiary.update({ where: { id: beneficiaryId }, data: { company_id: companyId } });
    const before = await prisma.transaction.count({ where: { beneficiary_id: beneficiaryId, type: "DENTAL", is_cancelled: false } });

    // حصة الشركة 80% × 2000 = 1600 > السقف 1000
    const res = await deductBalance({ card_number: CARD, amount: 2000, type: "DENTAL" });
    expect(res.error).toMatch(/تجاوز السقف السنوي/);

    const after = await prisma.transaction.count({ where: { beneficiary_id: beneficiaryId, type: "DENTAL", is_cancelled: false } });
    expect(after).toBe(before);
    await assertMoneyInvariants("بعد رفض تجاوز السقف");
  });

  it("rejects a base-balance deduction larger than the ledger balance", async () => {
    await prisma.beneficiary.update({ where: { id: beneficiaryId }, data: { company_id: null } });
    const res = await deductBalance({ card_number: CARD, amount: TOTAL_BALANCE + 100, type: "MEDICINE" });
    expect(res.error).toMatch(/أكبر من الرصيد المتاح/);
    expect(await storedRemaining()).toBe(TOTAL_BALANCE);
    await assertMoneyInvariants("بعد رفض السحب فوق الرصيد");
  });
});
