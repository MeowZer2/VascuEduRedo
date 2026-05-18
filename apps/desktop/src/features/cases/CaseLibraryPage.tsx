import { useEffect, useMemo, useState } from 'react';
import { anatomyIcon, IcPlay, IcSearch, IcStack, IcGrid, IcList } from '../../components/prototype/icons';
import { CaseCard, Pill, PhotoLayers, Thumb, TILE_CONTENT } from '../../components/prototype/primitives';
import { categories } from '../../data/sampleContent';
import { casesPracticeArt, getCaseCardArt, getTopicArt } from '../../lib/uiImages';
import { listVesselCompositions } from '../../lib/vesselComposer';
import type { VascCase } from '../../types';

interface CaseLibraryPageProps {
  cases: VascCase[];
  onOpenCase: (caseId: string) => void;
  onStartCase: (caseId: string) => void;
}

const ANY = 'any';
const ALL = 'all';
const DIFFICULTY_ORDER: Record<string, number> = { beginner: 0, intermediate: 1, advanced: 2 };

const CATEGORY_SHORT: Record<string, string> = {
  aaa: 'AAA',
  cerebrovascular: 'Carotid',
  'mesenteric-renal': 'Visceral',
  pad: 'PAD',
  venous: 'Venous',
  'dialysis-access': 'Access',
  thoracic: 'Thoracic',
};

