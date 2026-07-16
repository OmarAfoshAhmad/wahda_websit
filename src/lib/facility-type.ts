export const FACILITY_TYPES = [
  "HOSPITAL",
  "PHARMACY",
  "DENTAL_CLINIC",
  "PHYSIOTHERAPY_CENTER",
  "SPECIALTY_CLINIC",
  "OPTICAL_CENTER",
] as const;

export type FacilityType = typeof FACILITY_TYPES[number];

export function inferFacilityTypeFromText(name: string, username?: string): FacilityType {
  const text = `${name ?? ""} ${username ?? ""}`.toLowerCase();

  const pharmacyHints = ["صيدلية", "صيدليه", "pharmacy", "drugstore"];
  const dentalHints = ["اسنان", "أسنان", "dental", "dentist"];
  const physiotherapyHints = ["علاج طبيعي", "علاج طبيعى", "العلاج الطبيعي", "العلاج الطبيعى", "physiotherapy", "physical therapy"];
  const opticalHints = ["بصريات", "نظارات", "optical", "optics"];
  const specialtyHints = ["عيادة تخصصية", "عياده تخصصيه", "specialty clinic", "specialist clinic"];
  const hospitalHints = ["مستشفى", "مشفى", "hospital", "clinic", "medical", "health"];

  if (pharmacyHints.some((hint) => text.includes(hint))) {
    return "PHARMACY";
  }
  if (dentalHints.some((hint) => text.includes(hint))) return "DENTAL_CLINIC";
  if (physiotherapyHints.some((hint) => text.includes(hint))) return "PHYSIOTHERAPY_CENTER";
  if (opticalHints.some((hint) => text.includes(hint))) return "OPTICAL_CENTER";
  if (specialtyHints.some((hint) => text.includes(hint))) return "SPECIALTY_CLINIC";
  if (hospitalHints.some((hint) => text.includes(hint))) {
    return "HOSPITAL";
  }

  // Default to hospital when no clear signal is found.
  return "HOSPITAL";
}

export function normalizeFacilityTypeOverride(value: unknown): FacilityType | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  if ((FACILITY_TYPES as readonly string[]).includes(normalized)) return normalized as FacilityType;
  return null;
}

export function getFacilityTypeLabel(type: FacilityType): string {
  const labels: Record<FacilityType, string> = {
    HOSPITAL: "مستشفى",
    PHARMACY: "صيدلية",
    DENTAL_CLINIC: "عيادة أسنان",
    PHYSIOTHERAPY_CENTER: "مركز علاج طبيعي",
    SPECIALTY_CLINIC: "عيادة تخصصية",
    OPTICAL_CENTER: "مركز بصريات",
  };
  return labels[type];
}
