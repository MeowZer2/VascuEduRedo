import { type CSSProperties, useMemo, useState } from 'react';
import { categories } from '../../data/sampleContent';
import { trainingArt } from '../../lib/uiImages';
import type { VascCase } from '../../types';
import { getCategoryBackground } from '../cases/categoryBackgrounds';

type PracticeMode = 'guided' | 'measurement' | 'review';

export interface TrainingFilters {
  difficulty: string;
  topic: string;
  mode: PracticeMode;
}

interface TrainingStartPageProps {
  cases: VascCase[];
  onStart: (filters: TrainingFilters) => void;
  onBrowseCases: () => void;
}

const modes: Array<{ id: PracticeMode; title: string; description: string; enabled: boolean }> = [
  {
    id: 'guided',
    title: 'Guided case',
    description: 'Work through imaging, decisions, feedback, and teaching points.',
    enabled: true,
  },
  {
    id: 'measurement',
    title: 'Measurement focus',
    description: 'Prioritize caliper practice and anatomy recognition.',
    enabled: false,
  },
  {
    id: 'review',
    title: 'Rapid review',
    description: 'Short, focused pass for reinforcing a familiar topic.',
    enabled: false,
  },
];

const practiceTracks = [
  { title: 'Imaging interpretation', description: 'CTA anatomy, diagnosis, and treatment thresholds.' },
  { title: 'Measurement practice', description: 'Calipers, planes, sizing, and surveillance questions.' },
  { title: 'Device selection', description: 'Match anatomy and pathology to practical device choices.' },
  { title: 'Procedural review', description: 'Step through angiogram context when a case includes a plan.' },
];

