export const MAX_SLICE_LOAD_ATTEMPTS = 3;

export interface SliceRetryDecision {
  terminal: boolean;
  delayMs: number | null;
}

export function sliceRetryDecision(failureCount: number): SliceRetryDecision {
  const count = Math.max(0, Math.floor(failureCount));
  if (count >= MAX_SLICE_LOAD_ATTEMPTS) return { terminal: true, delayMs: null };
  return { terminal: false, delayMs: 150 * 2 ** Math.max(0, count - 1) };
}

/** Slice-dependent interactions always belong to committed pixels, not intent. */
export function interactionSlice(displayedSlice: number | null): number | null {
  return displayedSlice;
}
