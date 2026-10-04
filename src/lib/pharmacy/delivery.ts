// حسابات التوصيل وساعات العمل. قيمة التوصيل خارج التأمين: يحددها المرفق ويدفعها المستفيد باختياره.

const EARTH_RADIUS_KM = 6371;
const TRIPOLI_OFFSET_MINUTES = 120;

/** المسافة بخط مستقيم بين نقطتين (كم). تقدير كافٍ لتسعير التوصيل داخل المدينة. */
export function distanceKm(from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }) {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = rad(to.latitude - from.latitude);
  const dLon = rad(to.longitude - from.longitude);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(from.latitude)) * Math.cos(rad(to.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

export type DeliverySettings = { enabled: boolean; baseFee: number; perKm: number; maxKm: number | null };

/**
 * قيمة التوصيل = الأساس + (سعر الكم × المسافة)، مقربة لأقرب ربع دينار.
 * تعيد null إن كان التوصيل غير متاح أو المسافة خارج النطاق أو الموقع غير معروف.
 */
export function deliveryQuote(settings: DeliverySettings, distance: number | null) {
  if (!settings.enabled) return { available: false as const, reason: "لا توفر هذه الصيدلية التوصيل" };
  if (settings.perKm > 0 && distance === null) return { available: false as const, reason: "حدد موقعك لحساب قيمة التوصيل" };
  if (settings.maxKm !== null && distance !== null && distance > settings.maxKm) return { available: false as const, reason: `خارج نطاق التوصيل (${settings.maxKm} كم)` };
  const raw = settings.baseFee + settings.perKm * (distance ?? 0);
  return { available: true as const, fee: Math.ceil(raw * 4) / 4 };
}

const toMinutes = (value: string) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours > 24 || minutes > 59 ? null : hours * 60 + minutes;
};

export function isValidTime(value: string) {
  return toMinutes(value) !== null;
}

/** هل الصيدلية مفتوحة الآن بتوقيت طرابلس؟ يدعم الدوام الذي يتجاوز منتصف الليل (مثل 18:00 → 02:00). بلا ساعات = مفتوحة. */
export function isOpenNow(opensAt: string | null, closesAt: string | null, now = new Date()) {
  if (!opensAt || !closesAt) return true;
  const open = toMinutes(opensAt);
  const close = toMinutes(closesAt);
  if (open === null || close === null || open === close) return true;
  const current = (now.getUTCHours() * 60 + now.getUTCMinutes() + TRIPOLI_OFFSET_MINUTES) % 1440;
  return open < close ? current >= open && current < close : current >= open || current < close;
}
