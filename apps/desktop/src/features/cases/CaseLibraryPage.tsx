import { Tag } from '../../components/Tag';
import { categories } from '../../data/sampleContent';
import type { VascCase } from '../../types';

interface CaseLibraryPageProps {
  cases: VascCase[];
  onOpenCase: (caseId: string) => void;
  onStartCase: (caseId: string) => void;
}

export function CaseLibraryPage({ cases, onOpenCase, onStartCase }: CaseLibraryPageProps) {
  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Case library</p>
          <h2>Browse known cases.</h2>
          <p className="muted">
            Use the library to open a specific case, review its objectives, or launch it directly.
          </p>
        </div>
      </header>

      <section className="category-grid">
        {categories.map((category) => {
          const count = cases.filter((item) => item.categoryId === category.id).length;
          return (
            <article className="category-card" key={category.id}>
              <div className="category-emoji">{category.emoji}</div>
              <h3>{category.title}</h3>
              <p>{category.description}</p>
              <span>{count} case{count === 1 ? '' : 's'}</span>
            </article>
          );
        })}
      </section>

      <section className="content-card">
        <div className="section-title-row">
          <h3>Case catalogue</h3>
          <span className="pill">{cases.length} total</span>
        </div>
        <div className="case-table">
          {cases.map((item) => (
            <article className="case-row" key={item.id}>
              <div>
                <h4>{item.title}</h4>
                <p>{item.diagnosis}</p>
                <div className="tag-row">
                  {item.tags.slice(0, 5).map((tag) => <Tag key={tag}>{tag}</Tag>)}
                </div>
              </div>
              <div className="case-meta">
                <span>{item.difficulty}</span>
                <span>{item.estimatedMinutes} min</span>
              </div>
              <div className="row-actions">
                <button className="secondary-button" onClick={() => onOpenCase(item.id)}>Details</button>
                <button className="primary-button" onClick={() => onStartCase(item.id)}>Start</button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
