import { type CSSProperties, type PointerEvent as ReactPointerEvent, useEffect, useState } from 'react';
import { NrrdViewer, type ViewerMeasurement } from '../../components/NrrdViewer';
import { createAttempt } from '../../lib/attempts';
import { saveAttempt } from '../../lib/progress';
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

  const activeQuestion = vascCase.questions[activeQuestionIndex];
  const isMeasurementQuestion = activeQuestion?.type === 'measurement';
  const requestedTool = isMeasurementQuestion ? 'distance' as const : undefined;
  const requiredPlane = isMeasurementQuestion ? (activeQuestion as MeasurementQuestion).plane : undefined;

  function handleComplete(attempt: AttemptResult) {
    saveAttempt(attempt);
    setCompletedAttempt(attempt);
  }

  function jumpToBookmark(bookmark: CaseBookmark) {
    setActiveBookmark(bookmark);
    setJumpBookmark({ ...bookmark });
  }

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
          <button className="secondary-button" onClick={onChooseCase}>Change case</button>
        </div>
        {isMeasurementQuestion && requiredPlane ? (
          <div className="measurement-question-banner">
            <span className="measurement-question-banner-icon">📏</span>
            <span>
              Switch to the <strong>{requiredPlane.charAt(0).toUpperCase() + requiredPlane.slice(1)}</strong> plane and use
              the <strong>Distance</strong> tool to measure — then submit from the question panel.
            </span>
          </div>
        ) : null}
        <NrrdViewer
          volumePath={vascCase.volume.path ?? 'sample'}
          description={vascCase.volume.description}
          requestedTool={requestedTool}
          onLatestMeasurementChange={setLatestMeasurement}
          jumpToBookmark={jumpBookmark}
          activeBookmark={activeBookmark}
        />
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
          />
        ) : null}
      </aside>
    </div>
  );
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
