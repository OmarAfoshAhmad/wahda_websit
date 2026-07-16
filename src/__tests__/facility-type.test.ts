import { describe, expect, it } from "vitest";
import { getFacilityTypeLabel, inferFacilityTypeFromText, normalizeFacilityTypeOverride } from "@/lib/facility-type";

describe("facility types", () => {
  it.each([
    ["صيدلية الشفاء", "PHARMACY"],
    ["عيادة أسنان الواحة", "DENTAL_CLINIC"],
    ["مركز العلاج الطبيعي", "PHYSIOTHERAPY_CENTER"],
    ["عيادة تخصصية للقلب", "SPECIALTY_CLINIC"],
    ["مركز النور للبصريات", "OPTICAL_CENTER"],
    ["مستشفى الوحدة", "HOSPITAL"],
  ] as const)("infers %s", (name, expected) => {
    expect(inferFacilityTypeFromText(name)).toBe(expected);
  });

  it("accepts every persisted override", () => {
    expect(normalizeFacilityTypeOverride("DENTAL_CLINIC")).toBe("DENTAL_CLINIC");
    expect(getFacilityTypeLabel("OPTICAL_CENTER")).toBe("مركز بصريات");
  });
});
