import { StatCard } from '../../components/StatCard';
import { clearAttempts, getProgressSummary } from '../../lib/progress';

export function ProgressPage() {
  const progress = getProgressSummary();

  function resetProgress() {
    clearAttempts();
    window.location.reload();
  }

  return (
    <div className="page-stack">
      <header className="page-header split-header">
        <div>
          <p className="eyebrow">Progress</p>
          <h2>Your local learning record</h2>
          <p>v0.1 stores progress in localStorage. Move this to SQLite in the next backend phase.</p>
        </div>
        <button className="secondary-button" onClick={resetProgress}>Reset local progress</button>
      </header>

      <section className="grid-4">
        <StatCard label="Attempts" value={progress.totalAttempts} />
        <StatCard label="Completed cases" value={progress.completedCases} />
        <StatCard label="Average" value={`${Math.round(progress.averagePercent)}%`} />
        <StatCard label="Best" value={progress.bestCase ? `${Math.round(progress.bestCase.percent)}%` : '—'} />
      </section>

      <section className="grid-2">
        <article className="content-card">
          <h3>Category mastery</h3>
          <div className="progress-list">
            {progress.categoryBreakdown.map((category) => (
              <div key={category.categoryId} className="progress-row">
                <div>
                  <strong>{category.categoryTitle}</strong>
                  <span>{category.attempts} attempt{category.attempts === 1 ? '' : 's'}</span>
                </div>
                <div className="progress-bar"><span style={{ width: `${category.averagePercent}%` }} /></div>
                <b>{Math.round(category.averagePercent)}%</b>
              </div>
            ))}
          </div>
        </article>

        <article className="content-card">
          <h3>Recent attempts</h3>
          {progress.attempts.length === 0 ? (
            <p className="muted">No attempts yet. Start the sample AAA case.</p>
          ) : (
            <div className="attempt-list">
              {progress.attempts.slice(0, 6).map((attempt) => (
                <div key={attempt.id} className="attempt-row">
                  <div>
                    <strong>{attempt.caseTitle}</strong>
                    <span>{new Date(attempt.completedAt).toLocaleString()}</span>
                  </div>
                  <b>{attempt.score} / {attempt.maxScore} ({attempt.percent}%)</b>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>
    </div>
  );
}
