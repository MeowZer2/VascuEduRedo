import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

const GENERIC_UNSAVED_MESSAGE = 'You have unsaved changes. Leave this view and discard them?';

interface UnsavedGuardEntry {
  active: boolean;
  message: string;
}

interface UnsavedChangesContextValue {
  confirmNavigation: () => boolean;
  setGuard: (id: string, active: boolean, message?: string) => void;
}

const UnsavedChangesContext = createContext<UnsavedChangesContextValue | null>(null);

export function UnsavedChangesProvider({
  children,
  onReady,
}: {
  children: ReactNode;
  onReady?: (confirmNavigation: () => boolean) => void;
}) {
  const [guards, setGuards] = useState<Record<string, UnsavedGuardEntry>>({});

  const setGuard = useCallback((id: string, active: boolean, message = GENERIC_UNSAVED_MESSAGE) => {
    setGuards((current) => {
      if (!active) {
        if (!current[id]) return current;
        const next = { ...current };
        delete next[id];
        return next;
      }
      const existing = current[id];
      if (existing?.active === active && existing.message === message) return current;
      return { ...current, [id]: { active, message } };
    });
  }, []);

  const confirmNavigation = useCallback(() => {
    const activeGuard = Object.values(guards).find((guard) => guard.active);
    if (!activeGuard) return true;
    return window.confirm(activeGuard.message || GENERIC_UNSAVED_MESSAGE);
  }, [guards]);

  useEffect(() => {
    onReady?.(confirmNavigation);
  }, [confirmNavigation, onReady]);

  const value = useMemo(
    () => ({ confirmNavigation, setGuard }),
    [confirmNavigation, setGuard],
  );

  return (
    <UnsavedChangesContext.Provider value={value}>
      {children}
    </UnsavedChangesContext.Provider>
  );
}

export function useUnsavedChangesGuard(id: string, active: boolean, message?: string) {
  const setGuard = useContext(UnsavedChangesContext)?.setGuard;

  useEffect(() => {
    if (!setGuard) return;
    setGuard(id, active, message);
    return () => setGuard(id, false);
  }, [active, id, message, setGuard]);

  useBeforeUnload(active);
}

export function useConfirmNavigation(): () => boolean {
  return useContext(UnsavedChangesContext)?.confirmNavigation ?? (() => true);
}

export function confirmDiscard(message = GENERIC_UNSAVED_MESSAGE): boolean {
  return window.confirm(message);
}

export function useBeforeUnload(active: boolean) {
  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!active) return;
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [active]);
}

export function friendlyError(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const message = raw.trim();
  if (!message) return fallback;
  if (/returned no row|invoke|command|sqlite|sqlx|payload|magic|raw slice/i.test(message)) {
    return fallback;
  }
  return message;
}
