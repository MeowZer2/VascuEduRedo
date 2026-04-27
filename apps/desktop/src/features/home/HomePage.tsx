import { StatCard } from '../../components/StatCard';
import { categories, cases } from '../../data/sampleContent';
import { getProgressSummary } from '../../lib/progress';

interface HomePageProps {
  onStart: () => void;
  onOpenCases: () => void;
}

export function HomePage({ onStart, onOpenCases }: HomePageProps) {
  const progress = getProgressSummary();

  return (
    <div className="page-stack">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">VascEdu v0.1</p>
          <h2>Case-based vascular imaging education.</h2>
          <p>
            Start with one excellent learning loop: review the case, inspect CTA, answer questions, read explanations,
            and track your progress.
          </p>
          <div className="hero-actions">
            <button className="primary-button" onClick={onStart}>Start sample AAA case</button>
            <button className="secondary-button" onClick={onOpenCases}>Browse case library</button>
          </div>
        </div>
        <div className="hero-card">
          <strong>Core loop</strong>
          <span>Case → CTA → Questions → Feedback</span>
        </div>
      </section>

      <section className="grid-4">
        <StatCard label="Cases" value={cases.length} helper="sample content" />
        <StatCard label="Modules" value={categories.length} helper="content-pack ready" />
        <StatCard label="Attempts" value={progress.totalAttempts} helper="local progress" />
        <StatCard label="Average" value={`${Math.round(progress.averagePercent)}%`} helper="across attempts" />
      </section>

      <section className="content-card">
        <h3>Build principle</h3>
        <p>
          This scaffold avoids rebuilding every old feature at once. It gives you a clean foundation for the most important
          VascEdu product identity: vascular imaging cases with structured teaching questions.
        </p>
      </section>
    </div>
  );
}
