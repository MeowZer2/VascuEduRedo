export type ThemeMode = 'dark' | 'light' | 'system';

const THEME_STORAGE_KEY = 'vascedu:theme-mode';

export function getStoredThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
  return raw === 'dark' || raw === 'light' || raw === 'system' ? raw : 'system';
}

export function resolveThemeMode(mode: ThemeMode): 'dark' | 'light' {
  if (mode !== 'system') return mode;
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function applyThemeMode(mode: ThemeMode) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.dataset.theme = resolveThemeMode(mode);
}

export function saveThemeMode(mode: ThemeMode) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  }
  applyThemeMode(mode);
}
