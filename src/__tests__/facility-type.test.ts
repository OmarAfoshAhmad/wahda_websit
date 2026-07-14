import { describe, expect, it } from "vitest";
import {
  getFacilityTypeLabel,
  inferFacilityTypeFromText,
  normalizeFacilityTypeOverride,
} from "@/lib/facility-type";
import { createFacilitySchema, updateFacilitySchema } from "@/lib/validation";

describe("PHYSIOTHERAPY facility type", () => {
  it("infers the type from an Arabic name or a pt username", () => {
    expect(inferFacilityTypeFromText("مركز العلاج الطبيعي")).toBe("PHYSIOTHERAPY");
    expect(inferFacilityTypeFromText("أكسجين", "oxygen_pt")).toBe("PHYSIOTHERAPY");
  });

  it("normalizes and labels an explicit override", () => {
    expect(normalizeFacilityTypeOverride("physiotherapy")).toBe("PHYSIOTHERAPY");
    expect(getFacilityTypeLabel("PHYSIOTHERAPY")).toBe("مركز علاج طبيعي");
  });

  it("accepts the type when creating or updating a facility", () => {
    expect(createFacilitySchema.safeParse({
      name: "أكسجين",
      username: "oxygen_pt",
      facility_type: "PHYSIOTHERAPY",
    }).success).toBe(true);

    expect(updateFacilitySchema.safeParse({
      id: "facility-1",
      name: "أكسجين",
      username: "oxygen_pt",
      facility_type: "PHYSIOTHERAPY",
    }).success).toBe(true);
  });
});
