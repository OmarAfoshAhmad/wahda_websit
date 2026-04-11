import type { Metadata, Viewport } from "next";
import { Tajawal } from "next/font/google";
import { ToastProvider } from "@/components/toast";
import { ThemeProvider } from "@/components/theme-provider";
import { validateEnv } from "@/lib/env";
import "./globals.css";

validateEnv();

const tajawal = Tajawal({
  subsets: ["arabic", "latin"],
  weight: ["300", "400", "500", "700", "800"],
  variable: "--font-tajawal",
});

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#1f4e8c" },
    { media: "(prefers-color-scheme: dark)", color: "#0f172a" },
  ],
};

export const metadata: Metadata = {
  title: "Waha Health Care",
  description: "نظام إدارة المستفيدين الصحيين — شركة الواحة للرعاية الصحية",
  manifest: "/manifest.json",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body className={`${tajawal.variable} ${tajawal.className}`} suppressHydrationWarning>
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var clean=function(){var nodes=document.querySelectorAll('[bis_skin_checked]');for(var i=0;i<nodes.length;i++){nodes[i].removeAttribute('bis_skin_checked');}};clean();setTimeout(clean,0);setTimeout(clean,50);}catch(_e){}})();`,
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
