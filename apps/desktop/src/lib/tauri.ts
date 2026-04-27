export async function safeInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T | null> {
  let mod: typeof import('@tauri-apps/api/core');
  try {
    mod = await import('@tauri-apps/api/core');
  } catch {
    return null;
  }

  try {
    return await mod.invoke<T>(command, args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('__TAURI_INTERNALS__') || message.includes('not available')) {
      return null;
    }
    throw new Error(message);
  }
}
