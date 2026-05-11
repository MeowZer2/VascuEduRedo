import type { CaseBookmark } from '../types';
import { isTauriDesktop, safeInvoke } from './tauri';

export interface BookmarkInput {
  id?: string | null;
  caseId: string;
  title: string;
  note: string;
  plane: CaseBookmark['plane'];
  sliceIndex: number;
  windowWidth: number;
  windowLevel: number;
  zoom?: number | null;
  crosshairVoxel?: [number, number, number] | null;
  tags?: string[];
  orderIndex?: number | null;
}

const STORAGE_KEY = 'vascedu:case-bookmarks:fallback';

function fallbackAll(): CaseBookmark[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as CaseBookmark[]) : [];
  } catch {
    return [];
  }
}

function saveFallback(rows: CaseBookmark[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  } catch {
    // ignore fallback persistence failure
  }
}

export async function listCaseBookmarks(caseId: string): Promise<CaseBookmark[]> {
  if (isTauriDesktop()) {
    return (await safeInvoke<CaseBookmark[]>('list_case_bookmarks', { caseId })) ?? [];
  }
  return fallbackAll()
    .filter((bookmark) => bookmark.caseId === caseId)
    .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
}

export async function saveCaseBookmark(input: BookmarkInput): Promise<CaseBookmark> {
  if (isTauriDesktop()) {
    const row = await safeInvoke<CaseBookmark>('save_case_bookmark', { input });
    if (!row) throw new Error('save_case_bookmark returned no row');
    return row;
  }
  const all = fallbackAll();
  const id = input.id || `bookmark-${Date.now()}`;
  const row: CaseBookmark = {
    id,
    caseId: input.caseId,
    title: input.title,
    note: input.note,
    plane: input.plane,
    sliceIndex: input.sliceIndex,
    windowWidth: input.windowWidth,
    windowLevel: input.windowLevel,
    zoom: input.zoom ?? undefined,
    crosshairVoxel: input.crosshairVoxel ?? null,
    tags: input.tags ?? [],
    orderIndex: input.orderIndex ?? all.filter((b) => b.caseId === input.caseId).length,
  };
  saveFallback([row, ...all.filter((bookmark) => bookmark.id !== id)]);
  return row;
}

export async function deleteCaseBookmark(bookmarkId: string): Promise<void> {
  if (isTauriDesktop()) {
    await safeInvoke<void>('delete_case_bookmark', { bookmarkId });
    return;
  }
  saveFallback(fallbackAll().filter((bookmark) => bookmark.id !== bookmarkId));
}

export async function reorderCaseBookmarks(
  caseId: string,
  orderedBookmarkIds: string[],
): Promise<void> {
  if (isTauriDesktop()) {
    await safeInvoke<void>('reorder_case_bookmarks', { caseId, orderedBookmarkIds });
    return;
  }
  const order = new Map(orderedBookmarkIds.map((id, index) => [id, index]));
  saveFallback(
    fallbackAll().map((bookmark) =>
      bookmark.caseId === caseId && order.has(bookmark.id)
        ? { ...bookmark, orderIndex: order.get(bookmark.id) }
        : bookmark,
    ),
  );
}
