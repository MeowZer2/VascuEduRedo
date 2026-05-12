import { type CSSProperties, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { NrrdViewer, type ViewerMeasurement } from '../../components/NrrdViewer';
import { ProceduralPlanViewer } from '../../components/ProceduralPlanViewer';
import { createAttempt } from '../../lib/attempts';
import { saveAttempt } from '../../lib/progress';
import { listVesselCompositions, type VesselCompositionRow } from '../../lib/vesselComposer';
import type { AttemptResult, CaseBookmark, MeasurementQuestion, VascCase } from '../../types';
import { QuestionPanel, formatDuration } from './QuestionPanel';

interface TrainingWorkspaceProps {
  vascCase: VascCase;
  onFinish: () => void;
  onChooseCase: () => void;
}

const WORKSPACE_PREF_KEY = 'vascedu:training-workspace';
const DEFAULT_ASIDE_WIDTH = 430;
const MIN_ASIDE_WIDTH = 320;
const MAX_ASIDE_WIDTH = 620;

interface WorkspacePrefs {
  asideCollapsed: boolean;
  keyFindingsCollapsed: boolean;
  asideWidth: number;
}

function loadWorkspacePrefs(): WorkspacePrefs {
  if (typeof window === 'undefined') {
    return { asideCollapsed: false, keyFindingsCollapsed: false, asideWidth: DEFAULT_ASIDE_WIDTH };
  }
  try {
    const raw = window.localStorage.getItem(WORKSPACE_PREF_KEY);
    if (!raw) {
      return { asideCollapsed: false, keyFindingsCollapsed: false, asideWidth: DEFAULT_ASIDE_WIDTH };
    }
    const parsed = JSON.parse(raw) as Partial<WorkspacePrefs>;
    return {
      asideCollapsed: Boolean(parsed.asideCollapsed),
      keyFindingsCollapsed: Boolean(parsed.keyFindingsCollapsed),
      asideWidth:
        typeof parsed.asideWidth === 'number'
          ? Math.min(MAX_ASIDE_WIDTH, Math.max(MIN_ASIDE_WIDTH, parsed.asideWidth))
          : DEFAULT_ASIDE_WIDTH,
    };
  } catch {
    return { asideCollapsed: false, keyFindingsCollapsed: false, asideWidth: DEFAULT_ASIDE_WIDTH };
  }
}

function saveWorkspacePrefs(prefs: WorkspacePrefs) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(WORKSPACE_PREF_KEY, JSON.stringify(prefs));
  } catch {
    // Best-effort local preference persistence.
  }
}

