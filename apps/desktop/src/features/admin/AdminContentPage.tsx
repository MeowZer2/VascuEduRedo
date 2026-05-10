import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  adminCreateCase,
  adminCreateQuestion,
  adminDeleteCase,
  adminDeleteQuestion,
  adminExportCase,
  adminGetCaseWithQuestions,
  adminListCases,
  adminReorderQuestions,
  adminUpdateCase,
  adminUpdateQuestion,
  adminValidateCase,
  isAdminAvailable,
  type AdminCaseInput,
  type AdminCaseRow,
  type AdminQuestionInput,
  type AdminQuestionRow,
  type ValidationReport,
} from '../../lib/admin';
import { listVesselCompositions, type VesselCompositionRow } from '../../lib/vesselComposer';
import { AdminDevicesTab } from './AdminDevicesTab';
import { CaseImportDialog } from './CaseImportDialog';
import { ListEditor } from './ListEditor';
import { QuestionEditor, draftToQuestionInput, questionRowToDraft, type QuestionDraft } from './QuestionEditor';

export interface AdminContentPageProps {
  onCasesChanged: () => void;
  onOpenInTraining: (caseId: string) => void;
  onOpenVesselComposer: (caseId: string) => void;
}

type AdminSection = 'cases' | 'devices';

type Difficulty = 'beginner' | 'intermediate' | 'advanced';

interface CaseDraft {
  slug: string;
  title: string;
  summary: string;
  category: string;
  volumePath: string;
  diagnosis: string;
  difficulty: Difficulty;
  /** Stored as string while editing so an empty input doesn't coerce to 0. */
  estimatedMinutes: number | string;
  learningObjectives: string[];
  teachingPoints: string[];
  references: string[];
  tags: string[];
  author: string;
  reviewer: string;
  /** ISO date string (YYYY-MM-DD) — what `<input type="date">` produces. */
  lastReviewedAt: string;
}

const EMPTY_CASE_DRAFT: CaseDraft = {
  slug: '',
  title: '',
  summary: '',
  category: '',
  volumePath: '',
  diagnosis: '',
  difficulty: 'intermediate',
  estimatedMinutes: '',
  learningObjectives: [],
  teachingPoints: [],
  references: [],
  tags: [],
  author: '',
  reviewer: '',
  lastReviewedAt: '',
};

function caseRowToDraft(row: AdminCaseRow): CaseDraft {
  const data = (row.data ?? {}) as Record<string, unknown>;
  return {
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    category: row.category,
    volumePath: row.volumePath ?? '',
    diagnosis: (data.diagnosis as string | undefined) ?? '',
    difficulty: ((data.difficulty as Difficulty | undefined) ?? 'intermediate'),
    estimatedMinutes: (data.estimatedMinutes as number | undefined) ?? '',
    learningObjectives: ((data.learningObjectives as string[] | undefined) ?? []).slice(),
    teachingPoints: ((data.teachingPoints as string[] | undefined) ?? []).slice(),
    references: ((data.references as string[] | undefined) ?? []).slice(),
    tags: ((data.tags as string[] | undefined) ?? []).slice(),
    author: (data.author as string | undefined) ?? '',
    reviewer: (data.reviewer as string | undefined) ?? '',
    lastReviewedAt: normalizeDate((data.lastReviewedAt as string | undefined) ?? ''),
  };
}

function normalizeDate(input: string): string {
  if (!input) return '';
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  // Always render as YYYY-MM-DD so the date input controls correctly.
  return d.toISOString().slice(0, 10);
}

function toFiniteNumber(value: number | string): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

interface DraftConversion {
  ok: boolean;
  errors: string[];
  input?: AdminCaseInput;
}

/**
 * Convert a CaseDraft into an AdminCaseInput, validating the strict subset of fields
 * that we always require and merging the editable extended metadata into `data`.
 * The original `data` blob (patient, volume.description, etc.) is preserved for
 * fields the form doesn't cover, so we don't lose data on save.
 */
