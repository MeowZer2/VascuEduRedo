import { Tag } from '../../components/Tag';
import type { VascCase } from '../../types';

interface CaseDetailPageProps {
  vascCase: VascCase;
  onBack: () => void;
  onStart: () => void;
}

export function CaseDetailPage({ vascCase, onBack, onStart }: CaseDetailPageProps) {
  return (
    <div className="page-stack">
      <header className="page-header split-header">
        <div>
          <p className="eyebrow">Case detail</p>
          <h2>{vascCase.title}</h2>
          <p>{vascCase.diagnosis}</p>
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
          <h4>History</h4>
          <ul className="compact-list">
            {vascCase.patient.history.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </article>

        <article className="content-card">
          <h3>Learning objectives</h3>
          <ol className="compact-list numbered">
            {vascCase.learningObjectives.map((item) => <li key={item}>{item}</li>)}
          </ol>
          <div className="tag-row spacious">
            {vascCase.tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}
          </div>
        </article>
      </section>

      <section className="content-card">
        <h3>Imaging</h3>
        <p>{vascCase.volume.description}</p>
        <p className="muted">
          Next infrastructure step: replace the mock viewer with Rust/Tauri NRRD loading and Canvas rendering.
        </p>
      </section>
    </div>
  );
}
