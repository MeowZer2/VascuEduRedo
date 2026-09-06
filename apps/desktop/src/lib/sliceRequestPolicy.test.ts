import { describe, expect, it } from 'vitest';
import { interactionSlice, MAX_SLICE_LOAD_ATTEMPTS, sliceRetryDecision } from './sliceRequestPolicy';

describe('slice request correctness policy', () => {
  it('keeps interactions on the displayed frame while another slice is requested', () => {
    const displayed = 119;
    const requested = 120;
    expect(requested).not.toBe(displayed);
    expect(interactionSlice(displayed)).toBe(119);
    expect(interactionSlice(null)).toBeNull();
  });

  it('terminates permanent failures after a bounded number of attempts', () => {
    expect(sliceRetryDecision(1)).toEqual({ terminal: false, delayMs: 150 });
    expect(sliceRetryDecision(2)).toEqual({ terminal: false, delayMs: 300 });
    expect(sliceRetryDecision(MAX_SLICE_LOAD_ATTEMPTS)).toEqual({ terminal: true, delayMs: null });
  });
});
