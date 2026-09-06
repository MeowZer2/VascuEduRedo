import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from './components/AppShell';
import { cases as sampleCases } from './data/sampleContent';
import { AdminContentPage } from './features/admin/AdminContentPage';
import { CaseDetailPage } from './features/cases/CaseDetailPage';
import { CaseLibraryPage } from './features/cases/CaseLibraryPage';
import { VesselComposerPage } from './features/composer/VesselComposerPage';
import { DevicesCatalogPage } from './features/devices/DevicesCatalogPage';
import { HomePage } from './features/home/HomePage';
import { ProgressPage } from './features/progress/ProgressPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { TrainingStartPage, type TrainingFilters } from './features/training/TrainingStartPage';
import { TrainingWorkspace } from './features/training/TrainingWorkspace';
import { applyThemeMode, getStoredThemeMode } from './lib/appearance';
import { loadCases } from './lib/content';
import { friendlyError } from './lib/productionState';
import { isTauriDesktop } from './lib/tauri';
import { ProfileProvider, useProfiles } from './lib/profileContext';
import { UnsavedChangesProvider } from './lib/productionState';
import type { VesselPlanScope } from './lib/vesselComposer';
import type { VascCase } from './types';

export type Screen =
  | 'home'
  | 'cases'
  | 'case-detail'
  | 'training'
  | 'training-session'
  | 'vessel-composer'
  | 'devices'
  | 'progress'
  | 'admin'
  | 'settings';

export default function App() {
  return (
    <ProfileProvider>
      <AppInner />
    </ProfileProvider>
  );
}

