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
  defaultTheme = "light",
  storageKey = "theme",
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useStore<Theme>(storageKey, defaultTheme);

  // One light theme: the dark one was removed (a stored «dark» choice of
  // earlier versions is ignored)
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove("dark");
    root.classList.add("light");
  }, []);

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
