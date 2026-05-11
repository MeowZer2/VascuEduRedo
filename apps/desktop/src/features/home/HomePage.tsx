import { StatCard } from '../../components/StatCard';
import { categories } from '../../data/sampleContent';
import { getProgressSummary } from '../../lib/progress';
import type { VascCase } from '../../types';

interface HomePageProps {
  cases: VascCase[];
  onStart: () => void;
  onOpenCases: () => void;
}

export function HomePage({ cases, onStart, onOpenCases }: HomePageProps) {
  const progress = getProgressSummary();

  return (
    <div className="page-stack">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">VascEdu</p>
          <h2>Vascular imaging practice for clinical decision-making.</h2>
          <p>
            Build confidence reading CTA, making measurements, selecting devices, and reviewing
            feedback in focused practice sessions.
          </p>
          <div className="hero-actions">
            <button className="primary-button" onClick={onStart}>Start guided practice</button>
            <button className="secondary-button" onClick={onOpenCases}>Browse cases</button>
          </div>
        </div>
        <div className="hero-card">
          <strong>Practice loop</strong>
          <span>Inspect imaging, answer, measure, review feedback</span>
        </div>
      </section>

      <section className="grid-4">
        <StatCard label="Cases" value={cases.length} helper="library cases" />
        <StatCard label="Topics" value={categories.length} helper="vascular modules" />
        <StatCard label="Attempts" value={progress.totalAttempts} helper="local progress" />
        <StatCard label="Average" value={`${Math.round(progress.averagePercent)}%`} helper="across attempts" />
      </section>

      <section className="content-card">
        <h3>Designed for focused review</h3>
        <p>
          Use Cases when you want to open a specific scenario. Use Practice when you want a guided
          session by topic, level, or learning mode.
        </p>
      </section>
    </div>
  );
}
