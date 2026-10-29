import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { PALETTE_TOKENS, type PaletteColors, type PaletteToken } from '@/components/color-palette-controls';

export type AppColorTheme = 'default' | 'dark';

type ColorThemeContextValue = {
  theme: AppColorTheme;
  setTheme: (theme: AppColorTheme) => void;
  colors: PaletteColors;
  setColor: (token: PaletteToken, hex: string) => void;
  resetColors: () => void;
};

const STORAGE_KEY = 'cung-lam:color-theme';
const PALETTE_STORAGE_KEY = 'cung-lam:color-palettes-v1';
const ColorThemeContext = createContext<ColorThemeContextValue | null>(null);

type StoredPalettes = Partial<Record<AppColorTheme, Partial<PaletteColors>>>;

const BASE_PALETTES: Record<AppColorTheme, Record<PaletteToken, string>> = {
  default: {
    background: '44 78% 63%',
    foreground: '30 42% 14%',
    card: '0 0% 100%',
    'card-foreground': '30 42% 14%',
    border: '39 44% 48%',
    'frame-border': '27 52% 31%',
    primary: '38 78% 34%',
    'primary-foreground': '0 0% 100%',
    secondary: '43 55% 84%',
    'secondary-foreground': '30 42% 14%',
    muted: '43 49% 83%',
    'muted-foreground': '30 35% 24%',
    accent: '42 82% 57%',
    'accent-foreground': '30 42% 14%',
    destructive: '4 72% 44%',
    'destructive-foreground': '0 0% 100%',
    input: '39 44% 48%',
    ring: '39 80% 32%',
    ok: '150 58% 30%',
    warn: '30 86% 35%',
    info: '199 70% 32%',
    'tile-background': '28 100% 97%',
    'tile-foreground': '25 58% 27%',
    'tile-border': '25 62% 52%',
    'tile-accent': '25 78% 38%',
    'detail-background': '27 42% 29%',
    'detail-foreground': '35 65% 93%',
    'detail-muted': '35 38% 80%',
    'detail-border': '29 30% 49%',
    'personal-accent': '162 62% 28%',
    'search-background': '25 55% 22%',
    'search-foreground': '40 85% 94%',
    'search-border': '27 56% 42%',
    'search-focus': '36 80% 64%',
    overlay: '0 0% 0%',
    'shadow-color': '30 72% 17%',
    'auth-button-background': '0 0% 100%',
    'auth-button-foreground': '210 7% 24%',
    'auth-button-border': '220 13% 87%',
    'auth-button-hover': '210 17% 98%',
  },
  dark: {
    background: '0 0% 4%',
    foreground: '30 32% 76%',
    card: '0 0% 9%',
    'card-foreground': '30 32% 76%',
    border: '0 0% 30%',
    'frame-border': '39 35% 46%',
    primary: '30 48% 62%',
    'primary-foreground': '0 0% 8%',
    secondary: '0 0% 18%',
    'secondary-foreground': '30 32% 76%',
    muted: '0 0% 15%',
    'muted-foreground': '30 24% 66%',
    accent: '30 42% 54%',
    'accent-foreground': '0 0% 8%',
    destructive: '4 72% 58%',
    'destructive-foreground': '0 0% 100%',
    input: '0 0% 34%',
    ring: '43 80% 62%',
    ok: '150 58% 48%',
    warn: '30 86% 56%',
    info: '199 70% 62%',
    'tile-background': '25 34% 12%',
    'tile-foreground': '28 58% 80%',
    'tile-border': '25 60% 45%',
    'tile-accent': '25 86% 68%',
    'detail-background': '27 42% 29%',
    'detail-foreground': '35 65% 93%',
    'detail-muted': '35 38% 80%',
    'detail-border': '29 30% 49%',
    'personal-accent': '162 50% 58%',
    'search-background': '25 56% 16%',
    'search-foreground': '40 80% 90%',
    'search-border': '28 50% 38%',
    'search-focus': '36 72% 58%',
    overlay: '0 0% 0%',
    'shadow-color': '0 0% 0%',
    'auth-button-background': '0 0% 100%',
    'auth-button-foreground': '210 7% 24%',
    'auth-button-border': '220 13% 87%',
    'auth-button-hover': '210 17% 98%',
  },
};

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

