import { createContext, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';

export type AppColorTheme = 'default' | 'dark';

type ColorThemeContextValue = {
  theme: AppColorTheme;
  setTheme: (theme: AppColorTheme) => void;
};

const STORAGE_KEY = 'cung-lam:color-theme';
const ColorThemeContext = createContext<ColorThemeContextValue | null>(null);

function readStoredTheme(): AppColorTheme {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'default';
  } catch {
    return 'default';
  }
}

export function ColorThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<AppColorTheme>(readStoredTheme);

  useLayoutEffect(() => {
    document.documentElement.dataset.colorTheme = theme;
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Keep the selected theme for this session when browser storage is unavailable.
    }
  }, [theme]);

  const value = useMemo(() => ({ theme, setTheme }), [theme]);
  return <ColorThemeContext.Provider value={value}>{children}</ColorThemeContext.Provider>;
}

export function useColorTheme() {
  const value = useContext(ColorThemeContext);
  if (!value) throw new Error('useColorTheme outside ColorThemeProvider');
  return value;
}
