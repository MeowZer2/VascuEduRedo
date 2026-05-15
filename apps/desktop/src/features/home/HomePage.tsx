import {
  ActionTile,
  ImageBannerCard,
  SectionHeader,
  StatsTile,
  TopicCard,
} from '../../components/learnerCards';
import { categories } from '../../data/sampleContent';
import { getProgressSummary } from '../../lib/progress';
import { actionArt, getHeroArt, getTopicArt } from '../../lib/uiImages';
import type { VascCase } from '../../types';

interface HomePageProps {
  cases: VascCase[];
  onStart: () => void;
  onOpenCases: () => void;
  onOpenPlanning: () => void;
  onOpenCase: (caseId: string) => void;
  onOpenProgress: () => void;
  onOpenDevices: () => void;
}

export function HomePage({
  cases,
  onStart,
  onOpenCases,
  onOpenPlanning,
  onOpenCase,
  onOpenProgress,
  onOpenDevices,
}: HomePageProps) {
  const progress = getProgressSummary();
  const featuredCase = cases[0];
  const recentCases = cases.slice(0, 3);
  const featuredTopics = categories.slice(0, 3);
  const totalCases = cases.length;
  const averagePercent = Math.round(progress.averagePercent);
  const attempts = progress.totalAttempts;

  return (
    <div className="page-stack home-dashboard">
      <ImageBannerCard
        imageUrl={getHeroArt('home')}
        ratio="hero"
        eyebrow="VascEdu dashboard"
        title="Your vascular training cockpit."
        description="Continue practice, review progress, and jump straight into the case library or procedural planning workspace."
      >
        <div className="hero-actions">
          <button className="primary-button" onClick={onStart} disabled={!featuredCase}>
            {featuredCase ? 'Continue practice' : 'Start practice'}
          </button>
          <button className="secondary-button" onClick={onOpenCases}>
            Browse cases
          </button>
          <button className="secondary-button" onClick={onOpenPlanning}>
            Open planning
          </button>
        </div>
      </ImageBannerCard>

      <section className="learner-section dashboard-stats-row">
        <StatsTile label="Cases in library" value={totalCases} caption={totalCases === 0 ? 'Import or author cases to get started' : 'Available now'} />
        <StatsTile label="Practice attempts" value={attempts} caption={attempts === 0 ? 'No sessions yet' : 'Recorded locally'} />
        <StatsTile
          label="Average score"
          value={`${averagePercent}%`}
          caption={attempts === 0 ? 'No score yet' : 'Across all attempts'}
          accent={attempts === 0 ? undefined : averagePercent >= 70 ? 'success' : averagePercent >= 50 ? 'warning' : 'danger'}
        />
      </section>

      <section className="learner-section quick-action-section">
        <SectionHeader
          eyebrow="Quick actions"
          title="Pick up where you left off"
          description="Common shortcuts into the parts of VascEdu you use most."
        />
        <div className="action-tile-row">
          <ActionTile
            imageUrl={actionArt.practice}
            label="Start practice"
            caption="Resume the most recent case flow"
            variant="primary"
            onClick={onStart}
            disabled={!featuredCase}
          />
          <ActionTile
            imageUrl={actionArt.cases}
            label="Cases"
            caption="Discover and filter the case archive"
            onClick={onOpenCases}
          />
          <ActionTile
            imageUrl={actionArt.planning}
            label="Planning"
            caption="Open the procedural composer"
            onClick={onOpenPlanning}
          />
          <ActionTile
            imageUrl={actionArt.devices}
            label="Devices"
            caption="Reference the catalog"
            onClick={onOpenDevices}
          />
        </div>
      </section>

      <section className="learner-section continue-section">
        <SectionHeader
          eyebrow="Continue"
          title="Pick up your last case"
          action={
            <button className="secondary-button small" onClick={onOpenCases}>
              View all cases
            </button>
          }
        />
        <div className="continue-grid">
          <article className="continue-card-feature">
            <div>
              <p className="eyebrow">Featured</p>
              <h3>{featuredCase ? featuredCase.title : 'No cases loaded yet'}</h3>
              <p className="muted">
                {featuredCase
                  ? featuredCase.diagnosis
                  : 'Add cases from Admin to begin building a training library on this workstation.'}
              </p>
              {featuredCase && (
                <ul className="case-tile-meta">
                  <li>{featuredCase.difficulty}</li>
                  <li>{featuredCase.estimatedMinutes} min</li>
                  <li>{featuredCase.questions.length} questions</li>
                </ul>
              )}
            </div>
            <div className="hero-actions compact-actions">
              <button className="primary-button" onClick={onStart} disabled={!featuredCase}>
                Start practice
              </button>
              {featuredCase && (
                <button className="secondary-button" onClick={() => onOpenCase(featuredCase.id)}>
                  Open details
                </button>
              )}
            </div>
          </article>

          <article className="progress-snapshot-card content-card">
            <p className="eyebrow">Progress snapshot</p>
            <div
              className="progress-ring"
              style={{ ['--progress' as string]: `${averagePercent}%` }}
            >
              <strong>{averagePercent}%</strong>
              <span>average</span>
            </div>
            <p className="muted">
              {attempts} practice attempt{attempts === 1 ? '' : 's'} recorded locally.
            </p>
            <button className="secondary-button small" onClick={onOpenProgress}>
              Review progress
            </button>
          </article>
        </div>
      </section>

      <section className="learner-section featured-topics-section">
        <SectionHeader
          eyebrow="Featured tracks"
          title="Vascular topics in focus"
          description="Jump into a specific topic from the case library."
        />
        <div className="topic-card-grid topic-card-grid--compact">
          {featuredTopics.map((category) => (
            <TopicCard
              key={category.id}
              imageUrl={getTopicArt(category.id)}
              title={category.title}
              caseCount={cases.filter((item) => item.categoryId === category.id).length}
              description={category.description}
              onClick={onOpenCases}
              ariaLabel={`Open cases for ${category.title}`}
            />
          ))}
        </div>
      </section>

      <section className="learner-section recent-activity-section">
        <SectionHeader
          eyebrow="Recent activity"
          title="Latest cases"
          action={
            <button className="secondary-button small" onClick={onOpenCases}>
              View all
            </button>
          }
        />
        {recentCases.length === 0 ? (
          <div className="empty-state">
            <strong>Your dashboard is ready</strong>
            <span>
              Add or import cases to populate practice recommendations and recent activity.
            </span>
          </div>
        ) : (
          <div className="recent-case-strip">
            {recentCases.map((item) => (
              <button
                key={item.id}
                type="button"
                className="recent-case-card"
                onClick={() => onOpenCase(item.id)}
              >
                <strong>{item.title}</strong>
                <span>{item.diagnosis}</span>
                <small>{item.estimatedMinutes} min · {item.difficulty}</small>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
