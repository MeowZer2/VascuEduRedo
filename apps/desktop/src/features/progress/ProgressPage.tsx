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
  /** Bumped whenever a fresh attempt completes so the page can refetch. */
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
      <header className="page-header split-header">
        <div>
          <p className="eyebrow">Progress</p>
          <h2>Your learning record</h2>
          <p>Stats are live from the local SQLite database.</p>
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={() => void refresh()}
          disabled={loading}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      <section className="grid-4">
        <StatCard
          label="Attempts"
          value={summary?.totalAttempts ?? 0}
          helper={`${summary?.completedAttempts ?? 0} completed`}
        />
        <StatCard
          label="Cases completed"
          value={summary?.casesCompleted ?? 0}
          helper={byCase.length ? `${byCase.length} attempted` : undefined}
        />
        <StatCard
          label="Average"
          value={summary && summary.completedAttempts > 0 ? `${Math.round(summary.averagePercent)}%` : '—'}
          helper={summary && summary.completedAttempts > 0 ? `${summary.averageScore.toFixed(2)} avg pts` : undefined}
        />
        <StatCard
          label="Best"
          value={summary && summary.completedAttempts > 0 ? `${Math.round(summary.bestPercent)}%` : '—'}
          helper={summary && summary.completedAttempts > 0 ? `${summary.bestScore.toFixed(2)} best pts` : undefined}
        />
      </section>

      <section className="grid-4">
        <StatCard
          label="Questions answered"
          value={summary?.totalQuestionsAnswered ?? 0}
        />
        <StatCard
          label="Correct"
          value={summary?.correctAnswers ?? 0}
          helper={
            summary && summary.totalQuestionsAnswered > 0
              ? `${Math.round(summary.accuracyPercent)}% accuracy`
              : undefined
          }
        />
        <StatCard
          label="Measurements"
          value={summary?.measurementQuestionsAnswered ?? 0}
        />
        <StatCard
          label="Avg. measurement error"
          value={
            summary?.averageMeasurementError !== null && summary?.averageMeasurementError !== undefined
              ? `${summary.averageMeasurementError.toFixed(2)} mm`
              : '—'
          }
        />
      </section>

      <section className="grid-2 progress-grid">
        <article className="content-card">
          <h3>Case performance</h3>
          {byCase.length === 0 ? (
            <p className="muted">No attempts yet. Complete a case to see it here.</p>
          ) : (
            <table className="progress-table">
              <thead>
                <tr>
                  <th>Case</th>
                  <th>Attempts</th>
                  <th>Best</th>
                  <th>Latest</th>
                  <th>Avg</th>
                </tr>
              </thead>
              <tbody>
                {byCase.map((row) => (
                  <tr key={row.caseId}>
                    <td>
                      <strong>{row.caseTitle}</strong>
                      <span className="muted small">
                        {row.category} · {row.completed}/{row.attempts} completed
                      </span>
                    </td>
                    <td>{row.attempts}</td>
                    <td>{formatPercentScore(row.bestPercent, row.bestScore)}</td>
                    <td>{formatPercentScore(row.latestPercent, row.latestScore)}</td>
                    <td>{formatPercentScore(row.averagePercent, row.averageScore)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </article>

        <article className="content-card">
          <h3>Recent attempts</h3>
          {recent.length === 0 ? (
            <p className="muted">No attempts yet. Start a case to begin.</p>
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
                        : '—'}
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
  if (percent === null && score === null) return '—';
  if (percent !== null) return `${Math.round(percent)}%`;
  return score !== null ? score.toFixed(2) : '—';
}

/**
 * Pre-SQLite localStorage view, kept for browser/dev builds where Tauri commands
 * aren't available. Same shape as the v0.1 progress page so it doesn't crash.
 */
function BrowserFallbackProgress() {
  const progress = useMemo(() => getProgressSummary(), []);
  function resetProgress() {
    clearAttempts();
    window.location.reload();
  }
  // Only useful in the actual browser dev build; in Tauri we use SqliteBackedProgress.
  if (isTauriDesktop()) return null;
  return (
    <div className="page-stack">
      <header className="page-header split-header">
        <div>
          <p className="eyebrow">Progress</p>
          <h2>Browser preview record</h2>
          <p>Browser mode stores attempts in localStorage. Run the Tauri desktop build for SQLite-backed progress.</p>
        </div>
        <button className="secondary-button" onClick={resetProgress}>
          Reset local progress
        </button>
      </header>

      <section className="grid-4">
        <StatCard label="Attempts" value={progress.totalAttempts} />
        <StatCard label="Completed cases" value={progress.completedCases} />
        <StatCard label="Average" value={`${Math.round(progress.averagePercent)}%`} />
        <StatCard
          label="Best"
          value={progress.bestCase ? `${Math.round(progress.bestCase.percent)}%` : '—'}
        />
      </section>

      <section className="content-card">
        <h3>Recent attempts</h3>
        {progress.attempts.length === 0 ? (
          <p className="muted">No attempts yet.</p>
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
