import type { Metadata, Viewport } from "next";
// استيراد الخط من Google Fonts عبر ملف CSS بدلاً من next/font لتجنب فشل البناء إذا كان الاتصال ضعيفاً
// import { Tajawal } from "next/font/google";
// const tajawal = Tajawal({ ... });
import { ToastProvider } from "@/components/toast";
import { ThemeProvider } from "@/components/theme-provider";
import { validateEnv } from "@/lib/env";
import "./globals.css";

validateEnv();

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#1f4e8c" },
    { media: "(prefers-color-scheme: dark)", color: "#0f172a" },
  ],
};

export const metadata: Metadata = {
  title: "وعد للرعاية الصحية",
  description: "نظام إدارة المستفيدين الصحيين — شركة وعد للرعاية الصحية",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head suppressHydrationWarning>
        {/* إزالة attribute bis_skin_checked الذي تضيفه إضافات المتصفح ويسبب hydration mismatch — لا يحتوي على مدخلات مستخدم */}
        <script
          id="pre-hydration-strip"
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `(function(){const a='bis_skin_checked',r=n=>{n&&(n.hasAttribute&&n.hasAttribute(a)&&n.removeAttribute(a),n.querySelectorAll&&n.querySelectorAll('['+a+']').forEach(e=>e.removeAttribute(a)))};r(document.documentElement);const o=new MutationObserver(m=>{m.forEach(m=>{m.type==='attributes'&&r(m.target),m.addedNodes&&m.addedNodes.forEach(r)})});o.observe(document.documentElement,{attributes:!0,subtree:!0,childList:!0,attributeFilter:[a]}),window.addEventListener('DOMContentLoaded',()=>r(document))})();`
          }}
        />
      </head>
      <body className="font-sans" suppressHydrationWarning>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <ToastProvider>
            {children}
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
