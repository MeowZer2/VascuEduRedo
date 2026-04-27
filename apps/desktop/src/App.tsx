import { useMemo, useState } from 'react';
import { AppShell } from './components/AppShell';
import { cases } from './data/sampleContent';
import { AdminContentPage } from './features/admin/AdminContentPage';
import { CaseDetailPage } from './features/cases/CaseDetailPage';
import { CaseLibraryPage } from './features/cases/CaseLibraryPage';
import { HomePage } from './features/home/HomePage';
import { ProgressPage } from './features/progress/ProgressPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { TrainingWorkspace } from './features/training/TrainingWorkspace';
import type { VascCase } from './types';

export type Screen = 'home' | 'cases' | 'case-detail' | 'training' | 'progress' | 'admin' | 'settings';

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [selectedCaseId, setSelectedCaseId] = useState<string>(cases[0]?.id ?? '');
  const selectedCase = useMemo<VascCase | undefined>(() => cases.find((item) => item.id === selectedCaseId), [selectedCaseId]);

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
      {screen === 'home' && <HomePage onStart={() => startCase(cases[0].id)} onOpenCases={() => setScreen('cases')} />}
      {screen === 'cases' && <CaseLibraryPage onOpenCase={openCase} onStartCase={startCase} />}
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
