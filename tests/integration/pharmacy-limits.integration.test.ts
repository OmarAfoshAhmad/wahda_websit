import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import prisma from "@/lib/prisma";
import {
  cancelPharmacyDispense,
  cancelPharmacyPrescription,
  createPharmacyPrescription,
  dispenseChronicDrugs,
  dispensePharmacyPrescriptionItems,
  reservePharmacyPrescriptionItems,
} from "@/app/actions/pharmacy";
import { ACTIVE_DISPENSE } from "@/lib/pharmacy/summary";
import { calculateBeneficiaryBalance } from "@/lib/tx-balance-guard";

/**
 * حدود الصيدلية على قاعدة حقيقية: الحد اليومي (ومع الطلبات المتزامنة)، صلاحية الوصفة ليوم إصدارها،
 * إلغاء الوصفة غير المستخدمة، سقف الفئة (ومع الصرف المتزامن)، الإلغاء وإعادة الصرف، والمزمن كل 28 يومًا.
 */

const sessionState = vi.hoisted(() => ({ session: {} as Record<string, unknown> }));
vi.mock("@/lib/session-guard", () => ({
  getSessionWithFreshPermissions: vi.fn(async () => sessionState.session),
  requireActiveFacilitySession: vi.fn(async () => sessionState.session),
  hasPermission: vi.fn(() => true),
}));
vi.mock("@/lib/company-scope", () => ({ assertCompanyAccessForSession: vi.fn(async () => undefined) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => null) }));
vi.mock("@/lib/sse-notifications", () => ({ emitNotification: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const SUFFIX = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const ROUTINE_CEILING = 100;
const ROUTINE_COVERAGE = 80;

let companyId: string;
let facilityId: string;
let policyId: string;
let drugId: string;
const beneficiaryIds: string[] = [];
let keyCounter = 0;
const key = () => `pl-${SUFFIX}-${++keyCounter}`;

async function newBeneficiary(label: string) {
  const beneficiary = await prisma.beneficiary.create({
    data: { name: `مستفيد ${label} ${SUFFIX}`, card_number: `PL${SUFFIX}${beneficiaryIds.length}`, total_balance: 10000, remaining_balance: 10000, status: "ACTIVE", company_id: companyId },
  });
  beneficiaryIds.push(beneficiary.id);
  return beneficiary.id;
}

/** المرفقان الإلزاميان كصفوف مباشرة؛ مسار الرفع نفسه (تحويل الصور) خارج نطاق هذا الاختبار. */
async function attach(prescriptionId: string) {
  await prisma.pharmacyDispenseAttachment.createMany({
    data: (["INSURANCE_CARD", "PRESCRIPTION"] as const).map((kind) => ({
      prescription_id: prescriptionId, kind, uploaded_by_id: facilityId, file_name: `${kind}.webp`, mime_type: "image/webp", file_size: 1, storage_path: `storage/test/${SUFFIX}-${kind}`,
    })),
  });
}

async function openPrescription(beneficiaryId: string, category: "ROUTINE" | "CHEMICAL" = "ROUTINE") {
  const created = await createPharmacyPrescription({ companyId, beneficiaryId, category });
  expect(created.error, "إنشاء الوصفة").toBeUndefined();
  await attach(created.prescriptionId!);
  return created.prescriptionId!;
}

async function cardFile() {
  const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#5588aa" } }).png().toBuffer();
  return new File([new Uint8Array(png)], "card.png", { type: "image/png" });
}

describe("pharmacy limits against a real database", () => {
  beforeAll(async () => {
    const databaseName = new URL(process.env.DATABASE_URL!).pathname.slice(1);
    expect(databaseName).toMatch(/test|testing|snapshot/i);

    const medicine = await prisma.serviceType.upsert({ where: { code: "MEDICINE" }, update: {}, create: { code: "MEDICINE", name: "خدمات الصيدلية" } });
    const company = await prisma.insuranceCompany.create({ data: { name: `شركة حدود الصيدلية ${SUFFIX}`, code: `PL${SUFFIX}`, is_active: true } });
    companyId = company.id;
    const policy = await prisma.servicePolicy.create({
      data: {
        company_id: companyId, service_type_id: medicine.id, ceiling_amount: null, coverage_percent: 100, is_active: true,
        pharmacy_config: {
          create: {
            routine_enabled: true, routine_ceiling: ROUTINE_CEILING, routine_coverage_percent: ROUTINE_COVERAGE,
            chronic_enabled: true, chronic_ceiling: null, chronic_coverage_percent: 100,
            chemical_enabled: true, chemical_ceiling: null, chemical_coverage_percent: 100,
            routine_daily_limit: 2, chemical_daily_limit: 2, chronic_interval_days: 28,
          },
        },
      },
    });
    policyId = policy.id;
    const facility = await prisma.facility.create({
      data: { name: `صيدلية الاختبار ${SUFFIX}`, username: `pl_${SUFFIX}`, password_hash: "x", is_admin: true, role_v2: "SUPER_ADMIN", facility_type: "PHARMACY" },
    });
    facilityId = facility.id;
    sessionState.session = { id: facilityId, name: facility.name, username: facility.username, is_admin: true, is_manager: false, is_employee: false, role_v2: "SUPER_ADMIN", facility_type: "PHARMACY" };
    const drug = await prisma.drugCatalog.create({ data: { name: `Testdrug ${SUFFIX}`, normalized_name: `testdrug ${SUFFIX}` } });
    drugId = drug.id;
  });

  afterAll(async () => {
    if (beneficiaryIds.length) {
      const where = { beneficiary_id: { in: beneficiaryIds } };
      await prisma.pharmacyDispenseAttachment.deleteMany({ where: { OR: [{ prescription: where }, { dispense: where }] } });
      await prisma.pharmacyDispenseItem.deleteMany({ where: { dispense: where } });
      await prisma.pharmacyDispense.deleteMany({ where });
      await prisma.pharmacyPrescriptionItem.deleteMany({ where: { prescription: where } });
      await prisma.pharmacyPrescription.deleteMany({ where });
      await prisma.beneficiaryChronicDrug.deleteMany({ where });
      await prisma.notification.deleteMany({ where });
      await prisma.transaction.deleteMany({ where });
      await prisma.beneficiary.deleteMany({ where: { id: { in: beneficiaryIds } } });
    }
    if (drugId) await prisma.drugCatalog.delete({ where: { id: drugId } });
    if (facilityId) {
      await prisma.auditLog.deleteMany({ where: { OR: [{ facility_id: facilityId }, { company_id: companyId }] } });
      await prisma.facility.delete({ where: { id: facilityId } });
    }
    if (policyId) {
      await prisma.pharmacyPolicyConfig.deleteMany({ where: { service_policy_id: policyId } });
      await prisma.servicePolicy.delete({ where: { id: policyId } });
    }
    if (companyId) await prisma.insuranceCompany.delete({ where: { id: companyId } });
  });

  it("allows two prescriptions per day per category, each category separately", async () => {
    const id = await newBeneficiary("الحد اليومي");
    expect((await createPharmacyPrescription({ companyId, beneficiaryId: id, category: "ROUTINE" })).error).toBeUndefined();
    expect((await createPharmacyPrescription({ companyId, beneficiaryId: id, category: "ROUTINE" })).error).toBeUndefined();
    expect((await createPharmacyPrescription({ companyId, beneficiaryId: id, category: "ROUTINE" })).error).toMatch(/الحد اليومي/);
    // الأورام لها حدها المستقل
    expect((await createPharmacyPrescription({ companyId, beneficiaryId: id, category: "CHEMICAL" })).error).toBeUndefined();
    expect((await createPharmacyPrescription({ companyId, beneficiaryId: id, category: "CHEMICAL" })).error).toBeUndefined();
    expect((await createPharmacyPrescription({ companyId, beneficiaryId: id, category: "CHEMICAL" })).error).toMatch(/الحد اليومي/);
  });

  it("never exceeds the daily limit under concurrent requests", async () => {
    const id = await newBeneficiary("التزامن");
    const results = await Promise.all(Array.from({ length: 6 }, () => createPharmacyPrescription({ companyId, beneficiaryId: id, category: "ROUTINE" })));
    expect(results.filter((result) => !result.error)).toHaveLength(2);
    expect(await prisma.pharmacyPrescription.count({ where: { beneficiary_id: id } })).toBe(2);
  });

  it("renews the limit daily: yesterday's prescriptions do not count and cannot be used", async () => {
    const id = await newBeneficiary("التجديد");
    const first = await openPrescription(id);
    const second = await openPrescription(id);
    const yesterday = new Date(Date.now() - 26 * 60 * 60 * 1000);
    await prisma.pharmacyPrescription.updateMany({ where: { id: { in: [first, second] } }, data: { created_at: yesterday } });

    // وصفتا الأمس منتهيتان: لا حجز ولا صرف عليهما
    expect((await reservePharmacyPrescriptionItems(first, [1])).error).toMatch(/انتهت صلاحية الوصفة/);
    expect((await dispensePharmacyPrescriptionItems({ prescriptionId: second, items: [{ sequence: 1, price: 10 }], idempotencyKey: key() })).error).toMatch(/انتهت صلاحية الوصفة/);
    expect(await prisma.pharmacyDispense.count({ where: { beneficiary_id: id } })).toBe(0);

    // واليوم وصفتان جديدتان
    const today = await openPrescription(id);
    await openPrescription(id);
    expect((await createPharmacyPrescription({ companyId, beneficiaryId: id, category: "ROUTINE" })).error).toMatch(/الحد اليومي/);
    expect((await dispensePharmacyPrescriptionItems({ prescriptionId: today, items: [{ sequence: 1, price: 10 }], idempotencyKey: key() })).error).toBeUndefined();
  });

  it("cancelling an unused prescription frees its place; a used one cannot be cancelled", async () => {
    const id = await newBeneficiary("إلغاء الوصفة");
    const used = await openPrescription(id);
    const unused = await openPrescription(id);
    expect((await createPharmacyPrescription({ companyId, beneficiaryId: id, category: "ROUTINE" })).error).toMatch(/الحد اليومي/);

    const dispensed = await dispensePharmacyPrescriptionItems({ prescriptionId: used, items: [{ sequence: 1, price: 10 }], idempotencyKey: key() });
    expect(dispensed.error).toBeUndefined();
    expect((await cancelPharmacyPrescription(used)).error).toMatch(/ألغِ الصرف أولًا/);

    expect((await cancelPharmacyPrescription(unused)).error).toBeUndefined();
    expect((await dispensePharmacyPrescriptionItems({ prescriptionId: unused, items: [{ sequence: 1, price: 10 }], idempotencyKey: key() })).error).toMatch(/غير متاحة/);
    expect((await createPharmacyPrescription({ companyId, beneficiaryId: id, category: "ROUTINE" })).error).toBeUndefined();

    // بعد إلغاء الصرف تصبح الوصفة المستخدمة قابلة للإلغاء
    expect((await cancelPharmacyDispense(dispensed.dispenseId!, "اختبار")).success).toBe(true);
    expect((await cancelPharmacyPrescription(used)).error).toBeUndefined();
  });

  it("enforces the category ceiling on gross, and frees it on cancel for re-dispensing the same item", async () => {
    const id = await newBeneficiary("السقف");
    const rx = await openPrescription(id);
    const first = await dispensePharmacyPrescriptionItems({ prescriptionId: rx, items: [{ sequence: 1, price: 60 }], idempotencyKey: key() });
    expect(first.error).toBeUndefined();
    const dispense = await prisma.pharmacyDispense.findFirstOrThrow({ where: { id: first.dispenseId! }, select: { gross_total: true, company_total: true, patient_total: true } });
    expect(Number(dispense.gross_total)).toBe(60);
    expect(Number(dispense.company_total)).toBe(60 * ROUTINE_COVERAGE / 100);
    expect(Number(dispense.patient_total)).toBe(60 - 60 * ROUTINE_COVERAGE / 100);

    // 60 + 50 = 110 > 100
    expect((await dispensePharmacyPrescriptionItems({ prescriptionId: rx, items: [{ sequence: 2, price: 50 }], idempotencyKey: key() })).error).toBeDefined();
    // البند المصروف لا يُصرف مرتين
    expect((await dispensePharmacyPrescriptionItems({ prescriptionId: rx, items: [{ sequence: 1, price: 5 }], idempotencyKey: key() })).error).toMatch(/مصروف مسبقًا/);

    // الإلغاء يعيد السقف ويحرر البند نفسه لإعادة صرفه بالسعر الصحيح
    expect((await cancelPharmacyDispense(first.dispenseId!, "سعر خاطئ")).success).toBe(true);
    expect((await dispensePharmacyPrescriptionItems({ prescriptionId: rx, items: [{ sequence: 1, price: 95 }], idempotencyKey: key() })).error).toBeUndefined();
    const active = await prisma.pharmacyDispense.aggregate({ where: { beneficiary_id: id, ...ACTIVE_DISPENSE }, _sum: { gross_total: true } });
    expect(Number(active._sum.gross_total)).toBe(95);

    const stored = await prisma.beneficiary.findUniqueOrThrow({ where: { id }, select: { remaining_balance: true } });
    expect(Number(stored.remaining_balance)).toBe((await calculateBeneficiaryBalance(prisma, id)).remaining_balance);
  });

  it("never exceeds the ceiling under concurrent dispenses from two prescriptions", async () => {
    const id = await newBeneficiary("سقف متزامن");
    const [a, b] = [await openPrescription(id), await openPrescription(id)];
    const results = await Promise.all([
      dispensePharmacyPrescriptionItems({ prescriptionId: a, items: [{ sequence: 1, price: 70 }], idempotencyKey: key() }),
      dispensePharmacyPrescriptionItems({ prescriptionId: b, items: [{ sequence: 2, price: 70 }], idempotencyKey: key() }),
    ]);
    expect(results.filter((result) => !result.error)).toHaveLength(1);
    const active = await prisma.pharmacyDispense.aggregate({ where: { beneficiary_id: id, ...ACTIVE_DISPENSE }, _sum: { gross_total: true } });
    expect(Number(active._sum.gross_total)).toBeLessThanOrEqual(ROUTINE_CEILING);
  });

  it("dispenses each chronic drug once per 28 days; cancelling restores eligibility", async () => {
    const id = await newBeneficiary("المزمن");
    const link = await prisma.beneficiaryChronicDrug.create({ data: { beneficiary_id: id, drug_id: drugId } });
    const chronic = async () => {
      const formData = new FormData();
      formData.set("companyId", companyId);
      formData.set("beneficiaryId", id);
      formData.set("idempotencyKey", key());
      formData.set("items", JSON.stringify([{ chronicDrugId: link.id, price: 40 }]));
      formData.set("insuranceCard", await cardFile());
      return dispenseChronicDrugs(formData);
    };

    const first = await chronic();
    expect(first.error).toBeUndefined();
    expect((await chronic()).error).toMatch(/يُسمح بصرفه مجددًا/);
    expect((await cancelPharmacyDispense(first.dispenseId!, "اختبار")).success).toBe(true);
    expect((await chronic()).error).toBeUndefined();

    // دواء غير مرتبط بالمستفيد مرفوض
    const formData = new FormData();
    formData.set("companyId", companyId);
    formData.set("beneficiaryId", id);
    formData.set("idempotencyKey", key());
    formData.set("items", JSON.stringify([{ chronicDrugId: "not-linked", price: 10 }]));
    formData.set("insuranceCard", await cardFile());
    expect((await dispenseChronicDrugs(formData)).error).toMatch(/غير مرتبط/);
  });

  it("treats a repeated submit with the same key as one dispense", async () => {
    const id = await newBeneficiary("التكرار");
    const rx = await openPrescription(id);
    const sameKey = key();
    const [one, two] = await Promise.all([
      dispensePharmacyPrescriptionItems({ prescriptionId: rx, items: [{ sequence: 1, price: 10 }], idempotencyKey: sameKey }),
      dispensePharmacyPrescriptionItems({ prescriptionId: rx, items: [{ sequence: 1, price: 10 }], idempotencyKey: sameKey }),
    ]);
    expect([one, two].some((result) => !result.error)).toBe(true);
    expect(await prisma.pharmacyDispense.count({ where: { beneficiary_id: id } })).toBe(1);
  });
});
