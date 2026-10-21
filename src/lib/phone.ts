/** رقم هاتف ليبي محمول بصيغة موحدة 09XXXXXXXX (يقبل 2189… و+2189… و9… والمسافات)، أو null إن لم يكن صالحًا. */
export function normalizeLibyanMobile(input: string) {
  const digits = input.replace(/\D/g, "");
  const local = digits.startsWith("218") ? `0${digits.slice(3)}` : digits.startsWith("9") ? `0${digits}` : digits;
  return /^09[1-6]\d{7}$/.test(local) ? local : null;
}
