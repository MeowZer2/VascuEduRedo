// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./tauri', () => ({
  isTauriDesktop: () => true,
  safeInvoke: vi.fn(),
}));

import { safeInvoke } from './tauri';
import { loadCases } from './content';
import { listDevices } from './devices';

describe('native repository failure semantics', () => {
  beforeEach(() => vi.mocked(safeInvoke).mockReset());

  it('does not replace a failed native case query with browser samples', async () => {
    vi.mocked(safeInvoke).mockRejectedValueOnce(new Error('database unavailable'));
    await expect(loadCases()).rejects.toThrow('database unavailable');
  });

  it('distinguishes a failed device query from a valid empty catalog', async () => {
    vi.mocked(safeInvoke).mockRejectedValueOnce(new Error('database unavailable'));
    await expect(listDevices()).rejects.toThrow('database unavailable');
    vi.mocked(safeInvoke).mockResolvedValueOnce([]);
    await expect(listDevices()).resolves.toEqual([]);
  });
});
