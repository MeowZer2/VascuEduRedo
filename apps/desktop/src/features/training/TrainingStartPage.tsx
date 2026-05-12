import { type CSSProperties, useMemo, useState } from 'react';
import { categories } from '../../data/sampleContent';
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

const modes: Array<{ id: PracticeMode; title: string; description: string }> = [
  {
    id: 'guided',
    title: 'Guided case',
    description: 'Work through imaging, decisions, feedback, and teaching points.',
  },
  {
    id: 'measurement',
    title: 'Measurement focus',
    description: 'Prioritize caliper practice and anatomy recognition.',
  },
  {
    id: 'review',
    title: 'Rapid review',
    description: 'Short, focused pass for reinforcing a familiar topic.',
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

  const matchingCount = useMemo(
    () =>
      cases.filter((item) => {
        const difficultyOk = difficulty === 'any' || item.difficulty === difficulty;
        const topicOk = topic === 'any' || item.categoryId === topic;
        return difficultyOk && topicOk;
      }).length,
    [cases, difficulty, topic],
  );

  const difficulties = Array.from(new Set(cases.map((item) => item.difficulty))).filter(Boolean);

  return (
    <div className="page-stack">
      <section className="training-entry-panel practice-hero">
        <div>
          <p className="eyebrow">Guided practice</p>
          <h2>Start a focused vascular training session.</h2>
          <p>
            Choose a topic, level, and learning mode. VascEdu opens a case with the imaging and
            questions arranged around the task.
          </p>
        </div>
        <div className="training-entry-actions">
          <button
            type="button"
            className="primary-button"
            onClick={() => onStart({ difficulty, topic, mode })}
            disabled={cases.length === 0}
          >
            Start practice
          </button>
          <button type="button" className="secondary-button" onClick={onBrowseCases}>
            Browse cases
          </button>
        </div>
      </section>

      <section className="practice-track-grid">
        {practiceTracks.map((track) => (
          <article className="practice-track-card" key={track.title}>
            <div className="track-visual" aria-hidden="true" />
            <strong>{track.title}</strong>
            <span>{track.description}</span>
          </article>
        ))}
      </section>

      <section className="training-picker-grid">
        <article className="content-card training-picker-card">
          <h3>Session mode</h3>
          <div className="mode-choice-grid">
            {modes.map((item) => (
              <button
                key={item.id}
                type="button"
                className={mode === item.id ? 'mode-choice selected' : 'mode-choice'}
                onClick={() => setMode(item.id)}
              >
                <strong>{item.title}</strong>
                <span>{item.description}</span>
              </button>
            ))}
          </div>
        </article>

        <article className="content-card training-picker-card">
          <h3>Focus</h3>
          <div className="topic-tile-grid">
            {categories.map((category) => (
              <button
                key={category.id}
                type="button"
                className={topic === category.id ? 'topic-tile selected' : 'topic-tile'}
                style={{ '--topic-bg': `url(${getCategoryBackground(category.id) ?? ''})` } as CSSProperties}
                onClick={() => setTopic(category.id)}
              >
                <strong>{category.title}</strong>
                <span>{cases.filter((item) => item.categoryId === category.id).length} cases</span>
              </button>
            ))}
          </div>
          <label className="field-label">
            Topic
            <select className="text-input" value={topic} onChange={(event) => setTopic(event.target.value)}>
              <option value="any">Any topic</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.title}
                </option>
              ))}
            </select>
          </label>
          <label className="field-label">
            Difficulty
            <select
              className="text-input"
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
          <p className="muted small">
            {matchingCount > 0
              ? `${matchingCount} matching case${matchingCount === 1 ? '' : 's'} available.`
              : 'No exact match. Starting practice will use the closest available case.'}
          </p>
        </article>
      </section>
    </div>
  );
}