export function CaseLibraryPage({
  cases,
  onOpenCase,
  onStartCase,
}: CaseLibraryPageProps) {
  const [search, setSearch] = useState('');
  const [difficulty, setDifficulty] = useState<string>(ANY);
  const [topic, setTopic] = useState<string>(ALL);
  const [sort, setSort] = useState<'recent' | 'alpha' | 'diff'>('recent');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [planCaseIds, setPlanCaseIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let cancelled = false;
    async function loadPlanBadges() {
      const entries = await Promise.all(
        cases.map(
          async (item) => [item.id, (await listVesselCompositions({ caseId: item.id, scope: 'reference' })).length > 0] as const,
        ),
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

  const difficulties = useMemo(
    () => Array.from(new Set(cases.map((item) => item.difficulty))).filter(Boolean),
    [cases],
  );

  const topicCounts = useMemo(() => {
    const map = new Map<string, number>();
    cases.forEach((item) => {
      map.set(item.categoryId, (map.get(item.categoryId) ?? 0) + 1);
    });
    return map;
  }, [cases]);

  const filteredCases = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = cases.filter((item) => {
      if (difficulty !== ANY && item.difficulty !== difficulty) return false;
      if (topic !== ALL && item.categoryId !== topic) return false;
      if (!needle) return true;
      return (
        item.title.toLowerCase().includes(needle) ||
        item.diagnosis.toLowerCase().includes(needle) ||
        item.tags.some((tag) => tag.toLowerCase().includes(needle))
      );
    });
    if (sort === 'alpha') {
      return [...list].sort((a, b) => a.title.localeCompare(b.title));
    }
    if (sort === 'diff') {
      return [...list].sort(
        (a, b) => (DIFFICULTY_ORDER[a.difficulty] ?? 9) - (DIFFICULTY_ORDER[b.difficulty] ?? 9),
      );
    }
    return list;
  }, [cases, difficulty, search, sort, topic]);

  const filtersActive = search !== '' || difficulty !== ANY || topic !== ALL;

  function clearFilters() {
    setSearch('');
    setDifficulty(ANY);
    setTopic(ALL);
  }

  function startQuickPractice() {
    if (filteredCases.length > 0) {
      onStartCase(filteredCases[0].id);
    }
  }

  function shortName(categoryId: string): string {
    return CATEGORY_SHORT[categoryId] ?? categories.find((c) => c.id === categoryId)?.title ?? 'Vascular';
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-eyebrow">Cases · {categories.length} vascular tracks</div>
          <h1 className="page-title">
            Case <span className="display-italic">library</span>
          </h1>
          <p className="page-subtitle">
            Browse the case archive, filter by topic or difficulty, and launch a guided practice
            session.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn secondary"
            onClick={clearFilters}
            disabled={!filtersActive}
            title="Clear all filters"
          >
            Clear filters
          </button>
          <button
            className="btn primary"
            onClick={startQuickPractice}
            disabled={filteredCases.length === 0}
            title={filteredCases.length === 0 ? 'No cases match the current filters' : 'Start the first shown case'}
          >
            <IcPlay size={14} /> Quick practice
          </button>
        </div>
      </div>

      {/* Topic chips */}
      <section>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 12,
          }}
        >
          <button
            className={`tile ${topic === ALL ? 'has-rule' : ''}`}
            onClick={() => setTopic(ALL)}
            style={{
              minHeight: 108,
              padding: 14,
              gap: 6,
              borderColor: topic === ALL ? 'var(--border-accent)' : undefined,
            }}
          >
            <PhotoLayers imageUrl={casesPracticeArt.allTopics} />
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                ...TILE_CONTENT,
              }}
            >
              <div className="tile-ic">
                <IcStack size={18} />
              </div>
              <span className="mono muted" style={{ fontSize: 11 }}>
                {cases.length} cases
              </span>
            </div>
            <h4 style={TILE_CONTENT}>All topics</h4>
            <p style={TILE_CONTENT}>Full case archive across vascular tracks.</p>
          </button>
          {categories.map((cat) => {
            const Icon = anatomyIcon(cat.id);
            const active = topic === cat.id;
            return (
              <button
                key={cat.id}
                className="tile"
                onClick={() => setTopic(cat.id)}
                style={{
                  minHeight: 108,
                  padding: 14,
                  gap: 6,
                  borderColor: active ? 'var(--border-accent)' : undefined,
                }}
              >
                <PhotoLayers imageUrl={getTopicArt(cat.id)} />
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    ...TILE_CONTENT,
                  }}
                >
                  <div className="tile-ic">
                    <Icon size={18} />
                  </div>
                  <span className="mono muted" style={{ fontSize: 11 }}>
                    {topicCounts.get(cat.id) ?? 0} cases
                  </span>
                </div>
                <h4 style={TILE_CONTENT}>{cat.title}</h4>
                <p style={TILE_CONTENT}>{cat.description}</p>
              </button>
            );
          })}
        </div>
      </section>

      {/* Toolbar */}
      <section className="toolbar">
        <div className="search-input" style={{ width: 340, color: 'var(--text-2)' }}>
          <IcSearch size={14} />
          <input
            placeholder="Search diagnosis, tags, anatomy…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <select
          className="input"
          style={{ width: 160 }}
          value={difficulty}
          onChange={(event) => setDifficulty(event.target.value)}
        >
          <option value={ANY}>All levels</option>
          {difficulties.map((item) => (
            <option key={item} value={item}>
              {item[0].toUpperCase() + item.slice(1)}
            </option>
          ))}
        </select>
        <select
          className="input"
          style={{ width: 160 }}
          value={sort}
          onChange={(event) => setSort(event.target.value as typeof sort)}
        >
          <option value="recent">Sort: Recent</option>
          <option value="alpha">A–Z</option>
          <option value="diff">Difficulty</option>
        </select>
        <div className="toolbar-spacer" />
        <span className="muted mono" style={{ fontSize: 12 }}>
          {filteredCases.length} shown
        </span>
        <div className="segmented">
          <button className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')}>
            <IcGrid size={13} />
          </button>
          <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>
            <IcList size={13} />
          </button>
        </div>
      </section>

      {/* Grid or list */}
      {cases.length === 0 ? (
        <div className="empty">
          <strong>No cases available</strong>
          Add cases from the authoring workspace to start building the library.
        </div>
      ) : filteredCases.length === 0 ? (
        <div className="empty">
          <strong>No matching cases</strong>
          Adjust the search, topic, or level filter to broaden the library view.
        </div>
      ) : view === 'grid' ? (
        <section className="grid grid-3">
          {filteredCases.map((item) => (
            <CaseCard
              key={item.id}
              vascCase={{
                id: item.id,
                categoryId: item.categoryId,
                title: item.title,
                diagnosis: item.diagnosis,
                difficulty: item.difficulty,
                estimatedMinutes: item.estimatedMinutes,
                questionCount: item.questions.length,
                hasPlan: planCaseIds.has(item.id),
                imageUrl: getCaseCardArt(item),
              }}
              categoryName={shortName(item.categoryId)}
              onOpen={() => onOpenCase(item.id)}
            />
          ))}
        </section>
      ) : (
        <section className="card pad-sm">
          <table className="table">
            <thead>
              <tr>
                <th>Case</th>
                <th>Topic</th>
                <th>Level</th>
                <th>Questions</th>
                <th>Plan</th>
                <th>Duration</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filteredCases.map((item) => (
                <tr key={item.id} style={{ cursor: 'pointer' }} onClick={() => onOpenCase(item.id)}>
                  <td>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '56px 1fr',
                        gap: 12,
                        alignItems: 'center',
                      }}
                    >
                      <div style={{ width: 56, height: 42, borderRadius: 6, overflow: 'hidden' }}>
                        <Thumb imageUrl={getCaseCardArt(item)} categoryId={item.categoryId} wide label="" />
                      </div>
                      <div>
                        <strong style={{ fontSize: 13, fontWeight: 600, display: 'block' }}>
                          {item.title}
                        </strong>
                        <span className="muted" style={{ fontSize: 11.5 }}>
                          {item.diagnosis}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <Pill variant="accent" mono>
                      {shortName(item.categoryId)}
                    </Pill>
                  </td>
                  <td>
                    <Pill mono>{item.difficulty}</Pill>
                  </td>
                  <td className="mono">{item.questions.length}</td>
                  <td>
                    {planCaseIds.has(item.id) ? (
                      <Pill variant="blue" mono>
                        linked
                      </Pill>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="mono muted">{item.estimatedMinutes} min</td>
                  <td>
                    <button
                      className="btn primary small"
                      onClick={(event) => {
                        event.stopPropagation();
                        onStartCase(item.id);
                      }}
                    >
                      Start
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
