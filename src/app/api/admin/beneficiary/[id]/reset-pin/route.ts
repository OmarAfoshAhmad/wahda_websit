import { NextRequest, NextResponse } from "next/server";

/**
 * تم إلغاء هذا الرابط لأن النظام الجديد يعتمد على OTP المرسل للهاتف.
 * لا حاجة لإعادة تعيين الرموز يدوياً بعد الآن.
 */
export async function POST() {
  return NextResponse.json({ 
    error: "تم إلغاء نظام الـ PIN القديم. يرجى استخدام نظام التحقق عبر الهاتف (OTP)." 
  }, { status: 410 });
}