export function TrainingStartPage({ cases, onStart, onBrowseCases }: TrainingStartPageProps) {
  const [difficulty, setDifficulty] = useState('any');
  const [topic, setTopic] = useState('any');
  const [mode, setMode] = useState<PracticeMode>('guided');

  const matchingCases = useMemo(
    () =>
      cases.filter((item) => {
        const difficultyOk = difficulty === 'any' || item.difficulty === difficulty;
        const topicOk = topic === 'any' || item.categoryId === topic;
        return difficultyOk && topicOk;
      }),
    [cases, difficulty, topic],
  );
  const matchingCount = matchingCases.length;
  const nextCase = matchingCases[0] ?? null;

  const difficulties = useMemo(
    () => Array.from(new Set(cases.map((item) => item.difficulty))).filter(Boolean),
    [cases],
  );
  const topicCounts = useMemo(() => {
    const counts = new Map<string, number>();
    cases.forEach((item) => counts.set(item.categoryId, (counts.get(item.categoryId) ?? 0) + 1));
    return counts;
  }, [cases]);

  function startSession() {
    if (matchingCount === 0) return;
    onStart({ difficulty, topic, mode });
  }

  return (
    <div className="page training-start-redesign">
      <header className="page-head">
        <div>
          <div className="page-eyebrow">Practice - focused session</div>
          <h1 className="page-title">Start a focused practice session</h1>
          <p className="page-subtitle">
            Pick a session shape and filters. VascEdu queues a matching case with imaging and
            questions arranged around the task.
          </p>
        </div>
        <button type="button" className="btn secondary" onClick={onBrowseCases}>
          Browse library
        </button>
      </header>

      <section className="grid grid-12">
        <article className="card pad-lg col-7">
          <div className="section-head">
            <div>
              <div className="page-eyebrow">Mode</div>
              <h3>Session shape</h3>
              <p>How the case will be presented to you.</p>
            </div>
          </div>

          <div className="practice-mode-list">
            {modes.map((item, index) => {
              const active = mode === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={active ? 'practice-mode-option active' : 'practice-mode-option'}
                  onClick={() => {
                    if (item.enabled) setMode(item.id);
                  }}
                  disabled={!item.enabled}
                  title={!item.enabled ? 'Coming later - guided case mode is available now' : undefined}
                >
                  <span className="practice-mode-token">{String(index + 1).padStart(2, '0')}</span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.description}</small>
                  </span>
                  <span className="practice-mode-status">
                    {active ? 'Selected' : item.enabled ? 'Choose' : 'Coming later'}
                  </span>
                </button>
              );
            })}
          </div>

          <hr className="divider training-divider" />

          <div className="section-head">
            <div>
              <h3>Filters</h3>
              <p>Narrow to a specific topic or difficulty.</p>
            </div>
          </div>
          <div className="grid grid-3">
            <label className="field">
              <span>Topic</span>
              <select className="input" value={topic} onChange={(event) => setTopic(event.target.value)}>
                <option value="any">Any topic</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Difficulty</span>
              <select
                className="input"
                value={difficulty}
                onChange={(event) => setDifficulty(event.target.value)}
              >
                <option value="any">Any level</option>
                {difficulties.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Session length</span>
              <select
                className="input"
                defaultValue="case"
                disabled
                title="Session length follows the selected case in this build"
              >
                <option value="case">Case default</option>
                <option value="5">~5 min</option>
                <option value="10">~10 min</option>
                <option value="20">~20 min</option>
                <option value="30">~30 min</option>
              </select>
            </label>
          </div>

          <hr className="divider training-divider" />

          <div className="between training-start-footer">
            <div>
              <strong>
                {matchingCount} matching case{matchingCount === 1 ? '' : 's'} available
              </strong>
              <span className="muted">
                {matchingCount > 0
                  ? 'Start launches the first matching case in your queue.'
                  : 'Adjust filters to choose an available case.'}
              </span>
            </div>
            <button
              type="button"
              className="btn primary large"
              onClick={startSession}
              disabled={matchingCount === 0}
              title={matchingCount === 0 ? 'No cases match the current filters' : undefined}
            >
              Start session
            </button>
          </div>
        </article>

        <aside className="col-5 training-preview-column">
          <article className="card pad-sm training-preview-card">
            <div
              className="training-preview-visual"
              style={{ backgroundImage: `url(${trainingArt.hero ?? ''})` }}
              aria-hidden="true"
            />
            <div className="training-preview-body">
              <div className="page-eyebrow">Next up</div>
              <strong>{nextCase?.title ?? 'No matching case'}</strong>
              <p className="muted">
                {nextCase?.diagnosis ?? 'Adjust filters to widen the practice queue.'}
              </p>
              <div className="pills-row">
                {nextCase ? <span className="pill accent pill-mono">{nextCase.difficulty}</span> : null}
                {nextCase ? <span className="pill pill-mono">{nextCase.estimatedMinutes} min</span> : null}
                {nextCase ? <span className="pill pill-mono">{nextCase.questions.length} Qs</span> : null}
              </div>
            </div>
          </article>

          <article className="card">
            <div className="section-head">
              <div>
                <div className="page-eyebrow">Focus</div>
                <h3>Recommended topics</h3>
                <p>High-yield tracks for the next practice block.</p>
              </div>
            </div>
            <div className="training-focus-list">
              {categories.slice(0, 5).map((category) => (
                <button
                  key={category.id}
                  type="button"
                  className={topic === category.id ? 'training-focus-row active' : 'training-focus-row'}
                  style={{
                    '--topic-bg': `url(${
                      trainingArt.focusTopics[category.id] ??
                      trainingArt.fallbackCompactTopic ??
                      getCategoryBackground(category.id) ??
                      ''
                    })`,
                  } as CSSProperties}
                  onClick={() => setTopic(category.id)}
                >
                  <span>
                    <strong>{category.title}</strong>
                    <small>{category.description}</small>
                  </span>
                  <span className="pill pill-mono">{topicCounts.get(category.id) ?? 0} cases</span>
                </button>
              ))}
            </div>
          </article>
        </aside>
      </section>

      <section className="grid grid-4">
        {practiceTracks.map((track) => (
          <article className="metric-tile practice-track-metric" key={track.title}>
            <div>
              <div className="label">{track.title}</div>
              <div className="sub">{track.description}</div>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
