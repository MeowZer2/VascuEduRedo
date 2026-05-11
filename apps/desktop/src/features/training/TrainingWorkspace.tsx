import { useEffect, useState } from 'react';
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

export function TrainingWorkspace({ vascCase, onFinish, onChooseCase }: TrainingWorkspaceProps) {
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

  return (
    <div className="training-layout">
      <section className="training-main">
        <div className="workspace-header">
          <div>
            <p className="eyebrow">Training workspace</p>
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
      <aside className="training-aside">
        {vascCase.bookmarks && vascCase.bookmarks.length > 0 ? (
          <section className="question-card key-findings-panel">
            <h3>Key findings</h3>
            <div className="key-finding-list">
              {vascCase.bookmarks.map((bookmark) => (
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
          </section>
        ) : null}
        {completedAttempt ? (
          <CaseCompletionSummary attempt={completedAttempt} onFinish={onFinish} />
        ) : (
          <QuestionPanel
            vascCase={vascCase}
            attemptId={attemptId}
            latestMeasurement={latestMeasurement}
            onComplete={handleComplete}
            onQuestionChange={setActiveQuestionIndex}
            bookmarks={vascCase.bookmarks ?? []}
            onJumpToBookmark={jumpToBookmark}
          />
        )}
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
