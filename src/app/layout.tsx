import type { Metadata, Viewport } from "next";
import { Tajawal } from "next/font/google";
import { ToastProvider } from "@/components/toast";
import { ThemeProvider } from "@/components/theme-provider";
import { validateEnv } from "@/lib/env";
import Script from "next/script";
import "./globals.css";

validateEnv();

const tajawal = Tajawal({
  subsets: ["arabic", "latin"],
  weight: ["300", "400", "500", "700", "800"],
  variable: "--font-tajawal",
});

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
      <head suppressHydrationWarning />
      <body className={`${tajawal.variable} ${tajawal.className}`} suppressHydrationWarning>
        <Script 
          id="pre-hydration-strip"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                const ATTR = 'bis_skin_checked';
                const removeAttr = (node) => {
                  if (!node) return;
                  if (node.hasAttribute && node.hasAttribute(ATTR)) node.removeAttribute(ATTR);
                  if (node.querySelectorAll) {
                    const nodes = node.querySelectorAll('[' + ATTR + ']');
                    for (let i = 0; i < nodes.length; i++) nodes[i].removeAttribute(ATTR);
                  }
                };
                removeAttr(document.documentElement);
                const observer = new MutationObserver((mutations) => {
                  for (let i = 0; i < mutations.length; i++) {
                    const m = mutations[i];
                    if (m.type === 'attributes') removeAttr(m.target);
                    if (m.addedNodes) {
                      for (let j = 0; j < m.addedNodes.length; j++) removeAttr(m.addedNodes[j]);
                    }
                  }
                });
                observer.observe(document.documentElement, { attributes: true, subtree: true, childList: true, attributeFilter: [ATTR] });
                window.addEventListener('DOMContentLoaded', () => removeAttr(document));
              })();
            `
          }}
        />
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <ToastProvider>
            {children}
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
