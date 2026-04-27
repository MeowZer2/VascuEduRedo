import { invoke } from '@tauri-apps/api/core';

export const TAURI_DESKTOP_REQUIRED_MESSAGE = 'NRRD viewer requires Tauri desktop mode. Run pnpm dev.';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export function isTauriDesktop(): boolean {
  return typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined;
}

export async function safeInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!isTauriDesktop()) {
    return null;
  }

  try {
    return await invoke<T>(command, args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('__TAURI_INTERNALS__') || message.includes('not available') || message.includes('is not a function')) {
      return null;
    }
    throw new Error(message);
  }
}
