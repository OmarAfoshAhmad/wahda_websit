"use client";

import { useEffect } from "react";

export function AutoPrint({ delay = 1200 }: { delay?: number }) {
  useEffect(() => {
    // التأكد من أننا لسنا داخل iframe (للخلفية)
    if (window.self === window.top) {
      const timer = setTimeout(() => {
        window.print();
      }, delay);
      return () => clearTimeout(timer);
    }
  }, [delay]);

  return null;
}
