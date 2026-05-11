import type { DisplayConvention, ViewerLayout, ViewerToolMode } from '../components/viewerShared';

const STORAGE_KEY = 'vascedu:viewer:display-convention';
const LAYOUT_STORAGE_KEY = 'vascedu:viewer:last-layout';
const TOOL_STORAGE_KEY = 'vascedu:viewer:last-tool';
const DEFAULT_CONVENTION: DisplayConvention = 'pacs';
const DEFAULT_LAYOUT: ViewerLayout = '1x1';
const DEFAULT_TOOL: ViewerToolMode = 'scroll';

function isDisplayConvention(value: string): value is DisplayConvention {
  return value === 'pacs' || value === 'canonical';
}

function isViewerLayout(value: string): value is ViewerLayout {
  return value === '1x1' || value === '1x2' || value === '1x3' || value === '2x2';
}

function isViewerToolMode(value: string): value is ViewerToolMode {
  return value === 'scroll' || value === 'pan' || value === 'distance' || value === 'angle';
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

export function loadViewerLayout(): ViewerLayout {
  if (typeof window === 'undefined') return DEFAULT_LAYOUT;
  try {
    const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (raw && isViewerLayout(raw)) return raw;
  } catch {
    // Best-effort persistence; failures are non-fatal.
  }
  return DEFAULT_LAYOUT;
}

export function saveViewerLayout(layout: ViewerLayout): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, layout);
  } catch {
    // Best-effort persistence; failures are non-fatal.
  }
}

export function loadViewerToolMode(): ViewerToolMode {
  if (typeof window === 'undefined') return DEFAULT_TOOL;
  try {
    const raw = window.localStorage.getItem(TOOL_STORAGE_KEY);
    if (raw && isViewerToolMode(raw)) return raw;
  } catch {
    // Best-effort persistence; failures are non-fatal.
  }
  return DEFAULT_TOOL;
}

export function saveViewerToolMode(tool: ViewerToolMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TOOL_STORAGE_KEY, tool);
  } catch {
    // Best-effort persistence; failures are non-fatal.
  }
}
