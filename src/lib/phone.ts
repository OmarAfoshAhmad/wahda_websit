/** رقم هاتف ليبي محمول بصيغة موحدة 09XXXXXXXX (يقبل 2189… و+2189… و9… والمسافات)، أو null إن لم يكن صالحًا. */
export function normalizeLibyanMobile(input: string) {
  const digits = input.replace(/\D/g, "");
  const local = digits.startsWith("218") ? `0${digits.slice(3)}` : digits.startsWith("9") ? `0${digits}` : digits;
  return /^09[1-6]\d{7}$/.test(local) ? local : null;
}

/**
 * هاتف ليبي (بصيغة 09XXXXXXXX) أو دولي بصيغة +رمز الدولة والرقم (يُكتب بـ + أو 00، من 8 إلى 15 رقمًا).
 * الرقم الليبي المكتوب بـ +218 يبقى بالصيغة المحلية حتى يطابق الدخول بأي صيغة.
 */
export function normalizePhone(input: string) {
  const libyan = normalizeLibyanMobile(input);
  if (libyan) return libyan;
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/g, "");
  const international = trimmed.startsWith("+") ? digits : digits.startsWith("00") ? digits.slice(2) : null;
  if (!international || international.startsWith("218")) return null;
  return /^[1-9]\d{7,14}$/.test(international) ? `+${international}` : null;
}
