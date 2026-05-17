import { ActionTile, ImageBannerCard } from '../../components/learnerCards';
import { getProgressSummary } from '../../lib/progress';
import { actionArt, getCaseCardArt, getHeroArt } from '../../lib/uiImages';
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
  const averagePercent = Math.round(progress.averagePercent);
  const attempts = progress.totalAttempts;
  const featuredArt = featuredCase ? getCaseCardArt(featuredCase) : undefined;

  return (
    <div className="page-stack home-dashboard home-dashboard--minimal">
      <ImageBannerCard
        imageUrl={getHeroArt('home')}
        ratio="hero"
        eyebrow="VascEdu"
        title="Train. Plan. Review."
      >
        <div className="hero-actions">
          <button className="primary-button" onClick={onStart} disabled={!featuredCase}>
            {featuredCase ? 'Continue practice' : 'Start practice'}
          </button>
        </div>
      </ImageBannerCard>

      <section className="home-tile-grid" aria-label="Workspaces">
        <ActionTile
          imageUrl={actionArt.cases}
          label="Cases"
          variant="primary"
          onClick={onOpenCases}
        />
        <ActionTile
          imageUrl={actionArt.planning}
          label="Planning"
          onClick={onOpenPlanning}
        />
        <ActionTile
          imageUrl={actionArt.devices}
          label="Devices"
          onClick={onOpenDevices}
        />
        <ActionTile
          imageUrl={actionArt.progress}
          label="Progress"
          onClick={onOpenProgress}
        />
      </section>

      {featuredCase && (
        <section
          className="home-continue-card"
          style={featuredArt ? { backgroundImage: `url(${featuredArt})` } : undefined}
        >
          <div className="home-continue-overlay" />
          <div className="home-continue-content">
            <p className="eyebrow">Continue</p>
            <h3>{featuredCase.title}</h3>
            <ul className="home-continue-meta">
              <li>{featuredCase.difficulty}</li>
              <li>{featuredCase.estimatedMinutes} min</li>
              {attempts > 0 && <li>{averagePercent}% avg</li>}
            </ul>
            <div className="hero-actions compact-actions">
              <button className="primary-button" onClick={onStart}>Start</button>
              <button className="secondary-button" onClick={() => onOpenCase(featuredCase.id)}>
                Details
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
