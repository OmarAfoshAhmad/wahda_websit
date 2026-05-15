import prisma from "@/lib/prisma";

export async function getSystemSetting(key: string, defaultValue: string = "") {
  try {
    const setting = await prisma.systemSetting.findUnique({ where: { key } });
    return setting ? setting.value : defaultValue;
  } catch (err) {
    console.warn(`[getSystemSetting] failed to fetch key ${key}. Returning default. Error:`, err);
    return defaultValue;
  }
}

export async function setSystemSetting(key: string, value: string, description?: string) {
  return prisma.systemSetting.upsert({
    where: { key },
    update: { value, description },
    create: { key, value, description },
  });
}

export async function getOtpSettings() {
  const [provider, apiKey, senderId, apiUrl, otpLength, otpExpiry, facilityName] = await Promise.all([
    getSystemSetting("OTP_PROVIDER", "MOCK"),
    getSystemSetting("OTP_API_KEY", ""),
    getSystemSetting("OTP_SENDER_ID", "WAHA"),
    getSystemSetting("OTP_API_URL", ""),
    getSystemSetting("OTP_LENGTH", "6"),
    getSystemSetting("OTP_EXPIRY_MINUTES", "5"),
    getSystemSetting("FACILITY_NAME", "وعد للرعاية الصحية"),
  ]);

  return { 
    provider, 
    apiKey, 
    senderId, 
    apiUrl, 
    otpLength: parseInt(otpLength, 10) || 6,
    otpExpiry: parseInt(otpExpiry, 10) || 5,
    facilityName
  };
}
