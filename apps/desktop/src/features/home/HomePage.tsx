import type { CSSProperties } from 'react';
import { StatCard } from '../../components/StatCard';
import { categories } from '../../data/sampleContent';
import { getProgressSummary } from '../../lib/progress';
import type { VascCase } from '../../types';
import { getCategoryBackground } from '../cases/categoryBackgrounds';

interface HomePageProps {
  cases: VascCase[];
  onStart: () => void;
  onOpenCases: () => void;
  onOpenPlanning: () => void;
}

export function HomePage({ cases, onStart, onOpenCases, onOpenPlanning }: HomePageProps) {
  const progress = getProgressSummary();
  const featuredCase = cases[0];
  const recentCases = cases.slice(0, 3);

  return (
    <div className="page-stack">
      <section className="hero-panel home-hero">
        <div className="hero-copy">
          <p className="eyebrow">VascEdu training platform</p>
          <h2>Vascular imaging practice with procedural context.</h2>
          <p>
            Review CT, make measurements, reason through cases, and connect imaging findings to
            endovascular planning in one local desktop workspace.
          </p>
          <div className="hero-actions">
            <button className="primary-button" onClick={onStart}>Start practice</button>
            <button className="secondary-button" onClick={onOpenCases}>Browse cases</button>
            <button className="secondary-button" onClick={onOpenPlanning}>Open planning</button>
          </div>
        </div>
        <div className="hero-image-card vascular-visual-card">
          <div className="vascular-visual-lumen" />
          <div>
            <strong>CTA + Angiogram</strong>
            <span>Imaging interpretation, measurements, device strategy, and review</span>
          </div>
        </div>
      </section>

      <section className="grid-4">
        <StatCard label="Cases" value={cases.length} helper="library cases" />
        <StatCard label="Topics" value={categories.length} helper="vascular modules" />
        <StatCard label="Attempts" value={progress.totalAttempts} helper="local progress" />
        <StatCard label="Average" value={`${Math.round(progress.averagePercent)}%`} helper="across attempts" />
      </section>

      <section className="dashboard-grid">
        <article className="content-card continue-card">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Continue</p>
              <h3>{featuredCase ? featuredCase.title : 'No cases loaded yet'}</h3>
            </div>
            <span className="pill">{featuredCase ? featuredCase.difficulty : 'Library empty'}</span>
          </div>
          <p className="muted">
            {featuredCase
              ? featuredCase.diagnosis
              : 'Add cases from Admin to begin building a training library on this workstation.'}
          </p>
          <div className="hero-actions compact-actions">
            <button className="primary-button" onClick={onStart} disabled={!featuredCase}>Start practice</button>
            <button className="secondary-button" onClick={onOpenCases}>Open library</button>
          </div>
        </article>

        <article className="content-card progress-snapshot-card">
          <p className="eyebrow">Progress snapshot</p>
          <div className="progress-ring" style={{ '--progress': `${Math.round(progress.averagePercent)}%` } as CSSProperties}>
            <strong>{Math.round(progress.averagePercent)}%</strong>
            <span>average</span>
          </div>
          <p className="muted">{progress.totalAttempts} practice attempt{progress.totalAttempts === 1 ? '' : 's'} recorded locally.</p>
        </article>
      </section>

      <section className="module-showcase">
        {categories.map((category) => (
          <article
            key={category.id}
            className="module-card"
            style={{ '--module-bg': `url(${getCategoryBackground(category.id) ?? ''})` } as CSSProperties}
          >
            <span className="pill">{cases.filter((item) => item.categoryId === category.id).length} cases</span>
            <h3>{category.title}</h3>
            <p>{category.description}</p>
          </article>
        ))}
      </section>

      <section className="content-card recent-activity-card">
        <div className="section-title-row">
          <h3>Recent case activity</h3>
          <button className="secondary-button small" onClick={onOpenCases}>View all</button>
        </div>
        {recentCases.length === 0 ? (
          <div className="empty-state">
            <strong>Your dashboard is ready</strong>
            <span>Add or import cases to populate practice recommendations and recent activity.</span>
          </div>
        ) : (
          <div className="recent-case-strip">
            {recentCases.map((item) => (
              <div key={item.id} className="recent-case-card">
                <strong>{item.title}</strong>
                <span>{item.diagnosis}</span>
                <small>{item.estimatedMinutes} min · {item.difficulty}</small>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
