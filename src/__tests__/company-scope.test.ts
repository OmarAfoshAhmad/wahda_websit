import { describe, expect, it } from "vitest";
import { resolveAllowedScope, ScopeAccessError } from "@/lib/company-scope";

describe("resolveAllowedScope", () => {
  it("deduplicates the server-derived allowed scope", () => {
    expect(resolveAllowedScope(["company-a", "company-a", "company-b"])).toEqual({
      allowedIds: ["company-a", "company-b"],
    });
  });

  it("narrows an allowed requested company", () => {
    expect(resolveAllowedScope(["company-a", "company-b"], "company-b")).toEqual({
      selectedId: "company-b",
      allowedIds: ["company-b"],
    });
  });

  it("rejects a requested company outside the server-derived scope", () => {
    expect(() => resolveAllowedScope(["company-a"], "company-b")).toThrow(ScopeAccessError);
  });

  it("rejects accounts with no delegated scope", () => {
    expect(() => resolveAllowedScope([], null)).toThrow("لا يوجد نطاق مفوض");
  });
});
