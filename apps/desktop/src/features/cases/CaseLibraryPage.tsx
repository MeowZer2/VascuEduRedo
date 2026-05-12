import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Tag } from '../../components/Tag';
import { categories } from '../../data/sampleContent';
import { listVesselCompositions } from '../../lib/vesselComposer';
import type { VascCase } from '../../types';
import { getCategoryBackground } from './categoryBackgrounds';

interface CaseLibraryPageProps {
  cases: VascCase[];
  onOpenCase: (caseId: string) => void;
  onStartCase: (caseId: string) => void;
}

export function CaseLibraryPage({ cases, onOpenCase, onStartCase }: CaseLibraryPageProps) {
  const [search, setSearch] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [planCaseIds, setPlanCaseIds] = useState<Set<string>>(() => new Set());
  const filteredCases = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return cases.filter((item) => {
      if (difficulty && item.difficulty !== difficulty) return false;
      if (!needle) return true;
      return (
        item.title.toLowerCase().includes(needle) ||
        item.diagnosis.toLowerCase().includes(needle) ||
        item.tags.some((tag) => tag.toLowerCase().includes(needle))
      );
    });
  }, [cases, difficulty, search]);
  const difficulties = Array.from(new Set(cases.map((item) => item.difficulty))).filter(Boolean);

  useEffect(() => {
    let cancelled = false;
    async function loadPlanBadges() {
      const entries = await Promise.all(
        cases.map(async (item) => [item.id, (await listVesselCompositions(item.id)).length > 0] as const),
      );
      if (cancelled) return;
      setPlanCaseIds(new Set(entries.filter(([, hasPlan]) => hasPlan).map(([id]) => id)));
    }
    void loadPlanBadges().catch(() => {
      if (!cancelled) setPlanCaseIds(new Set());
    });
    return () => {
      cancelled = true;
    };
  }, [cases]);

  return (
    <div className="page-stack">
      <header className="page-header library-hero">
        <div>
          <p className="eyebrow">Case library</p>
          <h2>Image-rich vascular case library.</h2>
          <p className="muted">
            Scan cases by diagnosis, topic, level, and procedural context before starting practice.
          </p>
        </div>
      </header>

      <section className="category-grid">
        {categories.map((category) => {
          const count = cases.filter((item) => item.categoryId === category.id).length;
          const backgroundImage = getCategoryBackground(category.id);
          const cardStyle = backgroundImage
            ? ({ '--category-bg': `url(${backgroundImage})` } as CSSProperties)
            : undefined;
          return (
            <article
              className={backgroundImage ? 'category-card has-category-bg' : 'category-card'}
              key={category.id}
              style={cardStyle}
            >
              <h3>{category.title}</h3>
              <p>{category.description}</p>
              <span>{count} case{count === 1 ? '' : 's'}</span>
            </article>
          );
        })}
      </section>

      <section className="content-card">
        <div className="section-title-row">
          <h3>All cases</h3>
          <span className="pill">{filteredCases.length} shown</span>
        </div>
        <div className="library-filter-bar">
          <input
            className="text-input"
            type="search"
            placeholder="Search diagnosis, topic, or tag"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select
            className="text-input"
            value={difficulty}
            onChange={(event) => setDifficulty(event.target.value)}
          >
            <option value="">All levels</option>
            {difficulties.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </div>
        <div className="case-card-grid">
          {cases.length === 0 ? (
            <div className="empty-state">
              <strong>No cases available</strong>
              <span>Add cases from the authoring workspace to start building the library.</span>
            </div>
          ) : filteredCases.length === 0 ? (
            <div className="empty-state">
              <strong>No matching cases</strong>
              <span>Adjust the search or level filter to broaden the library view.</span>
            </div>
          ) : filteredCases.map((item) => {
              const category = categories.find((cat) => cat.id === item.categoryId);
              return (
                <article
                  className="case-library-card"
                  key={item.id}
                  style={{ '--case-bg': `url(${getCategoryBackground(item.categoryId) ?? ''})` } as CSSProperties}
                >
                  <div className="case-card-image">
                    <span className="pill">{category?.title ?? 'Vascular case'}</span>
                  </div>
                  <div className="case-card-body">
                    <div>
                      <h4>{item.title}</h4>
                      <p>{item.diagnosis}</p>
                    </div>
                    <div className="tag-row">
                      {item.tags.slice(0, 4).map((tag) => <Tag key={tag}>{tag}</Tag>)}
                    </div>
                    <div className="case-card-meta">
                      <span>{item.difficulty}</span>
                      <span>{item.estimatedMinutes} min</span>
                      <span>{item.questions.length} questions</span>
                      {planCaseIds.has(item.id) ? <span>procedural plan</span> : null}
                    </div>
                    <div className="row-actions compact-actions">
                      <button className="secondary-button" onClick={() => onOpenCase(item.id)}>Details</button>
                      <button className="primary-button" onClick={() => onStartCase(item.id)}>Start</button>
                    </div>
                  </div>
                </article>
              );
            })}
        </div>
      </section>
    </div>
  );
}
