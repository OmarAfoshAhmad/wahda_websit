// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildChronicImportTemplate, normalizeDrugName, parseChronicImportWorkbook } from "@/lib/pharmacy/chronic-import";

describe("chronic drug import file", () => {
  it("reads the template rows and folds dose, frequency and notes into notes", async () => {
    const parsed = await parseChronicImportWorkbook(await buildChronicImportTemplate());
    expect("rows" in parsed).toBe(true);
    if (!("rows" in parsed)) return;
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toMatchObject({ rowNumber: 2, beneficiaryName: "محمد علي أحمد", drugName: "Metformin", notes: "500mg | 1*2 | بعد الأكل" });
    expect(parsed.rows[1].notes).toBe("5mg | 1*1");
  });

  it("normalizes drug names so spelling variants map to one catalog entry", () => {
    expect(normalizeDrugName("  Concor   5MG ")).toBe(normalizeDrugName("concor 5mg"));
  });
});
