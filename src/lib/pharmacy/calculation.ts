import { Prisma } from "@prisma/client";

export type MoneyInput = Prisma.Decimal | string | number;
export type SequenceCoverageRule = { from: number; to: number | null; coveragePercent: MoneyInput };
export type PharmacyPriceInput = { sequence: number; price: MoneyInput; drugId?: string | null };
export type PharmacyCalculationInput = {
  items: PharmacyPriceInput[];
  defaultCoveragePercent: MoneyInput;
  sequenceRules?: SequenceCoverageRule[] | null;
  ceilingAmount: MoneyInput | null;
  consumedBefore: MoneyInput;
  /** GROSS: السقف يُستهلك بإجمالي سعر البند المغطى. COMPANY_SHARE: بحصة الشركة فقط. */
  ceilingBasis?: "GROSS" | "COMPANY_SHARE";
  /** سقوف إضافية تُطبَّق معًا (مثل السقف العام فوق سقف الفئة)؛ المتاح هو الأصغر بينها. */
  additionalCeilings?: Array<{ ceilingAmount: MoneyInput | null; consumedBefore: MoneyInput }>;
};

const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);
const money = (value: MoneyInput) => new Prisma.Decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

function percentage(value: MoneyInput) {
  const parsed = new Prisma.Decimal(value);
  if (parsed.lt(0) || parsed.gt(100)) throw new Error("نسبة التغطية يجب أن تكون بين 0 و100");
  return parsed;
}

export function calculatePharmacyDispense(input: PharmacyCalculationInput) {
  const fallback = percentage(input.defaultCoveragePercent);
  const rules = input.sequenceRules ?? [];
  const consumedBefore = money(input.consumedBefore);
  const basis = input.ceilingBasis ?? "COMPANY_SHARE";
  const remainingOf = (amount: MoneyInput | null, consumed: MoneyInput) =>
    amount === null ? null : Prisma.Decimal.max(ZERO, money(amount).minus(money(consumed)));
  const remainings = [remainingOf(input.ceilingAmount, input.consumedBefore), ...(input.additionalCeilings ?? []).map((extra) => remainingOf(extra.ceilingAmount, extra.consumedBefore))]
    .filter((value): value is Prisma.Decimal => value !== null);
  const initialAvailable = remainings.length === 0 ? null : Prisma.Decimal.min(...remainings);
  let available = initialAvailable;
  let ceilingConsumption = ZERO;

  const items = input.items.filter((item) => money(item.price).gt(0)).sort((a, b) => a.sequence - b.sequence).map((item) => {
    const price = money(item.price);
    const rule = rules.find((candidate) => item.sequence >= candidate.from && (candidate.to === null || item.sequence <= candidate.to));
    const coveragePercent = rule ? percentage(rule.coveragePercent) : fallback;
    const coveredBeforeCeiling = price.mul(coveragePercent).div(HUNDRED).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    let companyShare: Prisma.Decimal;
    if (basis === "GROSS") {
      const coveredGross = available === null ? price : Prisma.Decimal.min(price, available);
      companyShare = coveredGross.mul(coveragePercent).div(HUNDRED).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      ceilingConsumption = ceilingConsumption.plus(coveredGross);
      if (available !== null) available = available.minus(coveredGross);
    } else {
      companyShare = available === null ? coveredBeforeCeiling : Prisma.Decimal.min(coveredBeforeCeiling, available);
      ceilingConsumption = ceilingConsumption.plus(companyShare);
      if (available !== null) available = available.minus(companyShare);
    }
    return { sequence: item.sequence, drugId: item.drugId ?? null, price, coveragePercent, companyShare, patientShare: price.minus(companyShare) };
  });

  const sum = (values: Prisma.Decimal[]) => values.reduce((total, value) => total.plus(value), ZERO);
  const grossTotal = sum(items.map((item) => item.price));
  const companyTotal = sum(items.map((item) => item.companyShare));
  const patientTotal = sum(items.map((item) => item.patientShare));
  return {
    items,
    itemCount: items.length,
    grossTotal,
    companyTotal,
    patientTotal,
    ceilingConsumption,
    consumedBefore,
    consumedAfter: consumedBefore.plus(ceilingConsumption),
    remainingBefore: initialAvailable,
    remainingAfter: available,
  };
}

export function getPharmacyPolicyWindow(referenceDate: Date, frequencyMonths: number) {
  if (!Number.isInteger(frequencyMonths) || frequencyMonths < 1 || frequencyMonths > 12) {
    throw new Error("دورة تجديد الصيدلية يجب أن تكون بين شهر و12 شهرًا");
  }
  const year = referenceDate.getUTCFullYear();
  const month = referenceDate.getUTCMonth();
  const startMonth = Math.floor(month / frequencyMonths) * frequencyMonths;
  return {
    start: new Date(Date.UTC(year, startMonth, 1)),
    end: new Date(Date.UTC(year, startMonth + frequencyMonths, 1)),
  };
}
