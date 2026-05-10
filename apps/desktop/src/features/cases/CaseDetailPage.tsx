import { Tag } from '../../components/Tag';
import type { VascCase } from '../../types';

interface CaseDetailPageProps {
  vascCase: VascCase;
  onBack: () => void;
  onStart: () => void;
}

function formatReviewedAt(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Reviewer cares about the date, not the time-of-day.
  return d.toLocaleDateString();
}

export function CaseDetailPage({ vascCase, onBack, onStart }: CaseDetailPageProps) {
  const teachingPoints = vascCase.teachingPoints ?? [];
  const references = vascCase.references ?? [];
  const reviewedAt = formatReviewedAt(vascCase.lastReviewedAt);

  return (
    <div className="page-stack">
      <header className="page-header split-header">
        <div>
          <p className="eyebrow">Case detail</p>
          <h2>{vascCase.title}</h2>
          <p>{vascCase.diagnosis}</p>
          <div className="case-meta-pills">
            <span className="pill">{vascCase.difficulty}</span>
            <span className="pill">{vascCase.estimatedMinutes} min</span>
            {vascCase.author && <span className="pill">Author: {vascCase.author}</span>}
            {vascCase.reviewer && <span className="pill">Reviewed by: {vascCase.reviewer}</span>}
            {reviewedAt && <span className="pill">Reviewed {reviewedAt}</span>}
          </div>
        </div>
        <div className="row-actions">
          <button className="secondary-button" onClick={onBack}>Back</button>
          <button className="primary-button" onClick={onStart}>Start training</button>
        </div>
      </header>

      <section className="grid-2">
        <article className="content-card">
          <h3>Patient</h3>
          <dl className="detail-list">
            <div><dt>Age</dt><dd>{vascCase.patient.age}</dd></div>
            <div><dt>Sex</dt><dd>{vascCase.patient.sex}</dd></div>
            <div><dt>Presentation</dt><dd>{vascCase.patient.presentation}</dd></div>
          </dl>
          {vascCase.patient.history.length > 0 && (
            <>
              <h4>History</h4>
              <ul className="compact-list">
                {vascCase.patient.history.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </>
          )}
          {vascCase.patient.vitals && vascCase.patient.vitals.length > 0 && (
            <>
              <h4>Vitals</h4>
              <ul className="compact-list">
                {vascCase.patient.vitals.map((v) => (
                  <li key={v}>{v}</li>
                ))}
              </ul>
            </>
          )}
        </article>

        <article className="content-card">
          <h3>Learning objectives</h3>
          {vascCase.learningObjectives.length === 0 ? (
            <p className="muted">No learning objectives listed.</p>
          ) : (
            <ol className="compact-list numbered">
              {vascCase.learningObjectives.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
          )}
          {vascCase.tags.length > 0 && (
            <div className="tag-row spacious">
              {vascCase.tags.map((tag) => (
                <Tag key={tag}>{tag}</Tag>
              ))}
            </div>
          )}
        </article>
      </section>

      {(teachingPoints.length > 0 || references.length > 0) && (
        <section className="grid-2">
          {teachingPoints.length > 0 && (
            <article className="content-card">
              <h3>Teaching points</h3>
              <ul className="compact-list">
                {teachingPoints.map((tp) => (
                  <li key={tp}>{tp}</li>
                ))}
              </ul>
            </article>
          )}
          {references.length > 0 && (
            <article className="content-card">
              <h3>References</h3>
              <ol className="compact-list numbered">
                {references.map((ref) => (
                  <li key={ref}>{ref}</li>
                ))}
              </ol>
            </article>
          )}
        </section>
      )}

      <section className="content-card">
        <h3>Imaging</h3>
        <p>{vascCase.volume.description || 'No imaging description provided.'}</p>
        {vascCase.volume.path && (
          <p className="muted small">
            <strong>Volume:</strong> <code>{vascCase.volume.path}</code>
          </p>
        )}
      </section>
    </div>
  );
}
