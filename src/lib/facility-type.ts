export type FacilityType = "HOSPITAL" | "PHARMACY" | "DENTAL" | "OPTICS";

export function inferFacilityTypeFromText(name: string, username?: string): FacilityType {
  const text = `${name ?? ""} ${username ?? ""}`.toLowerCase();

  const pharmacyHints = ["صيدلية", "صيدليه", "pharmacy", "drugstore"];
  const dentalHints = ["أسنان", "اسنان", "dental", "dentist", "tooth"];
  const opticsHints = ["بصريات", "عيون", "نظارات", "optics", "optician", "eye"];
  const hospitalHints = ["مستشفى", "مشفى", "hospital", "clinic", "medical", "health"];

  if (pharmacyHints.some((hint) => text.includes(hint))) {
    return "PHARMACY";
  }
  if (dentalHints.some((hint) => text.includes(hint))) {
    return "DENTAL";
  }
  if (opticsHints.some((hint) => text.includes(hint))) {
    return "OPTICS";
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
  if (
    normalized === "HOSPITAL" ||
    normalized === "PHARMACY" ||
    normalized === "DENTAL" ||
    normalized === "OPTICS"
  ) {
    return normalized as FacilityType;
  }
  return null;
}

export function getFacilityTypeLabel(type: FacilityType): string {
  switch (type) {
    case "PHARMACY":
      return "صيدلية";
    case "DENTAL":
      return "عيادة أسنان";
    case "OPTICS":
      return "مركز بصريات / عيون";
    default:
      return "مشفى / عيادة عامة";
  }
}
