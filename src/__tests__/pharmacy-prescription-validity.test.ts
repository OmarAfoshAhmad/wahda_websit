import { describe, expect, it } from "vitest";
import { isPrescriptionValidToday } from "@/lib/pharmacy/policy";

// طرابلس UTC+2: منتصف الليل المحلي = 22:00 UTC من اليوم السابق.
describe("صلاحية الوصفة ليوم إصدارها", () => {
  const now = new Date("2026-10-19T10:00:00Z"); // 12:00 ظهرًا في طرابلس

  it("وصفة اليوم صالحة", () => {
    expect(isPrescriptionValidToday(new Date("2026-10-18T22:00:00Z"), now)).toBe(true); // 00:00 محليًا
    expect(isPrescriptionValidToday(new Date("2026-10-19T09:59:00Z"), now)).toBe(true);
  });

  it("وصفة الأمس منتهية ولو قبل منتصف الليل بدقيقة", () => {
    expect(isPrescriptionValidToday(new Date("2026-10-18T21:59:00Z"), now)).toBe(false); // 23:59 محليًا أمس
  });

  it("تنتهي عند منتصف الليل بتوقيت طرابلس لا UTC", () => {
    const created = new Date("2026-10-19T20:00:00Z"); // 22:00 محليًا
    expect(isPrescriptionValidToday(created, new Date("2026-10-19T21:30:00Z"))).toBe(true); // 23:30 محليًا
    expect(isPrescriptionValidToday(created, new Date("2026-10-19T22:30:00Z"))).toBe(false); // 00:30 اليوم التالي
  });
});
