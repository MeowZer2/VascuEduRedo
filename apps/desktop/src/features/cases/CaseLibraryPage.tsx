import { useEffect, useMemo, useState } from 'react';
import {
  ActionTile,
  CaseTile,
  ImageBannerCard,
  SectionHeader,
  TopicCard,
} from '../../components/learnerCards';
import { categories } from '../../data/sampleContent';
import { actionArt, getCaseCardArt, getHeroArt, getTopicArt } from '../../lib/uiImages';
import { listVesselCompositions } from '../../lib/vesselComposer';
import type { VascCase } from '../../types';

interface CaseLibraryPageProps {
  cases: VascCase[];
  onOpenCase: (caseId: string) => void;
  onStartCase: (caseId: string) => void;
  onQuickPractice: (filters: { difficulty: string; topic: string }) => void;
}

const ANY = 'any';

export function CaseLibraryPage({
  cases,
  onOpenCase,
  onStartCase,
  onQuickPractice,
}: CaseLibraryPageProps) {
  const [search, setSearch] = useState('');
  const [difficulty, setDifficulty] = useState<string>(ANY);
  const [topic, setTopic] = useState<string>(ANY);
  const [tagFilter, setTagFilter] = useState<string>('');
  const [planCaseIds, setPlanCaseIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let cancelled = false;
    async function loadPlanBadges() {
      const entries = await Promise.all(
        cases.map(
          async (item) => [item.id, (await listVesselCompositions(item.id)).length > 0] as const,
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
  const allTags = useMemo(() => {
    const set = new Set<string>();
    cases.forEach((item) => item.tags.forEach((tag) => set.add(tag)));
    return Array.from(set).sort();
  }, [cases]);

  const filteredCases = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return cases.filter((item) => {
      if (difficulty !== ANY && item.difficulty !== difficulty) return false;
      if (topic !== ANY && item.categoryId !== topic) return false;
      if (tagFilter && !item.tags.includes(tagFilter)) return false;
      if (!needle) return true;
      return (
        item.title.toLowerCase().includes(needle) ||
        item.diagnosis.toLowerCase().includes(needle) ||
        item.tags.some((tag) => tag.toLowerCase().includes(needle))
      );
    });
  }, [cases, difficulty, search, tagFilter, topic]);

  const topicCounts = useMemo(() => {
    const map = new Map<string, number>();
    cases.forEach((item) => {
      map.set(item.categoryId, (map.get(item.categoryId) ?? 0) + 1);
    });
    return map;
  }, [cases]);

  const filtersActive = search !== '' || difficulty !== ANY || topic !== ANY || tagFilter !== '';

  function clearFilters() {
    setSearch('');
    setDifficulty(ANY);
    setTopic(ANY);
    setTagFilter('');
  }

  function startQuickPractice() {
    if (filteredCases.length > 0) {
      onStartCase(filteredCases[0].id);
      return;
    }
    onQuickPractice({ difficulty, topic });
  }

  return (
    <div className="page-stack learner-cases-page">
      <ImageBannerCard
        imageUrl={getHeroArt('cases')}
        ratio="hero"
        eyebrow="Cases & practice"
        title="Discover, filter, and start vascular practice in one place."
        description="Browse the case archive, narrow by topic or difficulty, and launch a guided practice session whenever you're ready."
      >
        <div className="hero-actions">
          <button
            className="primary-button"
            onClick={startQuickPractice}
            disabled={cases.length === 0}
          >
            Quick start practice
          </button>
          <button
            className="secondary-button"
            onClick={clearFilters}
            disabled={!filtersActive}
            title="Clear all filters"
          >
            Clear filters
          </button>
        </div>
      </ImageBannerCard>

      <section className="learner-section">
        <SectionHeader
          eyebrow="Practice modes"
          title="Jump straight in"
          description="Start a focused session matching your current filters."
        />
        <div className="action-tile-row">
          <ActionTile
            imageUrl={actionArt.practice}
            label="Guided practice"
            caption="Imaging, decisions, feedback, teaching"
            variant="primary"
            onClick={startQuickPractice}
            disabled={cases.length === 0}
          />
          <ActionTile
            imageUrl={actionArt.cases}
            label="Random case"
            caption="Pick any case from the matching set"
            onClick={() => {
              if (filteredCases.length === 0) return;
              const pick = filteredCases[Math.floor(Math.random() * filteredCases.length)];
              onStartCase(pick.id);
            }}
            disabled={filteredCases.length === 0}
          />
          <ActionTile
            imageUrl={actionArt.planning}
            label="Cases with plans"
            caption="Practice cases that include a procedural plan"
            onClick={() => {
              const planned = filteredCases.find((item) => planCaseIds.has(item.id));
              if (planned) onStartCase(planned.id);
            }}
            disabled={filteredCases.every((item) => !planCaseIds.has(item.id))}
          />
        </div>
      </section>

      <section className="learner-section">
        <SectionHeader
          eyebrow="Topics"
          title="Browse by vascular topic"
          description="Click a topic to filter the case grid below."
        />
        <div className="topic-card-grid">
          <TopicCard
            title="All topics"
            caseCount={cases.length}
            description="Show every case in the library."
            onClick={() => setTopic(ANY)}
            ariaLabel="Show all topics"
          />
          {categories.map((category) => (
            <TopicCard
              key={category.id}
              imageUrl={getTopicArt(category.id)}
              title={category.title}
              caseCount={topicCounts.get(category.id) ?? 0}
              description={category.description}
              onClick={() => setTopic(category.id)}
              ariaLabel={`Filter by ${category.title}`}
            />
          ))}
        </div>
      </section>

      <section className="learner-section case-discovery-section">
        <SectionHeader
          eyebrow="Case library"
          title="Filtered cases"
          description="Search by diagnosis, topic, tag, or level. Start practice from any card."
          action={<span className="pill">{filteredCases.length} shown</span>}
        />

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
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
          >
            <option value={ANY}>All topics</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.title}
              </option>
            ))}
          </select>
          <select
            className="text-input"
            value={difficulty}
            onChange={(event) => setDifficulty(event.target.value)}
          >
            <option value={ANY}>All levels</option>
            {difficulties.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          <select
            className="text-input"
            value={tagFilter}
            onChange={(event) => setTagFilter(event.target.value)}
            disabled={allTags.length === 0}
          >
            <option value="">All tags</option>
            {allTags.map((tag) => (
              <option key={tag} value={tag}>{tag}</option>
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
              <span>Adjust the search, topic, or level filter to broaden the library view.</span>
            </div>
          ) : (
            filteredCases.map((item) => {
              const category = categories.find((cat) => cat.id === item.categoryId);
              return (
                <CaseTile
                  key={item.id}
                  imageUrl={getCaseCardArt(item)}
                  topicLabel={category?.title ?? 'Vascular case'}
                  title={item.title}
                  diagnosis={item.diagnosis}
                  difficulty={item.difficulty}
                  estimatedMinutes={item.estimatedMinutes}
                  questionCount={item.questions.length}
                  hasPlan={planCaseIds.has(item.id)}
                  tags={item.tags}
                  onOpenDetails={() => onOpenCase(item.id)}
                  onStart={() => onStartCase(item.id)}
                />
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