export function TrainingWorkspace({ vascCase, onFinish, onChooseCase }: TrainingWorkspaceProps) {
  const [workspacePrefs, setWorkspacePrefs] = useState<WorkspacePrefs>(() => loadWorkspacePrefs());
  const [latestMeasurement, setLatestMeasurement] = useState<ViewerMeasurement | null>(null);
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);
  const [workspaceView, setWorkspaceView] = useState<'imaging' | 'procedure'>('imaging');
  const [proceduralPlan, setProceduralPlan] = useState<VesselCompositionRow | null>(null);
  const [activeProceduralStepId, setActiveProceduralStepId] = useState<string>('');
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [completedAttempt, setCompletedAttempt] = useState<AttemptResult | null>(null);
  const [activeBookmark, setActiveBookmark] = useState<CaseBookmark | null>(null);
  const [jumpBookmark, setJumpBookmark] = useState<CaseBookmark | null>(null);

  // Create an attempt row in SQLite when the workspace opens. In browser mode this returns
  // null and we just track the attempt locally without persistent ids.
  useEffect(() => {
    let cancelled = false;
    createAttempt(vascCase.id).then((attempt) => {
      if (cancelled) return;
      setAttemptId(attempt?.id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [vascCase.id]);

  useEffect(() => {
    let cancelled = false;
    setProceduralPlan(null);
    setActiveProceduralStepId('');
    setWorkspaceView('imaging');
    void listVesselCompositions(vascCase.id)
      .then((rows) => {
        if (cancelled) return;
        const plan = rows[0] ?? null;
        setProceduralPlan(plan);
        setActiveProceduralStepId(plan?.data.proceduralSteps[0]?.id ?? '');
      })
      .catch(() => {
        if (cancelled) return;
        setProceduralPlan(null);
        setActiveProceduralStepId('');
      });
    return () => {
      cancelled = true;
    };
  }, [vascCase.id]);

  const activeQuestion = vascCase.questions[activeQuestionIndex];
  const isMeasurementQuestion = activeQuestion?.type === 'measurement';
  const requestedTool = isMeasurementQuestion ? 'distance' as const : undefined;
  const requiredPlane = isMeasurementQuestion ? (activeQuestion as MeasurementQuestion).plane : undefined;
  const proceduralSteps = useMemo(
    () => proceduralPlan?.data.proceduralSteps.slice().sort((a, b) => a.orderIndex - b.orderIndex) ?? [],
    [proceduralPlan],
  );
  const activeProceduralStep =
    proceduralSteps.find((step) => step.id === activeProceduralStepId) ?? proceduralSteps[0] ?? null;
  const proceduralObjectsForStep = useMemo(() => {
    if (!proceduralPlan || !activeProceduralStep) return [];
    return proceduralPlan.data.proceduralObjects.filter(
      (object) => !object.stepId || object.stepId === activeProceduralStep.id,
    );
  }, [activeProceduralStep, proceduralPlan]);

  useEffect(() => {
    if (!activeQuestion?.proceduralStepId || !proceduralPlan) return;
    const step = proceduralSteps.find((item) => item.id === activeQuestion.proceduralStepId);
    if (!step) return;
    setActiveProceduralStepId(step.id);
    setWorkspaceView('procedure');
  }, [activeQuestion?.id, activeQuestion?.proceduralStepId, proceduralPlan, proceduralSteps]);

  function handleComplete(attempt: AttemptResult) {
    saveAttempt(attempt);
    setCompletedAttempt(attempt);
  }

  const jumpToBookmark = useCallback((bookmark: CaseBookmark) => {
    setActiveBookmark(bookmark);
    setJumpBookmark({ ...bookmark });
    setWorkspaceView('imaging');
  }, []);

  const jumpToProceduralStep = useCallback((stepId: string) => {
    if (!proceduralPlan?.data.proceduralSteps.some((step) => step.id === stepId)) return;
    setActiveProceduralStepId(stepId);
    setWorkspaceView('procedure');
  }, [proceduralPlan]);

  function updateWorkspacePrefs(updater: (current: WorkspacePrefs) => WorkspacePrefs) {
    setWorkspacePrefs((current) => {
      const next = updater(current);
      saveWorkspacePrefs(next);
      return next;
    });
  }

  function startAsideResize(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = workspacePrefs.asideWidth;
    const pointerId = event.pointerId;
    event.currentTarget.setPointerCapture(pointerId);

    function onMove(moveEvent: PointerEvent) {
      const nextWidth = Math.min(
        MAX_ASIDE_WIDTH,
        Math.max(MIN_ASIDE_WIDTH, startWidth - (moveEvent.clientX - startX)),
      );
      updateWorkspacePrefs((current) => ({ ...current, asideWidth: nextWidth, asideCollapsed: false }));
    }

    function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  }

  const hasBookmarks = Boolean(vascCase.bookmarks && vascCase.bookmarks.length > 0);
  const asideCollapsed = workspacePrefs.asideCollapsed;

  return (
    <div
      className={`training-layout${asideCollapsed ? ' training-layout-aside-collapsed' : ''}`}
      style={
        {
          '--training-aside-width': `${workspacePrefs.asideWidth}px`,
        } as CSSProperties
      }
    >
      <section className="training-main">
        <div className="workspace-header">
          <div>
            <p className="eyebrow">Guided practice</p>
            <h2>{vascCase.title}</h2>
          </div>
          <div className="workspace-header-actions">
            {proceduralPlan ? (
              <div className="workspace-view-tabs" aria-label="Workspace view">
                <button
                  type="button"
                  className={workspaceView === 'imaging' ? 'active' : ''}
                  onClick={() => setWorkspaceView('imaging')}
                >
                  Imaging
                </button>
                <button
                  type="button"
                  className={workspaceView === 'procedure' ? 'active' : ''}
                  onClick={() => setWorkspaceView('procedure')}
                >
                  Angiogram
                </button>
              </div>
            ) : null}
            <button className="secondary-button" onClick={onChooseCase}>Change case</button>
          </div>
        </div>
        {workspaceView === 'imaging' && isMeasurementQuestion && requiredPlane ? (
          <div className="measurement-question-banner">
            <span className="measurement-question-banner-icon">📏</span>
            <span>
              Switch to the <strong>{requiredPlane.charAt(0).toUpperCase() + requiredPlane.slice(1)}</strong> plane and use
              the <strong>Distance</strong> tool to measure — then submit from the question panel.
            </span>
          </div>
        ) : null}
        {workspaceView === 'procedure' && proceduralPlan ? (
          <section className="viewer-card procedural-workspace-card">
            <div className="viewer-header">
              <div>
                <h3>Procedural angiogram</h3>
                <p>{activeProceduralStep?.label ?? proceduralPlan.name}</p>
              </div>
              <span className="pill">Teaching context</span>
            </div>
            <ProceduralPlanViewer
              plan={proceduralPlan}
              activeStepId={activeProceduralStep?.id ?? activeProceduralStepId}
              onStepChange={setActiveProceduralStepId}
            />
          </section>
        ) : (
          <NrrdViewer
            volumePath={vascCase.volume.path ?? 'sample'}
            description={vascCase.volume.description}
            requestedTool={requestedTool}
            onLatestMeasurementChange={setLatestMeasurement}
            jumpToBookmark={jumpBookmark}
            activeBookmark={activeBookmark}
          />
        )}
      </section>
      <button
        type="button"
        className="training-splitter"
        onPointerDown={startAsideResize}
        disabled={asideCollapsed}
        aria-label="Resize question panel"
        title="Drag to resize question panel"
      />
      <aside className="training-aside">
        <button
          type="button"
          className="training-aside-toggle"
          onClick={() =>
            updateWorkspacePrefs((current) => ({ ...current, asideCollapsed: !current.asideCollapsed }))
          }
        >
          {asideCollapsed ? 'Show questions' : 'Hide panel'}
        </button>
        {!asideCollapsed && hasBookmarks ? (
          <section className="question-card key-findings-panel">
            <button
              type="button"
              className="panel-section-toggle"
              onClick={() =>
                updateWorkspacePrefs((current) => ({
                  ...current,
                  keyFindingsCollapsed: !current.keyFindingsCollapsed,
                }))
              }
            >
              <span>Key findings</span>
              <strong>{workspacePrefs.keyFindingsCollapsed ? 'Show' : 'Hide'}</strong>
            </button>
            {!workspacePrefs.keyFindingsCollapsed ? (
              <div className="key-finding-list">
                {vascCase.bookmarks?.map((bookmark) => (
                  <button
                    key={bookmark.id}
                    type="button"
                    className={
                      activeBookmark?.id === bookmark.id
                        ? 'key-finding-row active'
                        : 'key-finding-row'
                    }
                    onClick={() => jumpToBookmark(bookmark)}
                  >
                    <strong>{bookmark.title}</strong>
                    <span>
                      {bookmark.plane} slice {bookmark.sliceIndex + 1}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}
        {!asideCollapsed && proceduralPlan && proceduralSteps.length > 0 ? (
          <section className="question-card procedural-steps-panel">
            <div className="panel-section-toggle static">
              <span>Procedural steps</span>
              <strong>{proceduralSteps.length}</strong>
            </div>
            <div className="procedural-step-list">
              {proceduralSteps.map((step) => (
                <button
                  key={step.id}
                  type="button"
                  className={activeProceduralStep?.id === step.id ? 'procedural-step-row active' : 'procedural-step-row'}
                  onClick={() => jumpToProceduralStep(step.id)}
                >
                  <strong>{step.label}</strong>
                  <span>{step.notes?.trim() || proceduralStepObjectSummary(proceduralPlan, step.id)}</span>
                </button>
              ))}
            </div>
            {activeProceduralStep ? (
              <p className="muted small procedural-step-current">
                Viewing: {activeProceduralStep.label}
                {proceduralObjectsForStep.length > 0 ? ` · ${proceduralObjectsForStep.length} procedural item${proceduralObjectsForStep.length === 1 ? '' : 's'}` : ''}
              </p>
            ) : null}
          </section>
        ) : null}
        {!asideCollapsed && completedAttempt ? (
          <CaseCompletionSummary attempt={completedAttempt} onFinish={onFinish} />
        ) : !asideCollapsed ? (
          <QuestionPanel
            vascCase={vascCase}
            attemptId={attemptId}
            latestMeasurement={latestMeasurement}
            onComplete={handleComplete}
            onQuestionChange={setActiveQuestionIndex}
            bookmarks={vascCase.bookmarks ?? []}
            onJumpToBookmark={jumpToBookmark}
            proceduralPlan={proceduralPlan}
            activeProceduralStepId={activeProceduralStep?.id}
            onJumpToProceduralStep={jumpToProceduralStep}
          />
        ) : null}
      </aside>
    </div>
  );
}

function proceduralStepObjectSummary(plan: VesselCompositionRow, stepId: string): string {
  const objects = plan.data.proceduralObjects.filter((object) => !object.stepId || object.stepId === stepId);
  if (objects.length === 0) return 'Review the angiographic context for this step.';
  return objects
    .slice(0, 3)
    .map((object) => object.label)
    .join(', ');
}

function CaseCompletionSummary({
  attempt,
  onFinish,
}: {
  attempt: AttemptResult;
  onFinish: () => void;
}) {
  const hintsUsed = attempt.totalHintsUsed ?? attempt.questionResults.reduce((sum, item) => sum + item.hintsUsed, 0);
  const totalElapsedMs =
    attempt.totalElapsedMs ?? attempt.questionResults.reduce((sum, item) => sum + (item.elapsedMs ?? 0), 0);
  const averageElapsedMs = attempt.questionResults.length > 0 ? totalElapsedMs / attempt.questionResults.length : 0;
  const measurementResults = attempt.questionResults.filter((result) => result.type === 'measurement');
  const deviceResults = attempt.questionResults.filter((result) => result.type === 'deviceSelection');

  return (
    <section className="question-card completion-summary">
      <p className="eyebrow">Case complete</p>
      <h3>{attempt.caseTitle}</h3>
      <div className="completion-score">
        <strong>{attempt.score.toFixed(2)} / {attempt.maxScore}</strong>
        <span>{Math.round(attempt.percent)}%</span>
      </div>
      <dl className="completion-detail-grid">
        <div>
          <dt>Correct</dt>
          <dd>{attempt.correctCount ?? attempt.questionResults.filter((result) => result.correct).length} / {attempt.questionResults.length}</dd>
        </div>
        <div>
          <dt>Hints used</dt>
          <dd>{hintsUsed}</dd>
        </div>
        <div>
          <dt>Total time</dt>
          <dd>{formatDuration(totalElapsedMs)}</dd>
        </div>
        <div>
          <dt>Avg / question</dt>
          <dd>{formatDuration(averageElapsedMs)}</dd>
        </div>
        <div>
          <dt>Measurements</dt>
          <dd>{measurementResults.filter((result) => result.correct).length} / {measurementResults.length}</dd>
        </div>
        <div>
          <dt>Device picks</dt>
          <dd>{deviceResults.filter((result) => result.correct).length} / {deviceResults.length}</dd>
        </div>
      </dl>
      <button type="button" className="primary-button" onClick={onFinish}>
        View progress
      </button>
    </section>
  );
}
