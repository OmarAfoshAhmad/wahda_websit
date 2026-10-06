// تحديد موقع المستخدم في المتصفح: دقة عالية (GPS) لفترة قصيرة، ثم دقة عادية (شبكة/WiFi) إن فشلت.
// أجهزة الكمبيوتر بلا GPS تنتهي فيها مهلة الدقة العالية كثيرًا، فالمحاولة الثانية هي ما ينجح عادة.
export type GeoPoint = { latitude: number; longitude: number };

function attempt(options: PositionOptions) {
  return new Promise<GeoPoint>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
      reject,
      options,
    );
  });
}

export async function getCurrentLocation(): Promise<GeoPoint> {
  if (typeof navigator === "undefined" || !navigator.geolocation) throw new Error("المتصفح لا يدعم تحديد الموقع");
  // المتصفحات تمنع الموقع على العناوين غير الآمنة (مثل http://192.168.x.x) وتردّه كرفض إذن.
  if (typeof window !== "undefined" && !window.isSecureContext) {
    throw new Error("تحديد الموقع يحتاج اتصالًا آمنًا: افتح المنظومة عبر https أو localhost");
  }
  try {
    return await attempt({ enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
  } catch (error) {
    // رفض الإذن لا تُفيد معه إعادة المحاولة. على Windows يأتي الرفض أيضًا إن كانت خدمة الموقع في الجهاز مغلقة.
    if ((error as GeolocationPositionError)?.code === 1) {
      throw new Error("الموقع مرفوض: اسمح به للموقع من المتصفح، وتأكد أن خدمة الموقع مفعّلة في الجهاز (Windows: الإعدادات ← الخصوصية والأمان ← الموقع)");
    }
    try {
      return await attempt({ enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 });
    } catch {
      throw new Error("تعذر تحديد موقعك الآن. تأكد من تشغيل خدمة الموقع في الجهاز ثم أعد المحاولة");
    }
  }
}
