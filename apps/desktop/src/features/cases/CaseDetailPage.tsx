import { type CSSProperties, useEffect, useState } from 'react';
import { ProceduralPlanViewer } from '../../components/ProceduralPlanViewer';
import { categories } from '../../data/sampleContent';
import { getCaseCardArt, getTopicArt } from '../../lib/uiImages';
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
  return d.toLocaleDateString();
}

export function CaseDetailPage({ vascCase, onBack, onStart, onOpenComposer }: CaseDetailPageProps) {
  const teachingPoints = vascCase.teachingPoints ?? [];
  const references = vascCase.references ?? [];
  const reviewedAt = formatReviewedAt(vascCase.lastReviewedAt);
  const [linkedPlan, setLinkedPlan] = useState<VesselCompositionRow | null>(null);
  const [previewStepId, setPreviewStepId] = useState('');
  const category = categories.find((item) => item.id === vascCase.categoryId);
  const art = getCaseCardArt(vascCase) ?? getTopicArt(vascCase.categoryId);

  useEffect(() => {
    let cancelled = false;
    void listVesselCompositions(vascCase.id)
      .then((rows) => {
        if (!cancelled) {
          const plan = rows[0] ?? null;
          setLinkedPlan(plan);
          setPreviewStepId(plan?.data.proceduralSteps[0]?.id ?? '');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLinkedPlan(null);
          setPreviewStepId('');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [vascCase.id]);

  return (
    <div className="page case-detail-redesign">
      <div className="detail-crumbs">
        <button type="button" className="btn ghost small" onClick={onBack}>
          Back to library
        </button>
        <span>/</span>
        <span>{category?.title ?? 'Vascular case'}</span>
        <span>/</span>
        <strong>{vascCase.id}</strong>
      </div>

      <section className="detail-hero">
        <article className="card pad-lg detail-info">
          <div>
            <div className="page-eyebrow">{category?.title ?? 'Case detail'}</div>
            <h1 className="page-title">{vascCase.title}</h1>
            <p className="page-subtitle">{vascCase.diagnosis}</p>
          </div>
          <div className="pills-row">
            <span className="pill accent pill-mono">{vascCase.difficulty}</span>
            <span className="pill pill-mono">{vascCase.estimatedMinutes} min</span>
            <span className="pill pill-mono">{vascCase.questions.length} questions</span>
            <span className="pill pill-mono">{vascCase.bookmarks?.length ?? 0} key images</span>
            <span className={linkedPlan ? 'pill success pill-mono' : 'pill pill-mono'}>
              {linkedPlan ? 'Procedural plan' : 'No plan'}
            </span>
            {reviewedAt ? <span className="pill success pill-mono">Reviewed {reviewedAt}</span> : null}
          </div>
          <div className="flex detail-actions">
            <button type="button" className="btn primary large" onClick={onStart}>
              Practice this case
            </button>
            <button type="button" className="btn secondary" onClick={onOpenComposer}>
              {linkedPlan ? 'Open procedural plan' : 'Create procedural plan'}
            </button>
            <button type="button" className="btn ghost" onClick={onBack}>
              Back
            </button>
          </div>
        </article>

        <div
          className="case-detail-visual frame-corners"
          style={{ '--case-detail-bg': art ? `url(${art})` : undefined } as CSSProperties}
          aria-hidden="true"
        >
          <span className="corner tl" />
          <span className="corner tr" />
          <span className="corner bl" />
          <span className="corner br" />
          <div className="case-detail-visual-label">
            <span>{vascCase.volume.type.toUpperCase()}</span>
            <strong>{vascCase.volume.description || 'Imaging review'}</strong>
          </div>
        </div>
      </section>

      <section className="grid grid-12">
        <article className="card col-6">
          <div className="section-head">
            <div>
              <h3>Patient</h3>
              <p>Clinical context for the encounter.</p>
            </div>
          </div>
          <dl className="def">
            <dt>Age / Sex</dt>
            <dd>{vascCase.patient.age} / {vascCase.patient.sex}</dd>
            <dt>Presentation</dt>
            <dd>{vascCase.patient.presentation}</dd>
            {vascCase.patient.vitals && vascCase.patient.vitals.length > 0 ? (
              <>
                <dt>Vitals</dt>
                <dd>{vascCase.patient.vitals.join(', ')}</dd>
              </>
            ) : null}
            {vascCase.patient.history.length > 0 ? (
              <>
                <dt>History</dt>
                <dd>
                  <ul className="bullet">
                    {vascCase.patient.history.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </dd>
              </>
            ) : null}
          </dl>
        </article>

        <article className="card col-6">
          <div className="section-head">
            <div>
              <h3>Learning objectives</h3>
              <p>What this case is built to reinforce.</p>
            </div>
          </div>
          {vascCase.learningObjectives.length === 0 ? (
            <p className="muted">No learning objectives listed.</p>
          ) : (
            <ol className="bullet numbered-objectives">
              {vascCase.learningObjectives.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
          )}
          {vascCase.tags.length > 0 && (
            <div className="pills-row detail-tag-row">
              {vascCase.tags.map((tag) => (
                <span key={tag} className="pill">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </article>
      </section>

      {(teachingPoints.length > 0 || references.length > 0) && (
        <section className="grid grid-12">
          {teachingPoints.length > 0 && (
            <article className="card col-6">
              <div className="section-head">
                <div>
                  <h3>Teaching points</h3>
                  <p>High-yield review notes.</p>
                </div>
              </div>
              <ul className="bullet">
                {teachingPoints.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </article>
          )}
          {references.length > 0 && (
            <article className="card col-6">
              <div className="section-head">
                <div>
                  <h3>References</h3>
                  <p>Source material attached to this case.</p>
                </div>
              </div>
              <ol className="bullet numbered-objectives">
                {references.map((ref) => (
                  <li key={ref}>{ref}</li>
                ))}
              </ol>
            </article>
          )}
        </section>
      )}

      {linkedPlan && (
        <section className="card">
          <div className="section-head">
            <div>
              <h3>Procedural plan</h3>
              <p>Linked angiogram plan and step sequence.</p>
            </div>
            <div className="flex">
              <button type="button" className="btn secondary small" onClick={onStart}>
                Practice steps
              </button>
              <button type="button" className="btn secondary small" onClick={onOpenComposer}>
                Open plan
              </button>
            </div>
          </div>
          <PlanSummary linkedPlan={linkedPlan} />
          <div className="case-procedure-preview">
            <div className="case-procedure-step-list">
              {linkedPlan.data.proceduralSteps
                .slice()
                .sort((a, b) => a.orderIndex - b.orderIndex)
                .map((step) => (
                  <button
                    key={step.id}
                    type="button"
                    className={previewStepId === step.id ? 'case-procedure-step active' : 'case-procedure-step'}
                    onClick={() => setPreviewStepId(step.id)}
                  >
                    <strong>{step.label}</strong>
                    {step.notes ? <span>{step.notes}</span> : null}
                  </button>
                ))}
            </div>
            <ProceduralPlanViewer
              plan={linkedPlan}
              activeStepId={previewStepId || linkedPlan.data.proceduralSteps[0]?.id || 'baseline'}
              compact
              onStepChange={setPreviewStepId}
            />
          </div>
        </section>
      )}

      {vascCase.bookmarks && vascCase.bookmarks.length > 0 ? (
        <section className="card">
          <div className="section-head">
            <div>
              <h3>Key findings</h3>
              <p>Saved imaging landmarks for this case.</p>
            </div>
          </div>
          <div className="key-finding-list">
            {vascCase.bookmarks.map((bookmark) => (
              <div key={bookmark.id} className="key-finding-row">
                <strong>{bookmark.title}</strong>
                <span>
                  {bookmark.plane} slice {bookmark.sliceIndex + 1}
                  {bookmark.tags && bookmark.tags.length > 0 ? ` - ${bookmark.tags.join(', ')}` : ''}
                </span>
                {bookmark.note ? <span className="muted small">{bookmark.note}</span> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="card">
        <div className="section-head">
          <div>
            <h3>Imaging</h3>
            <p>{vascCase.volume.description || 'No imaging description provided.'}</p>
          </div>
        </div>
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
  const target = pathologicSegments[0];
  const devices = data.proceduralObjects
    .filter((object) => object.objectType !== 'guidewire' && object.objectType !== 'catheter')
    .map((object) => object.label);
  const notes = typeof data.metadata.notes === 'string' ? data.metadata.notes : '';

  return (
    <div className="case-plan-summary">
      <div>
        <strong>{pathologicSegments.length}</strong>
        <span>target segments</span>
      </div>
      <div>
        <strong>{data.proceduralSteps.length}</strong>
        <span>procedure steps</span>
      </div>
      <div>
        <strong>{data.proceduralObjects.length}</strong>
        <span>procedure objects</span>
      </div>
      <div>
        <strong>{data.devicePlacements.length}</strong>
        <span>device placements</span>
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
          <strong>Target:</strong> {target ? `${target.label} (${target.pathologyType})` : 'Intervention target'}
          {pathologicSegments.length > 1
            ? ` - ${pathologicSegments.length - 1} additional target${pathologicSegments.length === 2 ? '' : 's'}`
            : ''}
        </p>
      )}
      {devices.length > 0 ? (
        <p>
          <strong>Devices:</strong> {Array.from(new Set(devices)).slice(0, 4).join(', ')}
        </p>
      ) : null}
      {notes && <p className="muted small">{notes}</p>}
    </div>
  );
}
