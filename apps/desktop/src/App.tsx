import { useCallback, useEffect, useMemo, useState } from 'react';
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
  // Bumped each time an attempt completes so the Progress page refetches its SQLite stats.
  const [progressRefreshKey, setProgressRefreshKey] = useState(0);
  const selectedCase = useMemo<VascCase | undefined>(
    () => cases.find((item) => item.id === selectedCaseId),
    [cases, selectedCaseId],
  );

  const refreshCases = useCallback(async () => {
    const loaded = await loadCases();
    setCases(loaded);
    setSelectedCaseId((current) => {
      if (current && loaded.find((c) => c.id === current)) return current;
      return loaded[0]?.id ?? '';
    });
    return loaded;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void refreshCases().catch(() => undefined).then(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [refreshCases]);

  function openCase(caseId: string) {
    setSelectedCaseId(caseId);
    setScreen('case-detail');
  }

  function startCase(caseId: string) {
    setSelectedCaseId(caseId);
    setScreen('training');
  }

  async function openCaseInTraining(caseId: string) {
    // Pull the latest cases so freshly-edited content shows up in training.
    const loaded = await refreshCases();
    if (loaded.find((c) => c.id === caseId)) {
      setSelectedCaseId(caseId);
      setScreen('training');
    }
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
        <TrainingWorkspace
          vascCase={selectedCase}
          onFinish={() => {
            setProgressRefreshKey((k) => k + 1);
            setScreen('progress');
          }}
          onChooseCase={() => setScreen('cases')}
        />
      )}
      {screen === 'progress' && <ProgressPage refreshKey={progressRefreshKey} />}
      {screen === 'admin' && (
        <AdminContentPage
          onCasesChanged={() => {
            void refreshCases();
          }}
          onOpenInTraining={(caseId) => {
            void openCaseInTraining(caseId);
          }}
        />
      )}
      {screen === 'settings' && <SettingsPage />}
    </AppShell>
  );
}
