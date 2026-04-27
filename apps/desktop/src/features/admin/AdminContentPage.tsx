import { categories, cases } from '../../data/sampleContent';

export function AdminContentPage() {
  const questionCount = cases.reduce((sum, item) => sum + item.questions.length, 0);
  const objectives = cases.reduce((sum, item) => sum + item.learningObjectives.length, 0);

  return (
    <div className="page-stack">
      <header className="page-header">
        <p className="eyebrow">Admin preview</p>
        <h2>Content health before real authoring tools</h2>
        <p>
          This is not a full admin app yet. It shows the content model that should later become a proper case authoring workflow.
        </p>
      </header>

      <section className="grid-4">
        <article className="stat-card"><span>Categories</span><strong>{categories.length}</strong></article>
        <article className="stat-card"><span>Cases</span><strong>{cases.length}</strong></article>
        <article className="stat-card"><span>Questions</span><strong>{questionCount}</strong></article>
        <article className="stat-card"><span>Objectives</span><strong>{objectives}</strong></article>
      </section>

      <section className="content-card">
        <h3>Recommended content rules</h3>
        <ul className="compact-list">
          <li>Every case must have learning objectives.</li>
          <li>Every question must map to one objective.</li>
          <li>Every medical fact should eventually have a reference field.</li>
          <li>Every image/volume should have source, license, and de-identification metadata.</li>
          <li>Content packs should be versioned independently from the app.</li>
        </ul>
      </section>

      <section className="content-card">
        <h3>Content pack direction</h3>
        <pre className="code-block">{`content/aaa/
  content-pack.json
  cases.json
  questions.json
  volumes/
  diagrams/
  references.json`}</pre>
      </section>
    </div>
  );
}
