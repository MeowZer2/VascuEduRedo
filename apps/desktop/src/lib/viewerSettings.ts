import type { DisplayConvention } from '../components/viewerShared';

const STORAGE_KEY = 'vascedu:viewer:display-convention';
const DEFAULT_CONVENTION: DisplayConvention = 'pacs';

function isDisplayConvention(value: string): value is DisplayConvention {
  return value === 'pacs' || value === 'canonical';
}

export function loadDisplayConvention(): DisplayConvention {
  if (typeof window === 'undefined') return DEFAULT_CONVENTION;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw && isDisplayConvention(raw)) return raw;
  } catch {
    // localStorage unavailable (private mode etc.) — fall through to default.
  }
  return DEFAULT_CONVENTION;
}

export function saveDisplayConvention(convention: DisplayConvention): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, convention);
  } catch {
    // Best-effort persistence; failures are non-fatal.
  }
}
