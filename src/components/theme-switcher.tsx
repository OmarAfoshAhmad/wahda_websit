"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui";

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  // لمنع mismatch بين server و client
  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <Button variant="outline" className="h-9 w-9 p-0 opacity-0">
        <Sun className="h-4 w-4" />
      </Button>
    );
  }

  const toggleTheme = () => {
    setTheme(theme === "dark" ? "light" : "dark");
  };

  return (
    <Button
      variant="outline"
      className="h-9 w-9 p-0 bg-white text-slate-700 transition-colors hover:bg-slate-100 hover:text-primary dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-primary-light"
      onClick={toggleTheme}
      title={theme === "dark" ? "التبديل للوضع الفاتح" : "التبديل للوضع المظلم"}
    >
      {theme === "dark" ? (
        <Sun className="h-4 w-4" />
      ) : (
        <Moon className="h-4 w-4" />
      )}
      <span className="sr-only">تغيير المظهر</span>
    </Button>
  );
}
