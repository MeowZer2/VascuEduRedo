import { useEffect, useState } from 'react';
import {
  fetchAttemptDetails,
  formatAnswer,
  formatExpected,
  type AttemptDetails,
  type AttemptQuestionDetail,
} from '../../lib/review';

interface AttemptReviewProps {
  attemptId: string;
  onClose: () => void;
}

export function AttemptReview({ attemptId, onClose }: AttemptReviewProps) {
  const [details, setDetails] = useState<AttemptDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchAttemptDetails(attemptId)
      .then((data) => {
        if (cancelled) return;
        if (!data) setError('Attempt not found.');
        setDetails(data);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attemptId]);

  // Close on Escape — small UX nicety since the modal covers the page.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <header className="modal-header">
          <div>
            <p className="eyebrow">Attempt review</p>
            <h2>{details?.attempt.caseTitle ?? 'Loading…'}</h2>
            {details && (
              <p className="muted">
                {details.attempt.completedAt
                  ? `Completed ${new Date(details.attempt.completedAt).toLocaleString()}`
                  : `Started ${new Date(details.attempt.startedAt).toLocaleString()} (incomplete)`}
              </p>
            )}
          </div>
          <button type="button" className="secondary-button" onClick={onClose} aria-label="Close">
            Close ✕
          </button>
        </header>

        {loading && <p className="muted">Loading attempt…</p>}
        {error && <p className="admin-banner error">{error}</p>}

        {details && (
          <>
            <section className="grid-4 review-stats">
              <article className="stat-card">
                <span>Score</span>
                <strong>
                  {details.attempt.score !== null ? details.attempt.score.toFixed(2) : '—'}
                  {details.attempt.maxScore > 0 ? ` / ${details.attempt.maxScore}` : ''}
                </strong>
                {details.attempt.percent !== null && <small>{Math.round(details.attempt.percent)}%</small>}
              </article>
              <article className="stat-card">
                <span>Correct</span>
                <strong>
                  {details.questions.filter((q) => q.isCorrect === true).length} /{' '}
                  {details.questions.length}
                </strong>
              </article>
              <article className="stat-card">
                <span>Status</span>
                <strong>{details.attempt.completedAt ? 'Completed' : 'Incomplete'}</strong>
              </article>
              <article className="stat-card">
                <span>Started</span>
                <strong>{new Date(details.attempt.startedAt).toLocaleDateString()}</strong>
                <small>{new Date(details.attempt.startedAt).toLocaleTimeString()}</small>
              </article>
            </section>

            <ol className="review-question-list">
              {details.questions.map((q, idx) => (
                <ReviewQuestion key={q.questionId} question={q} index={idx} />
              ))}
              {details.questions.length === 0 && (
                <li>
                  <p className="muted">This case has no questions.</p>
                </li>
              )}
            </ol>
          </>
        )}
      </div>
    </div>
  );
}

function ReviewQuestion({ question, index }: { question: AttemptQuestionDetail; index: number }) {
  const status =
    question.isCorrect === null ? 'skipped' : question.isCorrect ? 'correct' : 'incorrect';
  const explanation = (question.questionData.explanation as string | undefined) ?? '';

  return (
    <li className={`review-question review-question-${status}`}>
      <header className="review-question-head">
        <div>
          <span className="review-index">Q{index + 1}</span>
          <span className={`review-status review-status-${status}`}>
            {status === 'correct' ? 'Correct' : status === 'incorrect' ? 'Incorrect' : 'Not answered'}
          </span>
          <span className="muted small">
            {question.type} · {question.points} pt{question.points === 1 ? '' : 's'}
          </span>
        </div>
      </header>
      <p className="review-prompt">{question.prompt}</p>

      <dl className="review-detail-list">
        <div>
          <dt>Your answer</dt>
          <dd>{formatAnswer(question.type, question.questionData, question.answer)}</dd>
        </div>
        <div>
          <dt>{question.type === 'shortText' ? 'Accepted' : 'Expected'}</dt>
          <dd>{formatExpected(question.type, question.questionData)}</dd>
        </div>
      </dl>

      {question.measurement && <MeasurementSummary measurement={question.measurement} />}

      {explanation && (
        <p className="review-explanation">
          <strong>Why:</strong> {explanation}
        </p>
      )}
    </li>
  );
}

function MeasurementSummary({
  measurement,
}: {
  measurement: NonNullable<AttemptQuestionDetail['measurement']>;
}) {
  const { plane, unit, correctValue, tolerance, submittedValue, difference, withinTolerance } =
    measurement;
  const planeLabel = plane.charAt(0).toUpperCase() + plane.slice(1);
  return (
    <div
      className={
        withinTolerance === true
          ? 'measurement-readout has-value'
          : withinTolerance === false
            ? 'measurement-readout no-value review-measurement-miss'
            : 'measurement-readout no-value'
      }
    >
      <div className="review-measurement-grid">
        <div>
          <span className="measurement-readout-label">Plane</span>
          <strong>{planeLabel}</strong>
        </div>
        <div>
          <span className="measurement-readout-label">Submitted</span>
          <strong>
            {submittedValue !== null ? `${submittedValue.toFixed(2)} ${unit}` : '— no measurement'}
          </strong>
        </div>
        <div>
          <span className="measurement-readout-label">Expected</span>
          <strong>
            {correctValue} ± {tolerance} {unit}
          </strong>
        </div>
        <div>
          <span className="measurement-readout-label">Difference</span>
          <strong>{difference !== null ? `${difference.toFixed(2)} ${unit}` : '—'}</strong>
        </div>
      </div>
    </div>
  );
}
