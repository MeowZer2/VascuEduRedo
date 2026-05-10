import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  adminCreateCase,
  adminCreateQuestion,
  adminDeleteCase,
  adminDeleteQuestion,
  adminGetCaseWithQuestions,
  adminListCases,
  adminReorderQuestions,
  adminUpdateCase,
  adminUpdateQuestion,
  isAdminAvailable,
  type AdminCaseInput,
  type AdminCaseRow,
  type AdminQuestionInput,
  type AdminQuestionRow,
} from '../../lib/admin';
import { QuestionEditor, draftToQuestionInput, questionRowToDraft, type QuestionDraft } from './QuestionEditor';

export interface AdminContentPageProps {
  /** Notify the host app that the case set changed so it can refresh its store. */
  onCasesChanged: () => void;
  /** Open the given case in the training workspace. */
  onOpenInTraining: (caseId: string) => void;
}

interface CaseDraft {
  slug: string;
  title: string;
  summary: string;
  category: string;
  volumePath: string;
}

const EMPTY_CASE_DRAFT: CaseDraft = {
  slug: '',
  title: '',
  summary: '',
  category: '',
  volumePath: '',
};

function caseRowToDraft(row: AdminCaseRow): CaseDraft {
  return {
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    category: row.category,
    volumePath: row.volumePath ?? '',
  };
}

function validateCaseDraft(draft: CaseDraft): string[] {
  const errors: string[] = [];
  if (!draft.title.trim()) errors.push('Title is required.');
  if (!draft.slug.trim()) errors.push('Slug is required.');
  else if (!/^[a-z0-9][a-z0-9-_]*$/i.test(draft.slug.trim())) {
    errors.push('Slug must be alphanumeric (dashes/underscores allowed).');
  }
  if (!draft.summary.trim()) errors.push('Summary is required.');
  if (!draft.category.trim()) errors.push('Category is required.');
  return errors;
}