function AppInner() {
  const { activeProfileId } = useProfiles();
  const [screen, setScreen] = useState<Screen>('home');
  const [confirmNavigation, setConfirmNavigation] = useState<() => boolean>(() => () => true);
  // Browser preview uses bundled samples. Native mode starts empty so a storage
  // failure can never be mistaken for real course content.
  const [cases, setCases] = useState<VascCase[]>(() => isTauriDesktop() ? [] : sampleCases);
  const [contentError, setContentError] = useState<string | null>(null);
  const [selectedCaseId, setSelectedCaseId] = useState<string>(sampleCases[0]?.id ?? '');
  const [composerCaseId, setComposerCaseId] = useState<string | null>(null);
  const [composerScope, setComposerScope] = useState<VesselPlanScope>('learner');
  const [composerEntryContext, setComposerEntryContext] = useState<'learner' | 'admin'>('learner');
  // Bumped each time an attempt completes so the Progress page refetches its SQLite stats.
  const [progressRefreshKey, setProgressRefreshKey] = useState(0);
  const selectedCase = useMemo<VascCase | undefined>(
    () => cases.find((item) => item.id === selectedCaseId),
    [cases, selectedCaseId],
  );

  useEffect(() => {
    applyThemeMode(getStoredThemeMode());
    const media = window.matchMedia?.('(prefers-color-scheme: light)');
    if (!media) return undefined;
    const onChange = () => applyThemeMode(getStoredThemeMode());
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const refreshCases = useCallback(async () => {
    try {
      const loaded = await loadCases();
      setCases(loaded);
      setContentError(null);
      setSelectedCaseId((current) => {
        if (current && loaded.find((c) => c.id === current)) return current;
        return loaded[0]?.id ?? '';
      });
      return loaded;
    } catch (caught) {
      setContentError(friendlyError(caught, 'The case library could not be loaded from desktop storage.'));
      throw caught;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void refreshCases().catch(() => undefined).then(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [refreshCases]);

  function openCase(caseId: string) {
    if (!confirmNavigation()) return;
    setSelectedCaseId(caseId);
    setScreen('case-detail');
  }

  function startCase(caseId: string) {
    if (!confirmNavigation()) return;
    const target = cases.find((item) => item.id === caseId);
    if (!target || target.questions.length === 0) {
      window.alert('This case has no usable questions and cannot start practice.');
      return;
    }
    setSelectedCaseId(caseId);
    setScreen('training-session');
  }

  function startGuidedTraining(filters: TrainingFilters) {
    const matching = cases.find((item) => {
      const difficultyOk = filters.difficulty === 'any' || item.difficulty === filters.difficulty;
      const topicOk = filters.topic === 'any' || item.categoryId === filters.topic;
      return difficultyOk && topicOk && item.questions.length > 0;
    });
    if (!matching) return;
    setSelectedCaseId(matching.id);
    setScreen('training-session');
  }

  function openVesselComposer(caseId?: string | null, scope: VesselPlanScope = 'learner', entryContext: 'learner' | 'admin' = 'learner') {
    if (!confirmNavigation()) return;
    setComposerCaseId(caseId ?? null);
    setComposerScope(scope);
    setComposerEntryContext(entryContext);
    if (caseId) setSelectedCaseId(caseId);
    setScreen('vessel-composer');
  }

  function handleNavigate(nextScreen: Screen) {
    if (nextScreen !== screen && !confirmNavigation()) return;
    if (nextScreen === 'vessel-composer') {
      setComposerCaseId(null);
      setComposerScope('learner');
      setComposerEntryContext('learner');
    }
    setScreen(nextScreen);
  }

  async function openCaseInTraining(caseId: string) {
    // Pull the latest cases so freshly-edited content shows up in training.
    const loaded = await refreshCases();
    if (loaded.find((c) => c.id === caseId)) {
      setSelectedCaseId(caseId);
      setScreen('training-session');
    }
  }

  return (
    <UnsavedChangesProvider onReady={(nextConfirmNavigation) => setConfirmNavigation(() => nextConfirmNavigation)}>
      <AppShell activeScreen={screen} onNavigate={handleNavigate}>
        {contentError ? (
          <div className="admin-banner error" role="alert">
            Case library unavailable: {contentError}
            <button type="button" className="secondary-button small" onClick={() => void refreshCases().catch(() => undefined)}>Retry</button>
          </div>
        ) : null}
        {screen === 'home' && (
          <HomePage
            key={`home-${activeProfileId}`}
            cases={cases}
            refreshKey={progressRefreshKey}
            onStart={() => {
              const target = selectedCase ?? cases[0];
              if (target) {
                startCase(target.id);
              } else {
                setScreen('cases');
              }
            }}
            onOpenCases={() => setScreen('cases')}
            onOpenPlanning={() => openVesselComposer(selectedCaseId || null)}
            onOpenCase={openCase}
            onOpenProgress={() => setScreen('progress')}
            onOpenDevices={() => setScreen('devices')}
          />
        )}
        {screen === 'cases' && (
          <CaseLibraryPage
            cases={cases}
            onOpenCase={openCase}
            onStartCase={startCase}
          />
        )}
        {screen === 'case-detail' && selectedCase && (
          <CaseDetailPage
            vascCase={selectedCase}
            onBack={() => setScreen('cases')}
            onStart={() => startCase(selectedCase.id)}
            onOpenReferencePlan={() => openVesselComposer(selectedCase.id, 'reference', 'learner')}
            onOpenMyPlan={() => openVesselComposer(selectedCase.id, 'learner', 'learner')}
          />
        )}
        {screen === 'training' && (
          <TrainingStartPage
            cases={cases}
            onStart={startGuidedTraining}
            onBrowseCases={() => setScreen('cases')}
          />
        )}
        {screen === 'training-session' && selectedCase && (
          <TrainingWorkspace
            vascCase={selectedCase}
            onFinish={() => {
              setProgressRefreshKey((k) => k + 1);
              setScreen('progress');
            }}
            onChooseCase={() => setScreen('training')}
          />
        )}
        {screen === 'devices' && <DevicesCatalogPage />}
        {screen === 'vessel-composer' && (
          <VesselComposerPage
            cases={cases}
            initialCaseId={composerCaseId}
            initialScope={composerScope}
            entryContext={composerEntryContext}
            onOpenCase={(caseId) => {
              setSelectedCaseId(caseId);
              setScreen('case-detail');
            }}
          />
        )}
        {screen === 'progress' && (
          <ProgressPage key={`progress-${activeProfileId}`} refreshKey={progressRefreshKey} />
        )}
        {screen === 'admin' && (
          <AdminContentPage
            onCasesChanged={() => {
              void refreshCases();
            }}
            onOpenInTraining={(caseId) => {
              void openCaseInTraining(caseId);
            }}
            onOpenVesselComposer={(caseId) => openVesselComposer(caseId, 'reference', 'admin')}
          />
        )}
        {screen === 'settings' && <SettingsPage />}
      </AppShell>
    </UnsavedChangesProvider>
  );
}
