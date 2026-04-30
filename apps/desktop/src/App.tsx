import { useEffect, useMemo, useState } from 'react';
import { AppShell } from './components/AppShell';
import { cases as sampleCases } from './data/sampleContent';
import { AdminContentPage } from './features/admin/AdminContentPage';
import { CaseDetailPage } from './features/cases/CaseDetailPage';
import { CaseLibraryPage } from './features/cases/CaseLibraryPage';
import { HomePage } from './features/home/HomePage';
import { ProgressPage } from './features/progress/ProgressPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { TrainingWorkspace } from './features/training/TrainingWorkspace';
import { loadCases } from './lib/content';
import type { VascCase } from './types';

export type Screen = 'home' | 'cases' | 'case-detail' | 'training' | 'progress' | 'admin' | 'settings';

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  // Start with sample data so the first paint isn't blank, then swap to SQLite-backed cases
  // once the backend responds. Browser mode keeps the sample data.
  const [cases, setCases] = useState<VascCase[]>(sampleCases);
  const [selectedCaseId, setSelectedCaseId] = useState<string>(sampleCases[0]?.id ?? '');
  const selectedCase = useMemo<VascCase | undefined>(
    () => cases.find((item) => item.id === selectedCaseId),
    [cases, selectedCaseId],
  );

  useEffect(() => {
    let cancelled = false;
    loadCases().then((loaded) => {
      if (cancelled) return;
      setCases(loaded);
      if (!loaded.find((c) => c.id === selectedCaseId) && loaded[0]) {
        setSelectedCaseId(loaded[0].id);
      }
    });
    return () => {
      cancelled = true;
    };
    // Intentionally empty deps: we want this to run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openCase(caseId: string) {
    setSelectedCaseId(caseId);
    setScreen('case-detail');
  }

  function startCase(caseId: string) {
    setSelectedCaseId(caseId);
    setScreen('training');
  }

  return (
    <AppShell activeScreen={screen} onNavigate={setScreen}>
      {screen === 'home' && (
        <HomePage cases={cases} onStart={() => cases[0] && startCase(cases[0].id)} onOpenCases={() => setScreen('cases')} />
      )}
      {screen === 'cases' && <CaseLibraryPage cases={cases} onOpenCase={openCase} onStartCase={startCase} />}
      {screen === 'case-detail' && selectedCase && (
        <CaseDetailPage vascCase={selectedCase} onBack={() => setScreen('cases')} onStart={() => startCase(selectedCase.id)} />
      )}
      {screen === 'training' && selectedCase && (
        <TrainingWorkspace vascCase={selectedCase} onFinish={() => setScreen('progress')} onChooseCase={() => setScreen('cases')} />
      )}
      {screen === 'progress' && <ProgressPage />}
      {screen === 'admin' && <AdminContentPage />}
      {screen === 'settings' && <SettingsPage />}
    </AppShell>
  );
}
