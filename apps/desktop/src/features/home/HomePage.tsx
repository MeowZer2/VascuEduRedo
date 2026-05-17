import { useMemo } from 'react';
import { anatomyIcon, IcArrowRight, IcArrowUpRight, IcBranch, IcCheck, IcClock, IcKey, IcPlay, IcUser } from '../../components/prototype/icons';
import { Pill, PhotoLayers, Ring, SectionHead, Spark, StatCard, Thumb, TILE_CONTENT } from '../../components/prototype/primitives';
import { ScanAAA } from '../../components/prototype/scans';
import { categories } from '../../data/sampleContent';
import { getCaseCardArt, getHeroArt, getTopicArt } from '../../lib/uiImages';
import type { VascCase } from '../../types';
import { useHomeDashboard } from './useHomeDashboard';

interface HomePageProps {
  cases: VascCase[];
  refreshKey?: number;
  onStart: () => void;
  onOpenCases: () => void;
  onOpenPlanning: () => void;
  onOpenCase: (caseId: string) => void;
  onOpenProgress: () => void;
  onOpenDevices: () => void;
}

const CATEGORY_SHORT: Record<string, string> = {
  aaa: 'AAA',
  cerebrovascular: 'Carotid',
  'mesenteric-renal': 'Visceral',
  pad: 'PAD',
  venous: 'Venous',
  'dialysis-access': 'Access',
  thoracic: 'Thoracic',
};

function shortName(categoryId: string): string {
  return CATEGORY_SHORT[categoryId] ?? categories.find((c) => c.id === categoryId)?.title ?? 'Vascular';
}

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatDuration(ms: number | null): string {
  if (!ms || !Number.isFinite(ms)) return '-';
  const totalMinutes = Math.max(1, Math.round(ms / 60000));
  return `${totalMinutes}m`;
}

