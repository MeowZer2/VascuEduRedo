import { useCallback, useEffect, useMemo, useState } from 'react';
import { StatCard } from '../../components/StatCard';
import { isTauriDesktop } from '../../lib/tauri';
import { clearAttempts, getProgressSummary } from '../../lib/progress';
import {
  fetchProgressByCase,
  fetchProgressSummary,
  fetchRecentActivity,
  isReviewAvailable,
  type AttemptSummary,
  type CaseProgress,
  type ProgressSummary,
} from '../../lib/review';
import { AttemptReview } from './AttemptReview';

interface ProgressPageProps {
  refreshKey?: number;
}

export function ProgressPage({ refreshKey = 0 }: ProgressPageProps) {
  if (!isReviewAvailable()) {
    return <BrowserFallbackProgress />;
  }

  return <SqliteBackedProgress refreshKey={refreshKey} />;
}

function SqliteBackedProgress({ refreshKey }: { refreshKey: number }) {
  const [summary, setSummary] = useState<ProgressSummary | null>(null);
  const [byCase, setByCase] = useState<CaseProgress[]>([]);
  const [recent, setRecent] = useState<AttemptSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewingAttemptId, setReviewingAttemptId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [s, c, r] = await Promise.all([
      fetchProgressSummary(),
      fetchProgressByCase(),
      fetchRecentActivity(15),
    ]);
    setSummary(s);
    setByCase(c);
    setRecent(r);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  return (
    <div className="page-stack">
      <header className="page-header split-header progress-hero">
        <div>
          <p className="eyebrow">Progress</p>
          <h2>Your learning record</h2>
          <p>Track completed practice, recent review, and case-level performance on this workstation.</p>
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={() => void refresh()}
          disabled={loading}
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </header>

      <section className="grid-4">
        <StatCard label="Attempts" value={summary?.totalAttempts ?? 0} helper={`${summary?.completedAttempts ?? 0} completed`} />
        <StatCard label="Cases completed" value={summary?.casesCompleted ?? 0} helper={byCase.length ? `${byCase.length} attempted` : undefined} />
        <StatCard
          label="Average"
          value={summary && summary.completedAttempts > 0 ? `${Math.round(summary.averagePercent)}%` : '-'}
          helper={summary && summary.completedAttempts > 0 ? `${summary.averageScore.toFixed(2)} avg pts` : undefined}
        />
        <StatCard
          label="Best"
          value={summary && summary.completedAttempts > 0 ? `${Math.round(summary.bestPercent)}%` : '-'}
          helper={summary && summary.completedAttempts > 0 ? `${summary.bestScore.toFixed(2)} best pts` : undefined}
        />
      </section>

      <section className="grid-4">
        <StatCard label="Questions answered" value={summary?.totalQuestionsAnswered ?? 0} />
        <StatCard
          label="Correct"
          value={summary?.correctAnswers ?? 0}
          helper={
            summary && summary.totalQuestionsAnswered > 0
              ? `${Math.round(summary.accuracyPercent)}% accuracy`
              : undefined
          }
        />
        <StatCard label="Measurements" value={summary?.measurementQuestionsAnswered ?? 0} />
        <StatCard
          label="Avg. measurement error"
          value={
            summary?.averageMeasurementError !== null && summary?.averageMeasurementError !== undefined
              ? `${summary.averageMeasurementError.toFixed(2)} mm`
              : '-'
          }
        />
      </section>

      <section className="grid-2 progress-grid">
        <article className="content-card progress-performance-card">
          <div className="section-title-row">
            <h3>Case performance</h3>
            <span className="pill">{byCase.length} attempted</span>
          </div>
          {byCase.length === 0 ? (
            <div className="empty-state">
              <strong>No completed cases yet</strong>
              <span>Finish a practice session to start building your learning record.</span>
            </div>
          ) : (
            <div className="progress-case-card-list">
              {byCase.map((row) => (
                <div className="progress-case-card" key={row.caseId}>
                  <div>
                    <strong>{row.caseTitle}</strong>
                    <span>{row.category} · {row.completed}/{row.attempts} completed</span>
                  </div>
                  <div className="progress-score-block">
                    <b>{formatPercentScore(row.bestPercent, row.bestScore)}</b>
                    <span>best</span>
                  </div>
                  <div className="progress-bar" aria-label="Average score">
                    <span style={{ width: `${Math.max(0, Math.min(100, row.averagePercent ?? 0))}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="content-card">
          <h3>Recent attempts</h3>
          {recent.length === 0 ? (
            <div className="empty-state">
              <strong>No recent attempts</strong>
              <span>Start practice from Home or Practice to see review-ready attempts here.</span>
            </div>
          ) : (
            <ul className="review-attempt-list">
              {recent.map((attempt) => (
                <li key={attempt.id} className="review-attempt-row">
                  <button
                    type="button"
                    className="review-attempt-button"
                    onClick={() => setReviewingAttemptId(attempt.id)}
                  >
                    <div>
                      <strong>{attempt.caseTitle}</strong>
                      <span className="muted small">
                        {attempt.completedAt
                          ? new Date(attempt.completedAt).toLocaleString()
                          : `Started ${new Date(attempt.startedAt).toLocaleString()} (incomplete)`}
                      </span>
                    </div>
                    <div className="review-attempt-score">
                      {attempt.score !== null && attempt.maxScore > 0
                        ? `${attempt.score.toFixed(2)} / ${attempt.maxScore}`
                        : '-'}
                      {attempt.percent !== null && (
                        <span className="muted small">{Math.round(attempt.percent)}%</span>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>

      {reviewingAttemptId && (
        <AttemptReview
          attemptId={reviewingAttemptId}
          onClose={() => setReviewingAttemptId(null)}
        />
      )}
    </div>
  );
}

function formatPercentScore(percent: number | null, score: number | null): string {
  if (percent === null && score === null) return '-';
  if (percent !== null) return `${Math.round(percent)}%`;
  return score !== null ? score.toFixed(2) : '-';
}

function BrowserFallbackProgress() {
  const progress = useMemo(() => getProgressSummary(), []);
  function resetProgress() {
    clearAttempts();
    window.location.reload();
  }

  if (isTauriDesktop()) return null;
  return (
    <div className="page-stack">
      <header className="page-header split-header progress-hero">
        <div>
          <p className="eyebrow">Progress</p>
          <h2>Preview progress</h2>
          <p>Practice attempts in browser preview are stored locally in this browser.</p>
        </div>
        <button className="secondary-button" onClick={resetProgress}>
          Reset local progress
        </button>
      </header>

      <section className="grid-4">
        <StatCard label="Attempts" value={progress.totalAttempts} />
        <StatCard label="Completed cases" value={progress.completedCases} />
        <StatCard label="Average" value={`${Math.round(progress.averagePercent)}%`} />
        <StatCard label="Best" value={progress.bestCase ? `${Math.round(progress.bestCase.percent)}%` : '-'} />
      </section>

      <section className="content-card">
        <h3>Recent attempts</h3>
        {progress.attempts.length === 0 ? (
          <div className="empty-state">
            <strong>No attempts yet</strong>
            <span>Complete a practice session to begin tracking progress.</span>
          </div>
        ) : (
          <div className="attempt-list">
            {progress.attempts.slice(0, 6).map((attempt) => (
              <div key={attempt.id} className="attempt-row">
                <div>
                  <strong>{attempt.caseTitle}</strong>
                  <span>{new Date(attempt.completedAt).toLocaleString()}</span>
                </div>
                <b>
                  {attempt.score} / {attempt.maxScore} ({attempt.percent}%)
                </b>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
