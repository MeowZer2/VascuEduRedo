import { useEffect, useState } from 'react';
import { Tag } from '../../components/Tag';
import { listVesselCompositions, type VesselCompositionRow } from '../../lib/vesselComposer';
import type { VascCase } from '../../types';

interface CaseDetailPageProps {
  vascCase: VascCase;
  onBack: () => void;
  onStart: () => void;
  onOpenComposer: () => void;
}

function formatReviewedAt(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Reviewer cares about the date, not the time-of-day.
  return d.toLocaleDateString();
}

export function CaseDetailPage({ vascCase, onBack, onStart, onOpenComposer }: CaseDetailPageProps) {
  const teachingPoints = vascCase.teachingPoints ?? [];
  const references = vascCase.references ?? [];
  const reviewedAt = formatReviewedAt(vascCase.lastReviewedAt);
  const [linkedPlan, setLinkedPlan] = useState<VesselCompositionRow | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listVesselCompositions(vascCase.id)
      .then((rows) => {
        if (!cancelled) setLinkedPlan(rows[0] ?? null);
      })
      .catch(() => {
        if (!cancelled) setLinkedPlan(null);
      });
    return () => {
      cancelled = true;
    };
  }, [vascCase.id]);

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
            <span className="pill">{linkedPlan ? 'Angiogram plan linked' : 'No angiogram plan'}</span>
          </div>
        </div>
        <div className="row-actions">
          <button className="secondary-button" onClick={onBack}>Back</button>
          <button className="secondary-button" onClick={onOpenComposer}>
            {linkedPlan ? 'Open procedural plan' : 'Create procedural plan'}
          </button>
          <button className="primary-button" onClick={onStart}>Practice this case</button>
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

      {linkedPlan && (
        <section className="content-card">
          <div className="section-title-row">
            <h3>Procedural plan</h3>
            <button className="secondary-button small" onClick={onOpenComposer}>Open procedural plan</button>
          </div>
          <PlanSummary linkedPlan={linkedPlan} />
        </section>
      )}

      {vascCase.bookmarks && vascCase.bookmarks.length > 0 ? (
        <section className="content-card">
          <h3>Key findings</h3>
          <div className="key-finding-list">
            {vascCase.bookmarks.map((bookmark) => (
              <div key={bookmark.id} className="key-finding-row">
                <strong>{bookmark.title}</strong>
                <span>
                  {bookmark.plane} slice {bookmark.sliceIndex + 1}
                  {bookmark.tags && bookmark.tags.length > 0 ? ` · ${bookmark.tags.join(', ')}` : ''}
                </span>
                {bookmark.note ? <span className="muted small">{bookmark.note}</span> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="content-card">
        <h3>Imaging</h3>
        <p>{vascCase.volume.description || 'No imaging description provided.'}</p>
        {vascCase.volume.path && (
          <p className="muted small admin-only-note">
            <strong>Volume:</strong> <code>{vascCase.volume.path}</code>
          </p>
        )}
      </section>
    </div>
  );
}

function PlanSummary({ linkedPlan }: { linkedPlan: VesselCompositionRow }) {
  const data = linkedPlan.data;
  const pathologicSegments = data.segments.filter(
    (segment) => segment.pathologyType !== 'normal' || segment.targetForIntervention,
  );
  const notes = typeof data.metadata.notes === 'string' ? data.metadata.notes : '';

  return (
    <div className="case-plan-summary">
      <div>
        <strong>{pathologicSegments.length}</strong>
        <span>pathology/target segment{pathologicSegments.length === 1 ? '' : 's'}</span>
      </div>
      <div>
        <strong>{data.proceduralSteps.length}</strong>
        <span>procedural step{data.proceduralSteps.length === 1 ? '' : 's'}</span>
      </div>
      <div>
        <strong>{data.proceduralObjects.length}</strong>
        <span>procedural object{data.proceduralObjects.length === 1 ? '' : 's'}</span>
      </div>
      <div>
        <strong>{data.devicePlacements.length}</strong>
        <span>device placement{data.devicePlacements.length === 1 ? '' : 's'}</span>
      </div>
      {data.proceduralSteps.length > 0 && (
        <div className="case-plan-steps">
          {data.proceduralSteps
            .slice()
            .sort((a, b) => a.orderIndex - b.orderIndex)
            .slice(0, 5)
            .map((step) => (
              <span key={step.id}>{step.label}</span>
            ))}
        </div>
      )}
      {pathologicSegments.length > 0 && (
        <p>
          {pathologicSegments.slice(0, 3).map((segment) => `${segment.label}: ${segment.pathologyType}`).join('; ')}
        </p>
      )}
      {notes && <p className="muted small">{notes}</p>}
    </div>
  );
}