function formatScore(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function HomePage({
  cases,
  refreshKey = 0,
  onStart,
  onOpenCases,
  onOpenCase,
  onOpenProgress,
}: HomePageProps) {
  const dashboard = useHomeDashboard({ cases, refreshKey });
  const featured = cases[0];
  const continued = useMemo(() => {
    const recentCases = dashboard.continueCaseIds
      .map((caseId) => cases.find((item) => item.id === caseId))
      .filter((item): item is VascCase => Boolean(item));
    return (recentCases.length > 0 ? recentCases : cases).slice(0, 3);
  }, [cases, dashboard.continueCaseIds]);
  const recentAttemptByCase = useMemo(() => {
    const map = new Map<string, (typeof dashboard.recentAttempts)[number]>();
    dashboard.recentAttempts.forEach((attempt) => {
      if (!map.has(attempt.caseId)) map.set(attempt.caseId, attempt);
    });
    return map;
  }, [dashboard.recentAttempts]);
  const averagePercent = Math.round(dashboard.summary.averagePercent);
  const attempts = dashboard.summary.attempts;
  const completedCases = dashboard.summary.completedCases;
  const bestPercent =
    dashboard.summary.bestPercent !== null ? Math.round(dashboard.summary.bestPercent) : null;
  const hasCompletedAttempts = dashboard.summary.hasCompletedAttempts;
  const progressSource =
    dashboard.source === 'sqlite'
      ? 'Profile SQLite - same source as Progress'
      : dashboard.fallbackReason === 'review-unavailable'
        ? 'Browser fallback - stored in this profile'
        : 'Local fallback - SQLite progress unavailable';
  const heroArt = getHeroArt('home');

  return (
    <div className="page">
      {/* Hero — featured continue card */}
      <section className="hero frame-corners">
        <span className="corner tl" />
        <span className="corner tr" />
        <span className="corner bl" />
        <span className="corner br" />
        <div>
          <div className="hero-tag">
            <span className="signal" />
            Session · resume where you left off
          </div>
          <h2>
            Pre-operative <span className="display-italic">planning</span> for vascular practice.
          </h2>
          <p>
            {featured
              ? `Continue with “${featured.title}” or browse the full case library to pick a new focus.`
              : 'Add cases to the library to start a guided practice session.'}
          </p>
          <div className="hero-meta">
            {featured && (
              <div>
                <IcClock size={13} /> {featured.estimatedMinutes} min
              </div>
            )}
            {featured && (
              <div>
                <IcKey size={13} /> {featured.questions.length} questions
              </div>
            )}
            <div>
              <IcBranch size={13} /> {completedCases} cases completed
            </div>
            <div>
              <IcUser size={13} /> {attempts} attempts logged
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 22 }}>
            <button className="btn primary" onClick={onStart} disabled={!featured}>
              <IcPlay size={14} /> {featured ? 'Resume case' : 'Start practice'}
            </button>
            <button className="btn secondary" onClick={onOpenCases}>
              Browse library
            </button>
          </div>
        </div>
        <div className="hero-art">
          {heroArt ? (
            <div
              aria-hidden
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: 'var(--r-md)',
                overflow: 'hidden',
                backgroundImage: `url(${heroArt})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
            />
          ) : (
            <ScanAAA wide />
          )}
        </div>
      </section>

      {/* Quick stats row */}
      <section className="grid grid-4">
        <StatCard
          label="Cases attempted"
          value={String(completedCases)}
          sub={`of ${cases.length} in library`}
        />
        <StatCard
          label="Avg. score"
          value={hasCompletedAttempts ? String(averagePercent) : '-'}
          unit={hasCompletedAttempts ? '%' : undefined}
          sub="across all attempts"
        />
        <StatCard
          label="Best score"
          value={bestPercent !== null ? String(bestPercent) : '-'}
          unit={bestPercent !== null ? '%' : undefined}
          sub={dashboard.summary.bestCaseTitle ?? 'No attempts yet'}
        />
        <StatCard label="Attempts" value={String(attempts)} sub="practice sessions" />
      </section>

      {/* Continue learning / Activity */}
      <section className="grid grid-12">
        <div className="card col-7">
          <SectionHead
            title="Continue learning"
            subtitle="Pick up where you left off, or move to your next planned topic."
            action={
              <button className="btn ghost small" onClick={onOpenCases}>
                View all <IcArrowRight size={12} />
              </button>
            }
          />
          <div style={{ display: 'grid', gap: 12 }}>
            {continued.map((item) => {
              const recentAttempt = recentAttemptByCase.get(item.id);
              return (
              <button
                key={item.id}
                onClick={() => onOpenCase(item.id)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '96px 1fr auto',
                  gap: 14,
                  padding: 10,
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                  textAlign: 'left',
                  background: 'rgba(255,255,255,0.015)',
                  transition: 'all 140ms ease',
                }}
              >
                <div style={{ width: 96, height: 64, borderRadius: 8, overflow: 'hidden' }}>
                  <Thumb imageUrl={getCaseCardArt(item)} categoryId={item.categoryId} wide label="" />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                    <Pill variant="accent" mono>
                      {shortName(item.categoryId)}
                    </Pill>
                    <Pill mono>{item.difficulty}</Pill>
                  </div>
                  <strong
                    style={{
                      fontSize: 13.5,
                      display: 'block',
                      fontWeight: 600,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {item.title}
                  </strong>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {item.questions.length} questions · {item.estimatedMinutes} min
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {recentAttempt?.percent !== null && recentAttempt?.percent !== undefined ? (
                    <Pill variant="success" mono>
                      <IcCheck size={11} /> {Math.round(recentAttempt.percent)}%
                    </Pill>
                  ) : null}
                  <IcArrowRight size={16} className="muted" />
                </div>
              </button>
              );
            })}
            {continued.length === 0 && (
              <div className="empty">
                <strong>No cases yet</strong>
                Add cases from the authoring workspace to start practising.
              </div>
            )}
          </div>
        </div>

        <div className="card col-5">
          <SectionHead
            title="Practice activity"
            subtitle="Sessions over the last 14 days"
            action={<Pill mono>14d</Pill>}
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 24, alignItems: 'center' }}>
            <Spark values={dashboard.activity} />
            <Ring percent={hasCompletedAttempts ? averagePercent : 0} label="Avg score" size={108} />
          </div>
          <hr className="divider" style={{ margin: '16px 0' }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14 }}>
            <div>
              <div className="stat-label" style={{ fontSize: 10 }}>
                Best
              </div>
              <div className="mono" style={{ fontSize: 18, fontWeight: 600, marginTop: 2 }}>
                {bestPercent !== null ? `${bestPercent}%` : '-'}
              </div>
            </div>
            <div>
              <div className="stat-label" style={{ fontSize: 10 }}>
                Completed
              </div>
              <div className="mono" style={{ fontSize: 18, fontWeight: 600, marginTop: 2 }}>
                {completedCases}
              </div>
            </div>
            <div>
              <div className="stat-label" style={{ fontSize: 10 }}>
                Attempts
              </div>
              <div className="mono" style={{ fontSize: 18, fontWeight: 600, marginTop: 2 }}>
                {attempts}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Topic shortcuts */}
      <section>
        <SectionHead
          eyebrow="Topics"
          title="Jump into a topic"
          subtitle="Each vascular track groups progressive cases."
        />
        <div className="grid grid-3">
          {categories.map((cat) => {
            const Icon = anatomyIcon(cat.id);
            const count = cases.filter((item) => item.categoryId === cat.id).length;
            return (
              <button key={cat.id} className="tile" onClick={onOpenCases}>
                <PhotoLayers imageUrl={getTopicArt(cat.id)} />
                <div className="tile-ic" style={TILE_CONTENT}>
                  <Icon size={20} />
                </div>
                <div style={TILE_CONTENT}>
                  <h4>{cat.title}</h4>
                  <p>{cat.description}</p>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 'auto', ...TILE_CONTENT }}>
                  <Pill mono>
                    {count} case{count === 1 ? '' : 's'}
                  </Pill>
                </div>
                <span className="tile-arrow">
                  <IcArrowUpRight />
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Recent attempts */}
      <section className="card">
        <SectionHead
          title="Recent attempts"
          subtitle={dashboard.loading ? 'Loading profile progress' : progressSource}
          action={
            <button className="btn ghost small" onClick={onOpenProgress}>
              Open progress <IcArrowRight size={12} />
            </button>
          }
        />
        {dashboard.recentAttempts.length === 0 ? (
          <div className="empty">
            <strong>No attempts recorded</strong>
            Complete a practice session to see it here.
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Case</th>
                <th>Date</th>
                <th style={{ textAlign: 'right' }}>Duration</th>
                <th style={{ textAlign: 'right' }}>Score</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {dashboard.recentAttempts.slice(0, 5).map((a) => (
                <tr key={a.id}>
                  <td>{a.caseTitle}</td>
                  <td className="mono muted">{formatDate(a.completedAt ?? a.startedAt)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>
                    {formatDuration(a.totalElapsedMs)}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <span className="mono" style={{ fontWeight: 600 }}>
                      {a.percent !== null ? `${Math.round(a.percent)}%` : '-'}
                    </span>
                    {a.score !== null ? (
                      <span className="muted mono" style={{ marginLeft: 8, fontSize: 11 }}>
                        {formatScore(a.score)}/{formatScore(a.maxScore)}
                      </span>
                    ) : null}
                  </td>
                  <td style={{ textAlign: 'right', width: 24 }}>
                    <IcArrowRight size={14} className="muted" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