export function AdminContentPage({ onCasesChanged, onOpenInTraining }: AdminContentPageProps) {
  const available = isAdminAvailable();
  const [cases, setCases] = useState<AdminCaseRow[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [caseDraft, setCaseDraft] = useState<CaseDraft>(EMPTY_CASE_DRAFT);
  const [caseDirty, setCaseDirty] = useState(false);
  const [creatingNewCase, setCreatingNewCase] = useState(false);
  const [questions, setQuestions] = useState<AdminQuestionRow[]>([]);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const [questionDraft, setQuestionDraft] = useState<QuestionDraft | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  const loadCaseDetail = useCallback(
    async (caseId: string) => {
      try {
        const detail = await adminGetCaseWithQuestions(caseId);
        if (!detail) {
          setQuestions([]);
          setSelectedQuestionId(null);
          setQuestionDraft(null);
          return;
        }
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
      } catch (e) {
        flashError(`Failed to load case: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [flashError],
  );

  // Initial load.
  useEffect(() => {
    if (!available) return;
    void refreshCases().then((rows) => {
      if (rows[0]) {
        setSelectedCaseId(rows[0].id);
      }
    });
  }, [available, refreshCases]);

  // Whenever selection changes (and we're not in "new case" mode), reload detail.
  useEffect(() => {
    if (!available || creatingNewCase || !selectedCaseId) return;
    void loadCaseDetail(selectedCaseId);
  }, [available, creatingNewCase, selectedCaseId, loadCaseDetail]);

  function startNewCase() {
    setCreatingNewCase(true);
    setSelectedCaseId(null);
    setCaseDraft(EMPTY_CASE_DRAFT);
    setCaseDirty(true);
    setQuestions([]);
    setSelectedQuestionId(null);
    setQuestionDraft(null);
  }

  function selectCase(id: string) {
    setCreatingNewCase(false);
    setSelectedCaseId(id);
  }

  async function saveCase() {
    const errors = validateCaseDraft(caseDraft);
    if (errors.length > 0) {
      flashError(errors.join(' '));
      return;
    }
    const input: AdminCaseInput = {
      slug: caseDraft.slug.trim(),
      title: caseDraft.title.trim(),
      summary: caseDraft.summary.trim(),
      category: caseDraft.category.trim(),
      volumePath: caseDraft.volumePath.trim() ? caseDraft.volumePath.trim() : null,
    };

    setBusy(true);
    try {
      let saved: AdminCaseRow;
      if (creatingNewCase || !selectedCaseId) {
        saved = await adminCreateCase(input);
        flashStatus(`Created "${saved.title}".`);
      } else {
        saved = await adminUpdateCase(selectedCaseId, input);
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
    const ok = window.confirm(`Delete "${target.title}" and all of its questions?`);
    if (!ok) return;
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
        setQuestions([]);
        setSelectedQuestionId(null);
        setQuestionDraft(null);
      }
      onCasesChanged();
    } catch (e) {
      flashError(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
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
      // multipleChoice defaults
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
    const ok = window.confirm('Delete this question?');
    if (!ok) return;
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
        <h2>Cases & questions</h2>
        <p>Create, edit, and reorder content. Changes save directly to the local SQLite database.</p>
      </header>

      {(statusMsg || errorMsg) && (
        <div className={errorMsg ? 'admin-banner error' : 'admin-banner success'} role="status">
          {errorMsg ?? statusMsg}
        </div>
      )}

      <section className="admin-layout">
        <aside className="admin-cases-panel">
          <div className="admin-panel-header">
            <h3>Cases</h3>
            <button
              type="button"
              className="secondary-button small"
              onClick={startNewCase}
              disabled={busy}
            >
              + New
            </button>
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
              <h3>{creatingNewCase ? 'New case' : selectedCase ? 'Edit case' : 'Select a case'}</h3>
              <div className="admin-panel-actions">
                {!creatingNewCase && selectedCase && (
                  <button
                    type="button"
                    className="secondary-button small"
                    onClick={() => onOpenInTraining(selectedCase.id)}
                    disabled={busy || caseDirty}
                    title={caseDirty ? 'Save your changes first' : 'Open this case in the training workspace'}
                  >
                    Open in Training
                  </button>
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
                <label className="field-label">
                  <span>Title</span>
                  <input
                    className="text-input"
                    value={caseDraft.title}
                    onChange={(e) => {
                      setCaseDraft({ ...caseDraft, title: e.target.value });
                      setCaseDirty(true);
                    }}
                  />
                </label>
                <label className="field-label">
                  <span>Slug</span>
                  <input
                    className="text-input"
                    value={caseDraft.slug}
                    onChange={(e) => {
                      setCaseDraft({ ...caseDraft, slug: e.target.value });
                      setCaseDirty(true);
                    }}
                    placeholder="aaa-001"
                  />
                </label>
                <label className="field-label">
                  <span>Category</span>
                  <input
                    className="text-input"
                    value={caseDraft.category}
                    onChange={(e) => {
                      setCaseDraft({ ...caseDraft, category: e.target.value });
                      setCaseDirty(true);
                    }}
                    placeholder="aaa"
                  />
                </label>
                <label className="field-label">
                  <span>Summary</span>
                  <textarea
                    className="text-input textarea"
                    value={caseDraft.summary}
                    onChange={(e) => {
                      setCaseDraft({ ...caseDraft, summary: e.target.value });
                      setCaseDirty(true);
                    }}
                  />
                </label>
                <label className="field-label">
                  <span>Volume path (.nrrd)</span>
                  <input
                    className="text-input"
                    value={caseDraft.volumePath}
                    onChange={(e) => {
                      setCaseDraft({ ...caseDraft, volumePath: e.target.value });
                      setCaseDirty(true);
                    }}
                    placeholder="content/aaa/volumes/sample-aaa-001.nrrd"
                  />
                </label>

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
    </div>
  );
}

