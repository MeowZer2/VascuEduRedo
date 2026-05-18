import { type CSSProperties, useCallback, useEffect, useMemo, useState } from 'react';
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
  const [tab, setTab] = useState<'overview' | 'cases' | 'topics'>('overview');

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

  const activityValues = useMemo(() => activityFromRecent(recent), [recent]);
  const focusAreas = useMemo(() => {
    return byCase
      .filter((row) => row.averagePercent !== null)
      .slice()
      .sort((a, b) => (a.averagePercent ?? 100) - (b.averagePercent ?? 100))
      .slice(0, 4);
  }, [byCase]);

  return (
    <div className="page progress-redesign">
      <header className="page-head">
        <div>
          <div className="page-eyebrow">Performance - learning record</div>
          <h1 className="page-title">Your learning record</h1>
          <p className="page-subtitle">
            Track completed practice, review recent attempts, and identify topics to focus on next.
          </p>
        </div>
        <div className="flex">
          <div className="segmented" role="group" aria-label="Progress view">
            <button
              type="button"
              className={tab === 'overview' ? 'active' : ''}
              onClick={() => setTab('overview')}
            >
              Overview
            </button>
            <button
              type="button"
              className={tab === 'cases' ? 'active' : ''}
              onClick={() => setTab('cases')}
            >
              By case
            </button>
            <button
              type="button"
              className={tab === 'topics' ? 'active' : ''}
              onClick={() => setTab('topics')}
            >
              By topic
            </button>
          </div>
          <button type="button" className="btn secondary" onClick={() => void refresh()} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </header>

      <section className="grid grid-4">
        <MetricTile label="Attempts" value={summary?.totalAttempts ?? 0} sub={`${summary?.completedAttempts ?? 0} completed`} />
        <MetricTile label="Cases completed" value={summary?.casesCompleted ?? 0} sub={byCase.length ? `${byCase.length} attempted` : 'No case attempts'} />
        <MetricTile
          label="Average"
          value={summary && summary.completedAttempts > 0 ? `${Math.round(summary.averagePercent)}%` : '-'}
          sub={summary && summary.completedAttempts > 0 ? `${summary.averageScore.toFixed(2)} avg pts` : 'Awaiting completed attempts'}
        />
        <MetricTile
          label="Best"
          value={summary && summary.completedAttempts > 0 ? `${Math.round(summary.bestPercent)}%` : '-'}
          sub={summary && summary.completedAttempts > 0 ? `${summary.bestScore.toFixed(2)} best pts` : 'No best score yet'}
        />
      </section>

      {tab !== 'cases' && (
      <section className="grid grid-12">
        <article className="card col-7">
          <div className="section-head">
            <div>
              <h3>Practice activity</h3>
              <p>Sessions logged over the last 14 days.</p>
            </div>
          </div>
          <SparkBars values={activityValues} />
          <hr className="divider progress-divider" />
          <div className="grid grid-4 progress-mini-stats">
            <MiniStat label="Sessions" value={summary?.totalAttempts ?? 0} />
            <MiniStat label="Questions" value={summary?.totalQuestionsAnswered ?? 0} />
            <MiniStat label="Accuracy" value={summary ? `${Math.round(summary.accuracyPercent)}%` : '-'} />
            <MiniStat
              label="Avg error"
              value={
                summary?.averageMeasurementError !== null && summary?.averageMeasurementError !== undefined
                  ? `${summary.averageMeasurementError.toFixed(1)} mm`
                  : '-'
              }
            />
          </div>
        </article>

        <article className="card col-5 progress-mastery-card">
          <RingMeter percent={summary?.averagePercent ?? 0} label="Avg score" />
          <div>
            <div className="section-head compact">
              <div>
                <h3>Mastery</h3>
                <p>Case-level averages by recent topic.</p>
              </div>
            </div>
            <div className="mastery-list">
              {byCase.slice(0, 5).map((row) => {
                const pct = Math.max(0, Math.min(100, row.averagePercent ?? 0));
                return (
                  <div key={row.caseId}>
                    <div className="between mastery-row-head">
                      <span>{row.category}</span>
                      <span className="mono">{Math.round(pct)}%</span>
                    </div>
                    <div className="bar">
                      <span style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
              {byCase.length === 0 ? <p className="muted">Finish practice to populate mastery.</p> : null}
            </div>
          </div>
        </article>
      </section>
      )}

      {tab !== 'topics' && (
      <section className="card">
        <div className="section-head">
          <div>
            <h3>Case performance</h3>
            <p>Average and best score across all attempts for each case.</p>
          </div>
          <span className="pill pill-mono">{byCase.length} attempted</span>
        </div>
        {byCase.length === 0 ? (
          <div className="empty-state">
            <strong>No completed cases yet</strong>
            <span>Finish a practice session to start building your learning record.</span>
          </div>
        ) : (
          <div className="progress-case-table">
            {byCase.map((row) => {
              const pct = Math.max(0, Math.min(100, row.averagePercent ?? 0));
              return (
                <div className="progress-case-row" key={row.caseId}>
                  <div>
                    <strong>{row.caseTitle}</strong>
                    <span>
                      {row.category} - {row.completed}/{row.attempts} completed
                    </span>
                  </div>
                  <div>
                    <strong>{formatPercentScore(row.bestPercent, row.bestScore)}</strong>
                    <span>best</span>
                  </div>
                  <div>
                    <div className="between progress-row-label">
                      <span>Average</span>
                      <span className="mono">{Math.round(pct)}%</span>
                    </div>
                    <div className="bar thin">
                      <span style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
      )}

      {tab !== 'cases' && (
      <section className="grid grid-12">
        <article className="card col-7">
          <div className="section-head">
            <div>
              <h3>Recent attempts</h3>
              <p>Use Review to open attempt details.</p>
            </div>
          </div>
          {recent.length === 0 ? (
            <div className="empty-state">
              <strong>No recent attempts</strong>
              <span>Start practice from Home or Practice to see review-ready attempts here.</span>
            </div>
          ) : (
            <table className="table progress-attempt-table">
              <thead>
                <tr>
                  <th>Case</th>
                  <th>Date</th>
                  <th style={{ textAlign: 'right' }}>Score</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {recent.map((attempt) => (
                  <tr key={attempt.id}>
                    <td>
                      <strong>{attempt.caseTitle}</strong>
                      <span className="muted small">
                        {attempt.completedAt ? 'Completed' : 'Started'} {formatDate(attempt.completedAt ?? attempt.startedAt)}
                      </span>
                    </td>
                    <td className="mono muted">{formatDate(attempt.completedAt ?? attempt.startedAt)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <span className="mono">
                        {attempt.score !== null && attempt.maxScore > 0
                          ? `${attempt.score.toFixed(2)} / ${attempt.maxScore}`
                          : '-'}
                      </span>
                      {attempt.percent !== null ? (
                        <span className="muted mono score-percent">{Math.round(attempt.percent)}%</span>
                      ) : null}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button type="button" className="btn ghost small" onClick={() => setReviewingAttemptId(attempt.id)}>
                        Review
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </article>

        <article className="card col-5">
          <div className="section-head">
            <div>
              <h3>Suggested focus areas</h3>
              <p>Lowest average performance among attempted cases.</p>
            </div>
          </div>
          <div className="focus-list">
            {focusAreas.length > 0 ? (
              focusAreas.map((row) => (
                <div className="focus-row" key={row.caseId}>
                  <span className="focus-rail" />
                  <div>
                    <strong>{row.caseTitle}</strong>
                    <span>
                      {row.category} - {formatPercentScore(row.averagePercent, row.averageScore)} average
                    </span>
                  </div>
                  <span className="pill pill-mono">{row.attempts} attempts</span>
                </div>
              ))
            ) : (
              <div className="empty-state compact">
                <strong>No focus areas yet</strong>
                <span>Complete more cases to generate recommendations.</span>
              </div>
            )}
          </div>
        </article>
      </section>
      )}

      {reviewingAttemptId && (
        <AttemptReview
          attemptId={reviewingAttemptId}
          onClose={() => setReviewingAttemptId(null)}
        />
      )}
    </div>
  );
}

function BrowserFallbackProgress() {
  const progress = useMemo(() => getProgressSummary(), []);
  function resetProgress() {
    const confirmed =
      typeof window === 'undefined' ||
      window.confirm(
        "Clear this profile's local browser-preview attempts? This cannot be undone and does not affect other profiles or desktop data.",
      );
    if (!confirmed) return;
    clearAttempts();
    window.location.reload();
  }

  if (isTauriDesktop()) return null;
  return (
    <div className="page progress-redesign">
      <header className="page-head">
        <div>
          <div className="page-eyebrow">Progress - browser preview</div>
          <h1 className="page-title">Preview progress</h1>
          <p className="page-subtitle">Practice attempts in browser preview are stored locally in this browser.</p>
        </div>
        <button className="btn secondary" onClick={resetProgress}>
          Reset local progress
        </button>
      </header>

      <section className="grid grid-4">
        <MetricTile label="Attempts" value={progress.totalAttempts} />
        <MetricTile label="Completed cases" value={progress.completedCases} />
        <MetricTile label="Average" value={`${Math.round(progress.averagePercent)}%`} />
        <MetricTile label="Best" value={progress.bestCase ? `${Math.round(progress.bestCase.percent)}%` : '-'} />
      </section>

      <section className="grid grid-12">
        <article className="card col-7">
          <div className="section-head">
            <div>
              <h3>Recent attempts</h3>
              <p>Local browser-only attempt history.</p>
            </div>
          </div>
          {progress.attempts.length === 0 ? (
            <div className="empty-state">
              <strong>No attempts yet</strong>
              <span>Complete a practice session to begin tracking progress.</span>
            </div>
          ) : (
            <div className="progress-case-table">
              {progress.attempts.slice(0, 6).map((attempt) => (
                <div className="progress-case-row compact" key={attempt.id}>
                  <div>
                    <strong>{attempt.caseTitle}</strong>
                    <span>{formatDate(attempt.completedAt)}</span>
                  </div>
                  <div>
                    <strong>{attempt.percent}%</strong>
                    <span>{attempt.score} / {attempt.maxScore}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="card col-5">
          <div className="section-head">
            <div>
              <h3>Topic breakdown</h3>
              <p>Average by sample topic.</p>
            </div>
          </div>
          <div className="mastery-list">
            {progress.categoryBreakdown.map((row) => (
              <div key={row.categoryId}>
                <div className="between mastery-row-head">
                  <span>{row.categoryTitle}</span>
                  <span className="mono">{Math.round(row.averagePercent)}%</span>
                </div>
                <div className="bar">
                  <span style={{ width: `${Math.max(0, Math.min(100, row.averagePercent))}%` }} />
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}

function MetricTile({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <article className="metric-tile">
      <div>
        <div className="label">{label}</div>
        <div className="value">{value}</div>
        {sub ? <div className="sub">{sub}</div> : null}
      </div>
    </article>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div className="mono mini-stat-value">{value}</div>
    </div>
  );
}

function RingMeter({ percent, label }: { percent: number; label: string }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="ring" style={{ '--p': clamped } as CSSProperties}>
      <div className="ring-inner">
        <strong>{Math.round(clamped)}%</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}

function SparkBars({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  return (
    <div className="spark progress-spark" aria-hidden="true">
      {values.map((value, index) => (
        <i
          key={`${index}-${value}`}
          className={index === values.length - 1 ? 'now' : undefined}
          style={{ height: `${Math.max(6, (value / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

function activityFromRecent(recent: AttemptSummary[]): number[] {
  const days = Array.from({ length: 14 }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (13 - index));
    return date;
  });
  return days.map((day) => {
    const next = new Date(day);
    next.setDate(day.getDate() + 1);
    return recent.filter((attempt) => {
      const raw = attempt.completedAt ?? attempt.startedAt;
      const date = new Date(raw);
      return date >= day && date < next;
    }).length;
  });
}

function formatPercentScore(percent: number | null, score: number | null): string {
  if (percent === null && score === null) return '-';
  if (percent !== null) return `${Math.round(percent)}%`;
  return score !== null ? score.toFixed(2) : '-';
}

function formatDate(value: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}
