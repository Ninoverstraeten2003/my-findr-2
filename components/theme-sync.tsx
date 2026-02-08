"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";
import { useSettings } from "@/lib/use-settings";

export function ThemeSync() {
  const { setTheme } = useTheme();
  const [settings] = useSettings();

  useEffect(() => {
    if (settings.appTheme) {
      setTheme(settings.appTheme);
    }
  }, [settings.appTheme, setTheme]);

  return null;
}
