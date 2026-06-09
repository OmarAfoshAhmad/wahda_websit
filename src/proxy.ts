import { NextRequest, NextResponse } from "next/server";
import { decrypt, encrypt } from "@/lib/auth";
import { jwtVerify } from "jose";
import type { Session } from "@/lib/permissions";

const publicRoutes = ["/login", "/api/login", "/manifest.json", "/manifest.webmanifest", "/site.webmanifest", "/favicon.ico"];
const beneficiaryPublicRoutes = ["/beneficiary/login", "/beneficiary/setup-pin"];
const publicPrefixes = ["/check", "/icons"];

/**
 * مسارات API عامة لا تتطلب مصادقة (تسجيل دخول المستفيد، OTP، إلخ)
 * هذه المسارات تتحقق من الجلسة داخلياً حسب الحاجة.
 */
const publicApiRoutes = [
  "/api/beneficiary/auth",
  "/api/beneficiary/auth/request-otp",
  "/api/beneficiary/auth/verify-otp",
  "/api/beneficiary/setup-pin",
  "/api/health",
];

/**
 * Proxy خفيف — يفحص JWT فقط ولا يستعلم من قاعدة البيانات.
 * فحص حالة الحذف الناعم يتم عبر session-guard.ts في العمليات الحساسة.
 */
export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const method = req.method;
  const isApiRoute = path.startsWith("/api");
  const isPublicApiRoute = publicApiRoutes.includes(path);

  // ── CSRF Protection (SEC-01: Anti-CSRF) ─────────────────
  // يُطبَّق فقط على الطلبات المعدِّلة (POST/PUT/DELETE/PATCH)
  if (["POST", "PUT", "DELETE", "PATCH"].includes(method)) {
    const origin = req.headers.get("origin");
    const host = req.headers.get("host");
    if (origin && host) {
      try {
        const originHost = new URL(origin).host;
        if (originHost !== host) {
          return new NextResponse(JSON.stringify({ error: "CSRF Attack Detected: Origin Mismatch" }), { 
            status: 403,
            headers: { "Content-Type": "application/json" }
          });
        }
      } catch {
        return new NextResponse(JSON.stringify({ error: "Invalid Origin Header" }), { status: 400 });
      }
    } else if (!origin && !req.headers.get("sec-fetch-site")) {
      // Fallback: لا يوجد Origin ولا Sec-Fetch-Site
      // المسارات العامة (login, OTP) لا تحتاج session cookie
      if (!isPublicApiRoute) {
        const csrfCookie = req.cookies.get("session")?.value;
        if (!csrfCookie) {
          return new NextResponse(JSON.stringify({ error: "CSRF protection: missing origin and session" }), {
            status: 403,
            headers: { "Content-Type": "application/json" }
          });
        }
      }
    }
  }

  const isPublicRoute =
    publicRoutes.includes(path) || publicPrefixes.some((p) => path === p || path.startsWith(p + "/"));

  const cookie = req.cookies.get("session")?.value;
  let session: Session | null = null;

  if (cookie) {
    try {
      session = await decrypt(cookie) as unknown as Session;
    } catch {
      // Invalid session cookie
    }
  }

  // مسارات المستفيد — جلسة مختلفة (ben_session)
  if (path.startsWith("/beneficiary")) {
    if (beneficiaryPublicRoutes.includes(path)) {
      return NextResponse.next();
    }
    const benCookie = req.cookies.get("ben_session")?.value;
    if (!benCookie) {
      return NextResponse.redirect(new URL("/beneficiary/login", req.nextUrl));
    }
    try {
      const secret = process.env.BENEFICIARY_JWT_SECRET || process.env.JWT_SECRET;
      if (!secret) throw new Error("JWT_SECRET not set");
      const key = new TextEncoder().encode(secret);
      const { payload } = await jwtVerify(benCookie, key, { algorithms: ["HS256"] });
      if (payload.type !== "beneficiary") throw new Error();
    } catch {
      return NextResponse.redirect(new URL("/beneficiary/login", req.nextUrl));
    }
    return NextResponse.next();
  }

  // مسارات API — لا نعيد توجيهها لصفحة تسجيل الدخول
  // كل API route يتحقق من المصادقة داخلياً عبر requireActiveFacilitySession أو getBeneficiarySession
  if (isApiRoute) {
    return NextResponse.next();
  }

  // حماية مسارات الصفحات للمرافق الصحية
  if (!isPublicRoute && !session) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }

  // المسارات التي تبقى عامة حتى للمسجّلين (مثل health checks)
  const alwaysPublic = publicPrefixes.some((p) => path === p || path.startsWith(p + "/"));

  if (isPublicRoute && session && !alwaysPublic) {
    if (session.must_change_password) {
      return NextResponse.redirect(new URL("/change-password", req.nextUrl));
    }
    return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
  }

  // إجبار تغيير كلمة المرور قبل أي صفحة أخرى
  if (session?.must_change_password && path !== "/change-password") {
    return NextResponse.redirect(new URL("/change-password", req.nextUrl));
  }

  // ملاحظة: تم إزالة المنع من الوصول لصفحة /change-password في الميدل وير
  // لأن الـ JWT قد يكون قديماً (stale) بينما قاعدة البيانات تطلب تغيير الكلمة،
  // مما يسبب دوامة إعادة توجيه (Infinite Redirect Loop).
  // صفحة /change-password نفسها ستتحقق من قاعدة البيانات وتوجه المستخدم.

  // ملاحظة: صلاحيات /admin تُفحَص داخل الصفحات نفسها عبر getSessionWithFreshPermissions.
  // منع /admin هنا اعتماداً على JWT فقط قد يحجب المديرين بسبب بيانات جلسة قديمة (stale JWT).

  // تجديد الجلسة (sliding window) مع الحفاظ على جميع حقول الجلسة
  // نمنعها في طلبات POST (Server Actions) لأن تعديل الكوكيز في الميدل وير وتعديلها في الأكشن في نفس الوقت
  // يسبب خطأ "An unexpected response was received from the server."
  if (cookie && session && req.method !== "POST") {
    try {
      const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
      
      // إزالة حقول JWT القياسية من الجلسة القديمة لتجنب تعارضها مع دالة التشفير التي تعيد تعيينها
      const { exp, iat, jti, nbf, ...cleanSession } = session as any;
      
      const refreshed = await encrypt(cleanSession);
      
      const res = NextResponse.next();
      res.cookies.set({
        name: "session",
        value: refreshed,
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
        expires,
      });
      return res;
    } catch (err) {
      console.error("PROXY_SESSION_REFRESH_ERROR", err);
      // إذا فشل التجديد، نمرر الطلب بدلاً من انهيار الميدل وير
      return NextResponse.next();
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|manifest\\.json|manifest\\.webmanifest|site\\.webmanifest|.*\\.png$|.*\\.svg$|.*\\.jpg$|.*\\.jpeg$|.*\\.webp$|.*\\.ico$|.*\\.css$|.*\\.js$).*)",
  ],
};