function caseDraftToInput(draft: CaseDraft, original: AdminCaseRow | null): DraftConversion {
  const errors: string[] = [];
  if (!draft.title.trim()) errors.push('Title is required.');
  const slug = draft.slug.trim();
  if (!slug) errors.push('Slug is required.');
  else if (!/^[a-z0-9][a-z0-9-_]*$/i.test(slug)) {
    errors.push('Slug must be alphanumeric (dashes/underscores allowed).');
  }
  if (!draft.summary.trim()) errors.push('Summary is required.');
  if (!draft.category.trim()) errors.push('Category is required.');

  let estimatedMinutes: number | undefined;
  if (draft.estimatedMinutes !== '' && draft.estimatedMinutes !== null) {
    const n = toFiniteNumber(draft.estimatedMinutes);
    if (n === null || !Number.isInteger(n) || n <= 0) {
      errors.push('Estimated minutes must be a positive integer.');
    } else {
      estimatedMinutes = n;
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  // Preserve fields the editor doesn't touch (e.g. patient, volume.description).
  const baseData: Record<string, unknown> = { ...(original?.data ?? {}) };
  baseData.diagnosis = draft.diagnosis.trim();
  baseData.difficulty = draft.difficulty;
  if (estimatedMinutes !== undefined) baseData.estimatedMinutes = estimatedMinutes;
  else delete baseData.estimatedMinutes;
  baseData.learningObjectives = draft.learningObjectives.map((s) => s.trim()).filter(Boolean);
  setOrDelete(baseData, 'teachingPoints', draft.teachingPoints.map((s) => s.trim()).filter(Boolean));
  setOrDelete(baseData, 'references', draft.references.map((s) => s.trim()).filter(Boolean));
  baseData.tags = draft.tags.map((s) => s.trim()).filter(Boolean);
  setOrDelete(baseData, 'author', draft.author.trim() || undefined);
  setOrDelete(baseData, 'reviewer', draft.reviewer.trim() || undefined);
  setOrDelete(baseData, 'lastReviewedAt', draft.lastReviewedAt.trim() || undefined);

  return {
    ok: true,
    errors: [],
    input: {
      slug,
      title: draft.title.trim(),
      summary: draft.summary.trim(),
      category: draft.category.trim(),
      volumePath: draft.volumePath.trim() ? draft.volumePath.trim() : null,
      data: baseData,
    },
  };
}

function setOrDelete<T>(obj: Record<string, unknown>, key: string, value: T | undefined | null) {
  if (value === undefined || value === null) {
    delete obj[key];
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      delete obj[key];
      return;
    }
  }
  obj[key] = value;
}

export function AdminContentPage({
  onCasesChanged,
  onOpenInTraining,
  onOpenVesselComposer,
}: AdminContentPageProps) {
  const available = isAdminAvailable();
  const [cases, setCases] = useState<AdminCaseRow[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [originalCase, setOriginalCase] = useState<AdminCaseRow | null>(null);
  const [caseDraft, setCaseDraft] = useState<CaseDraft>(EMPTY_CASE_DRAFT);
  const [caseDirty, setCaseDirty] = useState(false);
  const [creatingNewCase, setCreatingNewCase] = useState(false);
  const [questions, setQuestions] = useState<AdminQuestionRow[]>([]);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const [questionDraft, setQuestionDraft] = useState<QuestionDraft | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [healthReport, setHealthReport] = useState<ValidationReport | null>(null);
  const [section, setSection] = useState<AdminSection>('cases');
  const [selectedCasePlans, setSelectedCasePlans] = useState<VesselCompositionRow[]>([]);

  const flashStatus = useCallback((msg: string) => {
    setStatusMsg(msg);
    setErrorMsg(null);
    window.setTimeout(() => setStatusMsg((current) => (current === msg ? null : current)), 2500);
  }, []);

  const flashError = useCallback((msg: string) => {
    setErrorMsg(msg);
    setStatusMsg(null);
  }, []);

  const refreshCases = useCallback(async () => {
    try {
      const rows = await adminListCases();
      setCases(rows);
      return rows;
    } catch (e) {
      flashError(`Failed to load cases: ${e instanceof Error ? e.message : String(e)}`);
      return [] as AdminCaseRow[];
    }
  }, [flashError]);

  const refreshHealth = useCallback(
    async (caseId: string) => {
      try {
        const report = await adminValidateCase(caseId);
        setHealthReport(report);
      } catch (e) {
        // Health is informational; surface but don't block the page.
        console.warn('admin_validate_case failed:', e);
        setHealthReport(null);
      }
    },
    [],
  );

  const loadCaseDetail = useCallback(
    async (caseId: string) => {
      try {
        const detail = await adminGetCaseWithQuestions(caseId);
        if (!detail) {
          setQuestions([]);
          setSelectedQuestionId(null);
          setQuestionDraft(null);
          setOriginalCase(null);
          setHealthReport(null);
          return;
        }
        setOriginalCase(detail);
        setCaseDraft(caseRowToDraft(detail));
        setCaseDirty(false);
        setQuestions(detail.questions);
        if (detail.questions[0]) {
          setSelectedQuestionId(detail.questions[0].id);
          setQuestionDraft(questionRowToDraft(detail.questions[0]));
        } else {
          setSelectedQuestionId(null);
          setQuestionDraft(null);
        }
        await refreshHealth(caseId);
      } catch (e) {
        flashError(`Failed to load case: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [flashError, refreshHealth],
  );

  useEffect(() => {
    if (!available) return;
    void refreshCases().then((rows) => {
      if (rows[0]) setSelectedCaseId(rows[0].id);
    });
  }, [available, refreshCases]);

  useEffect(() => {
    if (!available || creatingNewCase || !selectedCaseId) return;
    void loadCaseDetail(selectedCaseId);
  }, [available, creatingNewCase, selectedCaseId, loadCaseDetail]);

  useEffect(() => {
    if (!available || !selectedCaseId || creatingNewCase) {
      setSelectedCasePlans([]);
      return;
    }
    let cancelled = false;
    void listVesselCompositions(selectedCaseId)
      .then((rows) => {
        if (!cancelled) setSelectedCasePlans(rows);
      })
      .catch(() => {
        if (!cancelled) setSelectedCasePlans([]);
      });
    return () => {
      cancelled = true;
    };
  }, [available, creatingNewCase, selectedCaseId]);

  function startNewCase() {
    setCreatingNewCase(true);
    setSelectedCaseId(null);
    setOriginalCase(null);
    setCaseDraft(EMPTY_CASE_DRAFT);
    setCaseDirty(true);
    setQuestions([]);
    setSelectedQuestionId(null);
    setQuestionDraft(null);
    setHealthReport(null);
  }

  function selectCase(id: string) {
    setCreatingNewCase(false);
    setSelectedCaseId(id);
  }

  function patchDraft<K extends keyof CaseDraft>(key: K, value: CaseDraft[K]) {
    setCaseDraft((d) => ({ ...d, [key]: value }));
    setCaseDirty(true);
  }

  async function saveCase() {
    const conv = caseDraftToInput(caseDraft, originalCase);
    if (!conv.ok || !conv.input) {
      flashError(conv.errors.join(' '));
      return;
    }
    setBusy(true);
    try {
      let saved: AdminCaseRow;
      if (creatingNewCase || !selectedCaseId) {
        saved = await adminCreateCase(conv.input);
        flashStatus(`Created "${saved.title}".`);
      } else {
        saved = await adminUpdateCase(selectedCaseId, conv.input);
        flashStatus(`Saved "${saved.title}".`);
      }
      setCreatingNewCase(false);
      setSelectedCaseId(saved.id);
      setCaseDirty(false);
      await refreshCases();
      await loadCaseDetail(saved.id);
      onCasesChanged();
    } catch (e) {
      flashError(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function deleteCase() {
    if (!selectedCaseId) return;
    const target = cases.find((c) => c.id === selectedCaseId);
    if (!target) return;
    if (!window.confirm(`Delete "${target.title}" and all of its questions?`)) return;
    setBusy(true);
    try {
      await adminDeleteCase(selectedCaseId);
      flashStatus(`Deleted "${target.title}".`);
      const remaining = await refreshCases();
      const next = remaining[0]?.id ?? null;
      setSelectedCaseId(next);
      setCreatingNewCase(false);
      if (!next) {
        setCaseDraft(EMPTY_CASE_DRAFT);
        setOriginalCase(null);
        setQuestions([]);
        setSelectedQuestionId(null);
        setQuestionDraft(null);
        setHealthReport(null);
      }
      onCasesChanged();
    } catch (e) {
      flashError(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function exportSelected() {
    if (!selectedCaseId) return;
    setBusy(true);
    try {
      const payload = await adminExportCase(selectedCaseId);
      if (!payload) {
        flashError('Export returned no payload.');
        return;
      }
      downloadJson(`${payload.case.slug || 'case'}.case.json`, payload);
      flashStatus(`Exported "${payload.case.title}".`);
    } catch (e) {
      flashError(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  function handleAddQuestion() {
    if (!selectedCaseId) {
      flashError('Save the case first before adding questions.');
      return;
    }
    setSelectedQuestionId(null);
    setQuestionDraft({
      id: null,
      type: 'multipleChoice',
      prompt: '',
      explanation: '',
      points: 1,
      hints: [],
      choices: [
        { id: 'a', label: '' },
        { id: 'b', label: '' },
      ],
      correctChoiceId: 'a',
      correctChoiceIds: [],
      correct: false,
      correctValue: '',
      tolerance: '',
      unit: '',
      requiredKeywords: [],
      plane: 'axial',
      target: '',
      allowedCategory: '',
      correctDeviceId: '',
    });
  }

  function selectQuestion(id: string) {
    const q = questions.find((row) => row.id === id);
    if (!q) return;
    setSelectedQuestionId(id);
    setQuestionDraft(questionRowToDraft(q));
  }

  async function saveQuestion(input: AdminQuestionInput) {
    if (!selectedCaseId) return;
    setBusy(true);
    try {
      let saved: AdminQuestionRow;
      if (questionDraft?.id) {
        saved = await adminUpdateQuestion(questionDraft.id, input);
        flashStatus('Question saved.');
      } else {
        saved = await adminCreateQuestion(selectedCaseId, input);
        flashStatus('Question created.');
      }
      await loadCaseDetail(selectedCaseId);
      setSelectedQuestionId(saved.id);
      setQuestionDraft(questionRowToDraft(saved));
      onCasesChanged();
    } catch (e) {
      flashError(`Question save failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function deleteQuestion() {
    if (!questionDraft?.id || !selectedCaseId) return;
    if (!window.confirm('Delete this question?')) return;
    setBusy(true);
    try {
      await adminDeleteQuestion(questionDraft.id);
      flashStatus('Question deleted.');
      await loadCaseDetail(selectedCaseId);
      onCasesChanged();
    } catch (e) {
      flashError(`Question delete failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function moveQuestion(qid: string, direction: -1 | 1) {
    if (!selectedCaseId) return;
    const idx = questions.findIndex((q) => q.id === qid);
    const swap = idx + direction;
    if (idx < 0 || swap < 0 || swap >= questions.length) return;
    const reordered = [...questions];
    [reordered[idx], reordered[swap]] = [reordered[swap], reordered[idx]];
    setBusy(true);
    try {
      await adminReorderQuestions(
        selectedCaseId,
        reordered.map((q) => q.id),
      );
      await loadCaseDetail(selectedCaseId);
      setSelectedQuestionId(qid);
      onCasesChanged();
    } catch (e) {
      flashError(`Reorder failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const selectedCase = useMemo(
    () => (selectedCaseId ? cases.find((c) => c.id === selectedCaseId) ?? null : null),
    [selectedCaseId, cases],
  );

  if (!available) {
    return (
      <div className="page-stack">
        <header className="page-header">
          <p className="eyebrow">Admin authoring</p>
          <h2>Desktop mode required</h2>
          <p>
            The case authoring tools talk to SQLite through the Rust bridge. Launch the app with
            <code> pnpm dev </code> from <code>apps/desktop</code> to enable them.
          </p>
        </header>
      </div>
    );
  }

  return (
    <div className="page-stack admin-page">
      <header className="page-header">
        <p className="eyebrow">Admin authoring</p>
        <h2>{section === 'devices' ? 'Devices' : 'Cases & questions'}</h2>
        <p>
          {section === 'devices'
            ? 'Create, edit, and delete vascular devices stored in the local SQLite catalog.'
            : 'Create, edit, and reorder content. Changes save directly to the local SQLite database.'}
        </p>
      </header>

      <div className="admin-section-tabs" role="tablist" aria-label="Admin section">
        <button
          type="button"
          className={section === 'cases' ? 'plane-tab active' : 'plane-tab'}
          onClick={() => setSection('cases')}
        >
          Cases & questions
        </button>
        <button
          type="button"
          className={section === 'devices' ? 'plane-tab active' : 'plane-tab'}
          onClick={() => setSection('devices')}
        >
          Devices
        </button>
      </div>

      {section === 'devices' ? <AdminDevicesTab /> : null}

      {section === 'cases' && (statusMsg || errorMsg) && (
        <div className={errorMsg ? 'admin-banner error' : 'admin-banner success'} role="status">
          {errorMsg ?? statusMsg}
        </div>
      )}

      {section === 'cases' && (
      <section className="admin-layout">
        <aside className="admin-cases-panel">
          <div className="admin-panel-header">
            <h3>Cases</h3>
            <div className="admin-panel-actions">
              <button
                type="button"
                className="secondary-button small"
                onClick={() => setShowImport(true)}
                disabled={busy}
              >
                Import…
              </button>
              <button
                type="button"
                className="secondary-button small"
                onClick={startNewCase}
                disabled={busy}
              >
                + New
              </button>
            </div>
          </div>
          <ul className="admin-case-list">
            {creatingNewCase && (
              <li className="admin-case-item active">
                <strong>New case</strong>
                <span>Unsaved</span>
              </li>
            )}
            {cases.map((c) => (
              <li
                key={c.id}
                className={
                  !creatingNewCase && c.id === selectedCaseId
                    ? 'admin-case-item active'
                    : 'admin-case-item'
                }
              >
                <button
                  type="button"
                  className="admin-case-button"
                  onClick={() => selectCase(c.id)}
                  disabled={busy}
                >
                  <strong>{c.title || '(untitled)'}</strong>
                  <span>
                    {c.category || 'uncategorized'} · {c.slug}
                  </span>
                </button>
              </li>
            ))}
            {cases.length === 0 && !creatingNewCase && (
              <li className="admin-case-item muted">No cases yet. Hit <em>+ New</em> to author one.</li>
            )}
          </ul>
        </aside>

        <div className="admin-main">
          <section className="content-card admin-case-editor">
            <header className="admin-panel-header">
              <div className="admin-panel-title">
                <h3>{creatingNewCase ? 'New case' : selectedCase ? 'Edit case' : 'Select a case'}</h3>
                {!creatingNewCase && selectedCase && (
                  <span className={`health-pill ${selectedCasePlans.length > 0 ? 'ok' : 'warning'}`}>
                    {selectedCasePlans.length > 0 ? 'Vessel plan linked' : 'No vessel plan'}
                  </span>
                )}
              </div>
              <div className="admin-panel-actions">
                {!creatingNewCase && selectedCase && (
                  <>
                    <button
                      type="button"
                      className="secondary-button small"
                      onClick={() => void exportSelected()}
                      disabled={busy}
                      title="Download this case (and its questions) as JSON"
                    >
                      Export JSON
                    </button>
                    <button
                      type="button"
                      className="secondary-button small"
                      onClick={() => onOpenInTraining(selectedCase.id)}
                      disabled={busy || caseDirty}
                      title={caseDirty ? 'Save your changes first' : 'Open this case in the training workspace'}
                    >
                      Open in Training
                    </button>
                    <button
                      type="button"
                      className="secondary-button small"
                      onClick={() => onOpenVesselComposer(selectedCase.id)}
                      disabled={busy}
                      title="Open this case in the vessel composer"
                    >
                      {selectedCasePlans.length > 0 ? 'Open Plan' : 'Create Plan'}
                    </button>
                  </>
                )}
              </div>
            </header>

            {(creatingNewCase || selectedCase) ? (
              <form
                className="admin-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveCase();
                }}
              >
                <div className="admin-form-grid">
                  <label className="field-label">
                    <span>Title</span>
                    <input
                      className="text-input"
                      value={caseDraft.title}
                      onChange={(e) => patchDraft('title', e.target.value)}
                    />
                  </label>
                  <label className="field-label">
                    <span>Slug</span>
                    <input
                      className="text-input"
                      value={caseDraft.slug}
                      onChange={(e) => patchDraft('slug', e.target.value)}
                      placeholder="aaa-001"
                    />
                  </label>
                </div>

                <div className="admin-form-grid">
                  <label className="field-label">
                    <span>Category</span>
                    <input
                      className="text-input"
                      value={caseDraft.category}
                      onChange={(e) => patchDraft('category', e.target.value)}
                      placeholder="aaa"
                    />
                  </label>
                  <label className="field-label">
                    <span>Difficulty</span>
                    <select
                      className="text-input"
                      value={caseDraft.difficulty}
                      onChange={(e) => patchDraft('difficulty', e.target.value as Difficulty)}
                    >
                      <option value="beginner">Beginner</option>
                      <option value="intermediate">Intermediate</option>
                      <option value="advanced">Advanced</option>
                    </select>
                  </label>
                </div>

                <div className="admin-form-grid">
                  <label className="field-label">
                    <span>Estimated minutes</span>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      className="text-input"
                      value={caseDraft.estimatedMinutes}
                      onChange={(e) =>
                        patchDraft(
                          'estimatedMinutes',
                          e.target.value === '' ? '' : Number(e.target.value),
                        )
                      }
                      placeholder="10"
                    />
                  </label>
                  <label className="field-label">
                    <span>Volume path (.nrrd)</span>
                    <input
                      className="text-input"
                      value={caseDraft.volumePath}
                      onChange={(e) => patchDraft('volumePath', e.target.value)}
                      placeholder="content/aaa/volumes/sample-aaa-001.nrrd"
                    />
                  </label>
                </div>

                <label className="field-label">
                  <span>Summary</span>
                  <textarea
                    className="text-input textarea"
                    value={caseDraft.summary}
                    onChange={(e) => patchDraft('summary', e.target.value)}
                  />
                </label>

                <label className="field-label">
                  <span>Diagnosis</span>
                  <input
                    className="text-input"
                    value={caseDraft.diagnosis}
                    onChange={(e) => patchDraft('diagnosis', e.target.value)}
                    placeholder="Asymptomatic infrarenal abdominal aortic aneurysm"
                  />
                </label>

                <fieldset className="admin-fieldset">
                  <legend>Learning objectives</legend>
                  <ListEditor
                    values={caseDraft.learningObjectives}
                    onChange={(v) => patchDraft('learningObjectives', v)}
                    placeholder="Identify the key CTA measurements before EVAR…"
                    addLabel="+ Objective"
                  />
                </fieldset>

                <fieldset className="admin-fieldset">
                  <legend>Teaching points</legend>
                  <ListEditor
                    values={caseDraft.teachingPoints}
                    onChange={(v) => patchDraft('teachingPoints', v)}
                    placeholder="A 6.1 cm AAA in a fit patient generally meets criteria for repair…"
                    multiline
                    addLabel="+ Teaching point"
                  />
                </fieldset>

                <fieldset className="admin-fieldset">
                  <legend>References</legend>
                  <ListEditor
                    values={caseDraft.references}
                    onChange={(v) => patchDraft('references', v)}
                    placeholder="Author et al. JVS 2023; 78(2):123–134"
                    addLabel="+ Reference"
                  />
                </fieldset>

                <fieldset className="admin-fieldset">
                  <legend>Tags</legend>
                  <ListEditor
                    values={caseDraft.tags}
                    onChange={(v) => patchDraft('tags', v)}
                    placeholder="EVAR"
                    addLabel="+ Tag"
                  />
                </fieldset>

                <div className="admin-form-grid three">
                  <label className="field-label">
                    <span>Author</span>
                    <input
                      className="text-input"
                      value={caseDraft.author}
                      onChange={(e) => patchDraft('author', e.target.value)}
                    />
                  </label>
                  <label className="field-label">
                    <span>Reviewer</span>
                    <input
                      className="text-input"
                      value={caseDraft.reviewer}
                      onChange={(e) => patchDraft('reviewer', e.target.value)}
                    />
                  </label>
                  <label className="field-label">
                    <span>Last reviewed</span>
                    <input
                      type="date"
                      className="text-input"
                      value={caseDraft.lastReviewedAt}
                      onChange={(e) => patchDraft('lastReviewedAt', e.target.value)}
                    />
                  </label>
                </div>

                <div className="admin-form-actions">
                  <button type="submit" className="primary-button" disabled={busy}>
                    {creatingNewCase ? 'Create case' : 'Save case'}
                  </button>
                  {!creatingNewCase && selectedCase && (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => void deleteCase()}
                      disabled={busy}
                    >
                      Delete case
                    </button>
                  )}
                  {creatingNewCase && (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        setCreatingNewCase(false);
                        if (cases[0]) setSelectedCaseId(cases[0].id);
                      }}
                      disabled={busy}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </form>
            ) : (
              <p className="muted">Pick a case on the left, or create a new one.</p>
            )}
          </section>

          {!creatingNewCase && selectedCase && healthReport && (
            <ContentHealthCard report={healthReport} questionRows={questions} onJumpToQuestion={selectQuestion} />
          )}

          <section className="content-card admin-questions-panel">
            <header className="admin-panel-header">
              <h3>Questions</h3>
              <button
                type="button"
                className="secondary-button small"
                onClick={handleAddQuestion}
                disabled={busy || !selectedCaseId || creatingNewCase}
                title={
                  !selectedCaseId || creatingNewCase
                    ? 'Save the case first before adding questions.'
                    : 'Add a new question'
                }
              >
                + Question
              </button>
            </header>

            <div className="admin-questions-grid">
              <ul className="admin-question-list">
                {questions.map((q, idx) => (
                  <li
                    key={q.id}
                    className={
                      q.id === selectedQuestionId && questionDraft?.id === q.id
                        ? 'admin-question-row active'
                        : 'admin-question-row'
                    }
                  >
                    <button
                      type="button"
                      className="admin-question-button"
                      onClick={() => selectQuestion(q.id)}
                      disabled={busy}
                    >
                      <strong>
                        {idx + 1}. {q.prompt || '(no prompt)'}
                      </strong>
                      <span>{q.type}</span>
                    </button>
                    <div className="admin-question-row-actions">
                      <button
                        type="button"
                        className="secondary-button small"
                        onClick={() => void moveQuestion(q.id, -1)}
                        disabled={busy || idx === 0}
                        aria-label="Move up"
                        title="Move up"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="secondary-button small"
                        onClick={() => void moveQuestion(q.id, 1)}
                        disabled={busy || idx === questions.length - 1}
                        aria-label="Move down"
                        title="Move down"
                      >
                        ↓
                      </button>
                    </div>
                  </li>
                ))}
                {questions.length === 0 && !questionDraft && (
                  <li className="admin-question-row muted">
                    No questions yet. Hit <em>+ Question</em> to add one.
                  </li>
                )}
                {questionDraft && !questionDraft.id && (
                  <li className="admin-question-row active">
                    <span>
                      <strong>{questions.length + 1}. New question</strong>
                      <br />
                      <small>Unsaved</small>
                    </span>
                  </li>
                )}
              </ul>

              <div className="admin-question-editor-wrap">
                {questionDraft ? (
                  <QuestionEditor
                    key={questionDraft.id ?? 'new'}
                    draft={questionDraft}
                    onChange={setQuestionDraft}
                    onSave={(draft) => {
                      const result = draftToQuestionInput(draft);
                      if (!result.ok) {
                        flashError(result.errors.join(' '));
                        return;
                      }
                      void saveQuestion(result.input);
                    }}
                    onCancel={() => {
                      if (questionDraft.id) {
                        const original = questions.find((q) => q.id === questionDraft.id);
                        if (original) setQuestionDraft(questionRowToDraft(original));
                      } else {
                        setQuestionDraft(null);
                      }
                    }}
                    onDelete={questionDraft.id ? () => void deleteQuestion() : undefined}
                    busy={busy}
                  />
                ) : (
                  <p className="muted">Pick a question on the left, or hit <em>+ Question</em>.</p>
                )}
              </div>
            </div>
          </section>
        </div>
      </section>
      )}

      {section === 'cases' && showImport && (
        <CaseImportDialog
          onClose={() => setShowImport(false)}
          onImported={async (newCaseId) => {
            setShowImport(false);
            await refreshCases();
            setCreatingNewCase(false);
            setSelectedCaseId(newCaseId);
            onCasesChanged();
            flashStatus('Imported case into SQLite.');
          }}
        />
      )}
    </div>
  );
}

interface ContentHealthCardProps {
  report: ValidationReport;
  questionRows: AdminQuestionRow[];
  onJumpToQuestion: (id: string) => void;
}

function ContentHealthCard({ report, questionRows, onJumpToQuestion }: ContentHealthCardProps) {
  const status: 'ok' | 'warning' | 'error' = !report.ok
    ? 'error'
    : report.warnings.length > 0
      ? 'warning'
      : 'ok';
  const headline =
    status === 'ok'
      ? 'All clear'
      : status === 'warning'
        ? `${report.warnings.length} warning${report.warnings.length === 1 ? '' : 's'}`
        : `${report.errors.length} error${report.errors.length === 1 ? '' : 's'}`;

  return (
    <section className="content-card content-health">
      <header className="admin-panel-header">
        <h3>Content health</h3>
        <span className={`health-pill ${status}`}>{headline}</span>
      </header>
      {report.errors.length === 0 && report.warnings.length === 0 ? (
        <p className="muted">No issues detected.</p>
      ) : (
        <>
          {report.errors.length > 0 && (
            <ul className="health-list health-list-error">
              {report.errors.map((issue, idx) => (
                <HealthRow
                  key={`e-${idx}`}
                  issue={issue}
                  questionRows={questionRows}
                  onJumpToQuestion={onJumpToQuestion}
                />
              ))}
            </ul>
          )}
          {report.warnings.length > 0 && (
            <ul className="health-list health-list-warning">
              {report.warnings.map((issue, idx) => (
                <HealthRow
                  key={`w-${idx}`}
                  issue={issue}
                  questionRows={questionRows}
                  onJumpToQuestion={onJumpToQuestion}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function HealthRow({
  issue,
  questionRows,
  onJumpToQuestion,
}: {
  issue: { field: string; message: string; questionId: string | null };
  questionRows: AdminQuestionRow[];
  onJumpToQuestion: (id: string) => void;
}) {
  const targetQuestion = issue.questionId
    ? questionRows.find((q) => q.id === issue.questionId)
    : null;
  return (
    <li>
      <strong>{issue.field}</strong>: {issue.message}
      {targetQuestion && (
        <>
          {' '}
          <button
            type="button"
            className="link-button"
            onClick={() => onJumpToQuestion(targetQuestion.id)}
          >
            Open question →
          </button>
        </>
      )}
    </li>
  );
}

function downloadJson(filename: string, payload: unknown) {
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Free the object URL on the next tick so the click finishes first.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