function readStoredPalettes(): StoredPalettes {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(PALETTE_STORAGE_KEY) ?? 'null');
    if (!raw || typeof raw !== 'object') return {};
    const stored = raw as Record<string, unknown>;
    const result: StoredPalettes = {};
    for (const theme of ['default', 'dark'] as const) {
      const candidate = stored[theme];
      if (!candidate || typeof candidate !== 'object') continue;
      const valid: Partial<PaletteColors> = {};
      for (const token of PALETTE_TOKENS) {
        const color = (candidate as Record<string, unknown>)[token];
        if (isHexColor(color)) valid[token] = color.toUpperCase();
      }
      if (Object.keys(valid).length > 0) result[theme] = valid;
    }
    return result;
  } catch {
    return {};
  }
}

function hslToHex(hsl: string): string {
  const [hRaw, sRaw, lRaw] = hsl.split(' ');
  const hue = ((Number(hRaw) % 360) + 360) % 360 / 360;
  const saturation = Number.parseFloat(sRaw) / 100;
  const lightness = Number.parseFloat(lRaw) / 100;
  const channel = (n: number) => {
    const k = (n + hue * 12) % 12;
    const a = saturation * Math.min(lightness, 1 - lightness);
    return lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return `#${[channel(0), channel(8), channel(4)]
    .map((value) => Math.round(value * 255).toString(16).padStart(2, '0'))
    .join('')}`.toUpperCase();
}

function hexToHsl(hex: string): string {
  const red = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const green = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const lightness = (max + min) / 2;
  let hue = 0;
  let saturation = 0;
  if (delta !== 0) {
    saturation = delta / (1 - Math.abs(2 * lightness - 1));
    if (max === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (max === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  if (hue < 0) hue += 360;
  return `${Math.round(hue)} ${Math.round(saturation * 100)}% ${Math.round(lightness * 100)}%`;
}

function readStoredTheme(): AppColorTheme {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'default';
  } catch {
    return 'default';
  }
}

export function ColorThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<AppColorTheme>(readStoredTheme);
  const [palettes, setPalettes] = useState<StoredPalettes>(readStoredPalettes);

  const colors = useMemo(() => Object.fromEntries(
    PALETTE_TOKENS.map((token) => [token, palettes[theme]?.[token] ?? hslToHex(BASE_PALETTES[theme][token])]),
  ) as PaletteColors, [palettes, theme]);

  const setColor = useCallback((token: PaletteToken, hex: string) => {
    if (!isHexColor(hex)) return;
    setPalettes((current) => ({
      ...current,
      [theme]: { ...current[theme], [token]: hex.toUpperCase() },
    }));
  }, [theme]);

  const resetColors = useCallback(() => {
    setPalettes((current) => {
      const next = { ...current };
      delete next[theme];
      return next;
    });
  }, [theme]);

  useLayoutEffect(() => {
    document.documentElement.dataset.colorTheme = theme;
    const overrides = palettes[theme] ?? {};
    for (const token of PALETTE_TOKENS) {
      const value = overrides[token];
      if (value) document.documentElement.style.setProperty(`--${token}`, hexToHsl(value));
      else document.documentElement.style.removeProperty(`--${token}`);
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
      window.localStorage.setItem(PALETTE_STORAGE_KEY, JSON.stringify(palettes));
    } catch {
      // Keep the selected theme for this session when browser storage is unavailable.
    }
  }, [theme, palettes]);

  const value = useMemo(() => ({ theme, setTheme, colors, setColor, resetColors }), [theme, colors, setColor, resetColors]);
  return <ColorThemeContext.Provider value={value}>{children}</ColorThemeContext.Provider>;
}

export function useColorTheme() {
  const value = useContext(ColorThemeContext);
  if (!value) throw new Error('useColorTheme outside ColorThemeProvider');
  return value;
}
