export type FacilityType = "HOSPITAL" | "PHARMACY";

export function inferFacilityTypeFromText(name: string, username?: string): FacilityType {
  const text = `${name ?? ""} ${username ?? ""}`.toLowerCase();

  const pharmacyHints = ["صيدلية", "صيدليه", "pharmacy", "drugstore"];
  const hospitalHints = ["مستشفى", "مشفى", "hospital", "clinic", "medical", "health"];

  if (pharmacyHints.some((hint) => text.includes(hint))) {
    return "PHARMACY";
  }
  if (hospitalHints.some((hint) => text.includes(hint))) {
    return "HOSPITAL";
  }

  // Default to hospital when no clear signal is found.
  return "HOSPITAL";
}

export function normalizeFacilityTypeOverride(value: unknown): FacilityType | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === "HOSPITAL" || normalized === "PHARMACY") {
    return normalized;
  }
  return null;
}

export function getFacilityTypeLabel(type: FacilityType): string {
  return type === "PHARMACY" ? "صيدلية" : "مشفى";
}
