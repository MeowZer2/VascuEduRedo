const STORAGE_KEY = 'vascedu:viewer:recent-volumes';
const MAX_RECENT = 8;

export interface RecentVolumeEntry {
  kind?: 'nrrd' | 'dicom';
  path: string;
  seriesInstanceUid?: string;
  /** Display name (basename) cached so the dropdown works even if the file is missing. */
  name: string;
  /** ms since epoch — most recent first when sorted. */
  openedAt: number;
}

function isRecentVolumeEntry(value: unknown): value is RecentVolumeEntry {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.path === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.openedAt === 'number' &&
    (candidate.kind === undefined || candidate.kind === 'nrrd' || candidate.kind === 'dicom') &&
    (candidate.seriesInstanceUid === undefined || typeof candidate.seriesInstanceUid === 'string')
  );
}

export function loadRecentFiles(): RecentVolumeEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecentVolumeEntry).slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

export function basenameFromPath(path: string): string {
  if (!path) return '';
  const trimmed = path.replace(/[\\/]+$/, '');
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] || trimmed;
}

export function addRecentFile(path: string): RecentVolumeEntry[] {
  if (typeof window === 'undefined' || !path) return loadRecentFiles();
  const next: RecentVolumeEntry = {
    kind: 'nrrd',
    path,
    name: basenameFromPath(path),
    openedAt: Date.now(),
  };
  const existing = loadRecentFiles().filter((entry) => recentKey(entry) !== recentKey(next));
  const updated = [next, ...existing].slice(0, MAX_RECENT);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // ignore persistence failure
  }
  return updated;
}

export function addRecentDicomSeries(
  folderPath: string,
  seriesInstanceUid: string,
  name: string,
): RecentVolumeEntry[] {
  if (typeof window === 'undefined' || !folderPath || !seriesInstanceUid) return loadRecentFiles();
  const next: RecentVolumeEntry = {
    kind: 'dicom',
    path: folderPath,
    seriesInstanceUid,
    name: name || basenameFromPath(folderPath) || 'DICOM series',
    openedAt: Date.now(),
  };
  const existing = loadRecentFiles().filter((entry) => recentKey(entry) !== recentKey(next));
  const updated = [next, ...existing].slice(0, MAX_RECENT);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // ignore persistence failure
  }
  return updated;
}

export function removeRecentFile(path: string): RecentVolumeEntry[] {
  if (typeof window === 'undefined') return loadRecentFiles();
  const updated = loadRecentFiles().filter((entry) => recentKey(entry) !== path);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // ignore
  }
  return updated;
}

export function recentKey(entry: RecentVolumeEntry): string {
  return entry.kind === 'dicom' && entry.seriesInstanceUid
    ? `dicom:${entry.path}:${entry.seriesInstanceUid}`
    : entry.path;
}

export function clearRecentFiles(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
