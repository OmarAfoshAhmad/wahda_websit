export type FacilityType = "HOSPITAL" | "PHARMACY" | "DENTAL" | "OPTICS" | "PHYSIOTHERAPY" | "EQUESTRIAN";

export function inferFacilityTypeFromText(name: string, username?: string): FacilityType {
  const text = `${name ?? ""} ${username ?? ""}`.toLowerCase();

  const pharmacyHints = ["صيدلية", "صيدليه", "pharmacy", "drugstore"];
  const dentalHints = ["أسنان", "اسنان", "dental", "dentist", "tooth"];
  const opticsHints = ["بصريات", "عيون", "نظارات", "optics", "optician", "eye"];
  const physiotherapyHints = ["علاج طبيعي", "العلاج الطبيعي", "تأهيل حركي", "physiotherapy", "physical therapy", "physio"];
  const equestrianHints = ["فروسية", "الفروسية", "خيل", "خيول", "equestrian", "horse", "horses"];
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
  if (physiotherapyHints.some((hint) => text.includes(hint)) || /(^|_)pt($|_)/.test(text)) {
    return "PHYSIOTHERAPY";
  }
  if (equestrianHints.some((hint) => text.includes(hint))) {
    return "EQUESTRIAN";
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
    normalized === "OPTICS" ||
    normalized === "PHYSIOTHERAPY" ||
    normalized === "EQUESTRIAN"
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
    case "PHYSIOTHERAPY":
      return "مركز علاج طبيعي";
    case "EQUESTRIAN":
      return "الفروسية";
    default:
      return "مشفى / عيادة عامة";
  }
}
