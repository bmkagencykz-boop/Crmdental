import { useEffect } from "react";
import { useStore } from "ra-core";

import { ThemeProviderContext, type Theme } from "./theme-context";

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

/**
 * Theme provider that enables light, dark, and system theme modes.
 *
 * @internal
 */
export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "theme",
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useStore<Theme>(storageKey, defaultTheme);

  // Dental CRM has a single dark design (Katana reference): whatever the
  // stored preference, the page is dark
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove("light");
    root.classList.add("dark");
  }, [theme]);

  const value = {
    theme,
    setTheme,
  };

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}
