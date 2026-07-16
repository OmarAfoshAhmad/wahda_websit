import { describe, expect, it } from "vitest";
import { classifyLegacyReplacement, type LegacyResolutionPerson } from "@/lib/legacy-card-resolution";

const legacy: LegacyResolutionPerson = {
  id: "old",
  name: "محمد  علي",
  cardNumber: "WAB2025123",
  birthDate: "1990-01-02T00:00:00.000Z",
  createdAt: "2025-01-01T00:00:00.000Z",
};

function candidate(overrides: Partial<LegacyResolutionPerson> = {}): LegacyResolutionPerson {
  return {
    id: "new",
    name: "محمد علي",
    cardNumber: "WAB2025999",
    birthDate: "1990-01-02T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    registryConfirmed: true,
    ...overrides,
  };
}

describe("classifyLegacyReplacement", () => {
  it("يقبل تطابق الاسم والميلاد مع تأكيد سجل الإصدار", () => {
    const result = classifyLegacyReplacement(legacy, [candidate()]);
    expect(result.kind).toBe("SAFE");
    expect(result.replacement?.id).toBe("new");
  });

  it("يعتمد السجل الأحدث الوحيد عند تطابق هوية الاسم حتى دون سجل رسمي", () => {
    const result = classifyLegacyReplacement(legacy, [candidate({ registryConfirmed: false })]);
    expect(result.kind).toBe("SAFE");
    expect(result.replacement?.id).toBe("new");
  });

  it("يرفض تعارض تاريخ الميلاد", () => {
    const result = classifyLegacyReplacement(legacy, [candidate({ birthDate: "1991-01-02T00:00:00.000Z" })]);
    expect(result.kind).toBe("NONE");
  });

  it("يقبل اختلاف الأصفار لنفس البطاقة عند غياب الميلاد", () => {
    const result = classifyLegacyReplacement(
      { ...legacy, birthDate: null },
      [candidate({ birthDate: null, cardNumber: "WAB2025000123" })],
    );
    expect(result.kind).toBe("SAFE");
  });

  it("يقبل اختلاف الأصفار حتى مع اختلاف فصل كلمات الاسم", () => {
    const result = classifyLegacyReplacement(
      { ...legacy, name: "معمر مفتاح ابو بكر ابو عون", cardNumber: "WAB202511546", birthDate: null },
      [candidate({ name: "معمر مفتاح ابوبكر ابوعون", cardNumber: "WAB2025011546", birthDate: null, registryConfirmed: false })],
    );
    expect(result.kind).toBe("SAFE");
  });

  it("يعتبر هوية الاسم مع سجل أحدث وحيد بديلاً آمناً وفق سياسة البطاقات القديمة", () => {
    const result = classifyLegacyReplacement(
      { ...legacy, birthDate: null },
      [candidate({ birthDate: null })],
    );
    expect(result.kind).toBe("SAFE");
  });

  it("لا يختار تلقائياً عند تعدد البدائل القوية", () => {
    const result = classifyLegacyReplacement(legacy, [candidate(), candidate({ id: "new-2", cardNumber: "WAB2025888" })]);
    expect(result.kind).toBe("REVIEW");
    expect(result.replacement).toBeNull();
  });
});
