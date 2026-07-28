import { describe, expect, it } from "vitest";
import { parseImportBirthDate } from "@/lib/import-jobs";
import { isEmployeeRelationship, isSpouseRelationship, relationshipToChildCode, shouldTreatAsSoleEmployee, stripCardMemberSuffix } from "@/lib/import-demographic-evidence";

describe("demographic card repair rules", () => {
  it("keeps numbered H cards unchanged by the plain-H completion rule", () => {
    expect("JFZ202532633H1").toMatch(/H\d+$/);
    expect("JFZ202532633H2").toMatch(/H\d+$/);
  });

  it("maps explicit daughter evidence to S and son evidence to D", () => {
    expect(relationshipToChildCode("ابنة")).toBe("D");
    expect(relationshipToChildCode("بنت")).toBe("D");
    expect(relationshipToChildCode("ابن")).toBe("S");
    expect(relationshipToChildCode("ذكر")).toBe("S");
  });

  it("does not guess gender from an unknown relationship", () => {
    expect(relationshipToChildCode("تابع")).toBeNull();
    expect(relationshipToChildCode("")).toBeNull();
  });

  it("removes the suffix from an explicitly identified employee", () => {
    expect(isEmployeeRelationship("موظف")).toBe(true);
    expect(isEmployeeRelationship("موظفة")).toBe(true);
    expect(isEmployeeRelationship("رب الأسرة")).toBe(true);
    expect(stripCardMemberSuffix("JFZ20255247H1")).toBe("JFZ20255247");
  });

  it("does not confuse an employee with a spouse", () => {
    expect(isSpouseRelationship("زوجة")).toBe(true);
    expect(isSpouseRelationship("موظف")).toBe(false);
  });

  it("treats a lone card without dependent evidence as the base employee", () => {
    expect(shouldTreatAsSoleEmployee(1, undefined)).toBe(true);
    expect(shouldTreatAsSoleEmployee(2, undefined)).toBe(false);
    expect(shouldTreatAsSoleEmployee(1, { isEmployee: false, spouseCode: "H", childCode: null })).toBe(false);
  });

  it("parses Excel, DMY and ISO birth dates and rejects impossible dates", () => {
    expect(parseImportBirthDate("01/04/2026")?.toISOString().slice(0, 10)).toBe("2026-04-01");
    expect(parseImportBirthDate("2026-06-21")?.toISOString().slice(0, 10)).toBe("2026-06-21");
    expect(parseImportBirthDate(46023)).not.toBeNull();
    expect(parseImportBirthDate("31/02/2026")).toBeNull();
  });
});
