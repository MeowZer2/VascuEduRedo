import { useEffect, useState, type CSSProperties } from 'react';
import { type AdminQuestionInput, type AdminQuestionRow } from '../../lib/admin';
import { listDeviceCategories, listDevices, type Device } from '../../lib/devices';
import type { CaseBookmark, QuestionType } from '../../types';

const QUESTION_TYPES: { value: QuestionType; label: string }[] = [
  { value: 'multipleChoice', label: 'Multiple choice' },
  { value: 'multiSelect', label: 'Multi-select' },
  { value: 'trueFalse', label: 'True / false' },
  { value: 'numeric', label: 'Numeric' },
  { value: 'shortText', label: 'Short text' },
  { value: 'measurement', label: 'Measurement' },
  { value: 'deviceSelection', label: 'Device selection' },
];

const PLANES: Array<'axial' | 'coronal' | 'sagittal'> = ['axial', 'coronal', 'sagittal'];

export interface QuestionDraft {
  /** Existing question id (null for new). */
  id: string | null;
  type: QuestionType;
  prompt: string;
  explanation: string;
  /** Stored as string while editing so an empty box doesn't coerce to 0. */
  points: number | string;
  hints: string[];
  bookmarkId: string;
  // multipleChoice / multiSelect
  choices: { id: string; label: string }[];
  correctChoiceId: string;
  correctChoiceIds: string[];
  // trueFalse
  correct: boolean;
  // numeric / measurement
  correctValue: number | string;
  tolerance: number | string;
  unit: string;
  // shortText
  requiredKeywords: string[];
  // measurement
  plane: 'axial' | 'coronal' | 'sagittal';
  target: string;
  // deviceSelection
  allowedCategory: string;
  correctDeviceId: string;
}

function emptyDraft(type: QuestionType = 'multipleChoice'): QuestionDraft {
  return {
    id: null,
    type,
    prompt: '',
    explanation: '',
    points: 1,
    hints: [],
    bookmarkId: '',
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
  };
}

/** Convert a stored AdminQuestionRow into an editable draft, filling in sensible defaults. */
export function questionRowToDraft(row: AdminQuestionRow): QuestionDraft {
  const data = row.data ?? {};
  const get = <T,>(key: string): T | undefined => data[key] as T | undefined;
  const base = emptyDraft(row.type as QuestionType);

  return {
    ...base,
    id: row.id,
    type: row.type as QuestionType,
    prompt: row.prompt,
    explanation: (get<string>('explanation') ?? '') as string,
    points: (get<number>('points') ?? 1) as number,
    hints: ((get<string[]>('hints') ?? []) as string[]).slice(),
    bookmarkId: (get<string>('bookmarkId') ?? '') as string,
    choices: ((get<{ id: string; label: string }[]>('choices') ?? base.choices) as {
      id: string;
      label: string;
    }[]).map((c) => ({ ...c })),
    correctChoiceId: (get<string>('correctChoiceId') ?? base.correctChoiceId) as string,
    correctChoiceIds: ((get<string[]>('correctChoiceIds') ?? []) as string[]).slice(),
    correct: (get<boolean>('correct') ?? false) as boolean,
    correctValue: (get<number>('correctValue') ?? '') as number | string,
    tolerance: (get<number>('tolerance') ?? '') as number | string,
    unit: (get<string>('unit') ?? '') as string,
    requiredKeywords: ((get<string[]>('requiredKeywords') ?? []) as string[]).slice(),
    plane: (get<'axial' | 'coronal' | 'sagittal'>('plane') ?? 'axial') as
      | 'axial'
      | 'coronal'
      | 'sagittal',
    target: (get<string>('target') ?? '') as string,
    allowedCategory: (get<string>('allowedCategory') ?? '') as string,
    correctDeviceId: (get<string>('correctDeviceId') ?? '') as string,
  };
}

export type DraftConversion =
  | { ok: true; input: AdminQuestionInput }
  | { ok: false; errors: string[] };

function toFiniteNumber(value: number | string): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * Convert a draft to a backend payload, validating type-specific constraints.
 * Returns either `{ ok: true, input }` or `{ ok: false, errors }`.
 */
export function draftToQuestionInput(draft: QuestionDraft): DraftConversion {
  const errors: string[] = [];
  if (!draft.prompt.trim()) errors.push('Prompt is required.');

  const points = toFiniteNumber(draft.points);
  if (points === null || points < 0) errors.push('Points must be a non-negative number.');

  // Strip empty hints.
  const hints = draft.hints.map((h) => h.trim()).filter(Boolean);

  const data: Record<string, unknown> = {
    explanation: draft.explanation.trim(),
    points: points ?? 1,
  };
  if (hints.length > 0) data.hints = hints;
  if (draft.bookmarkId.trim()) data.bookmarkId = draft.bookmarkId.trim();

  switch (draft.type) {
    case 'multipleChoice': {
      const choices = draft.choices
        .map((c) => ({ id: c.id.trim(), label: c.label.trim() }))
        .filter((c) => c.id && c.label);
      if (choices.length < 2) errors.push('Multiple choice needs at least 2 choices.');
      if (new Set(choices.map((c) => c.id)).size !== choices.length) {
        errors.push('Choice ids must be unique.');
      }
      const correct = draft.correctChoiceId.trim();
      if (!correct || !choices.some((c) => c.id === correct)) {
        errors.push('Pick a correct choice.');
      }
      data.choices = choices;
      data.correctChoiceId = correct;
      break;
    }
    case 'multiSelect': {
      const choices = draft.choices
        .map((c) => ({ id: c.id.trim(), label: c.label.trim() }))
        .filter((c) => c.id && c.label);
      if (choices.length < 2) errors.push('Multi-select needs at least 2 choices.');
      if (new Set(choices.map((c) => c.id)).size !== choices.length) {
        errors.push('Choice ids must be unique.');
      }
      const correctIds = draft.correctChoiceIds.filter((id) => choices.some((c) => c.id === id));
      if (correctIds.length === 0) errors.push('Pick at least one correct answer.');
      data.choices = choices;
      data.correctChoiceIds = correctIds;
      break;
    }
    case 'trueFalse':
      data.correct = Boolean(draft.correct);
      break;
    case 'numeric': {
      const value = toFiniteNumber(draft.correctValue);
      const tol = toFiniteNumber(draft.tolerance) ?? 0;
      if (value === null) errors.push('Numeric needs a correct value.');
      if (tol < 0) errors.push('Tolerance must be ≥ 0.');
      data.correctValue = value ?? 0;
      data.tolerance = tol;
      if (draft.unit.trim()) data.unit = draft.unit.trim();
      break;
    }
    case 'shortText': {
      const keywords = draft.requiredKeywords.map((k) => k.trim()).filter(Boolean);
      if (keywords.length === 0) errors.push('Add at least one accepted keyword.');
      data.requiredKeywords = keywords;
      break;
    }
    case 'measurement': {
      if (!PLANES.includes(draft.plane)) errors.push('Pick a valid plane.');
      const value = toFiniteNumber(draft.correctValue);
      const tol = toFiniteNumber(draft.tolerance);
      if (value === null || value <= 0) errors.push('Measurement needs an expected value > 0.');
      if (tol === null || tol < 0) errors.push('Measurement tolerance must be ≥ 0.');
      data.plane = draft.plane;
      data.correctValue = value ?? 0;
      data.tolerance = tol ?? 0;
      data.unit = draft.unit.trim() || 'mm';
      if (draft.target.trim()) data.target = draft.target.trim();
      break;
    }
    case 'deviceSelection': {
      const deviceId = draft.correctDeviceId.trim();
      if (!deviceId) errors.push('Pick a correct device.');
      data.correctDeviceId = deviceId;
      if (draft.allowedCategory.trim()) {
        data.allowedCategory = draft.allowedCategory.trim();
      }
      break;
    }
    default:
      errors.push(`Unsupported question type: ${draft.type}`);
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    input: {
      type: draft.type,
      prompt: draft.prompt.trim(),
      data,
    },
  };
}

export interface QuestionEditorProps {
  draft: QuestionDraft;
  onChange: (next: QuestionDraft) => void;
  onSave: (draft: QuestionDraft) => void;
  onCancel: () => void;
  onDelete?: () => void;
  busy: boolean;
  bookmarks?: CaseBookmark[];
}

export function QuestionEditor({
  draft,
  onChange,
  onSave,
  onCancel,
  onDelete,
  busy,
  bookmarks = [],
}: QuestionEditorProps) {
  function patch<K extends keyof QuestionDraft>(key: K, value: QuestionDraft[K]) {
    onChange({ ...draft, [key]: value });
  }

  function changeType(nextType: QuestionType) {
    // Reset type-specific fields to a clean slate when switching types so we don't
    // leak stale data, but keep prompt/explanation/points/hints which are common.
    const fresh = emptyDraft(nextType);
    onChange({
      ...fresh,
      id: draft.id,
      prompt: draft.prompt,
      explanation: draft.explanation,
      points: draft.points,
      hints: draft.hints,
      bookmarkId: draft.bookmarkId,
    });
  }

  function addChoice() {
    const used = new Set(draft.choices.map((c) => c.id));
    const next = nextChoiceId(used);
    patch('choices', [...draft.choices, { id: next, label: '' }]);
  }

  function removeChoice(idx: number) {
    const next = draft.choices.filter((_, i) => i !== idx);
    onChange({
      ...draft,
      choices: next,
      correctChoiceId: next.some((c) => c.id === draft.correctChoiceId)
        ? draft.correctChoiceId
        : next[0]?.id ?? '',
      correctChoiceIds: draft.correctChoiceIds.filter((id) => next.some((c) => c.id === id)),
    });
  }

  function setChoice(idx: number, patchValues: Partial<{ id: string; label: string }>) {
    const next = draft.choices.map((c, i) => (i === idx ? { ...c, ...patchValues } : c));
    onChange({
      ...draft,
      choices: next,
      // Keep references to the (possibly renamed) id consistent.
      correctChoiceId:
        patchValues.id && draft.correctChoiceId === draft.choices[idx].id
          ? patchValues.id
          : draft.correctChoiceId,
      correctChoiceIds:
        patchValues.id && draft.correctChoiceIds.includes(draft.choices[idx].id)
          ? draft.correctChoiceIds.map((id) =>
              id === draft.choices[idx].id ? (patchValues.id as string) : id,
            )
          : draft.correctChoiceIds,
    });
  }

  return (
    <form
      className="admin-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(draft);
      }}
    >
      <div className="admin-form-grid">
        <label className="field-label">
          <span>Type</span>
          <select
            className="text-input"
            value={draft.type}
            onChange={(e) => changeType(e.target.value as QuestionType)}
          >
            {QUESTION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field-label">
          <span>Points</span>
          <input
            type="number"
            min={0}
            step={0.5}
            className="text-input"
            value={draft.points}
            onChange={(e) => patch('points', e.target.value === '' ? '' : Number(e.target.value))}
          />
        </label>
      </div>

      <label className="field-label">
        <span>Prompt</span>
        <textarea
          className="text-input textarea"
          value={draft.prompt}
          onChange={(e) => patch('prompt', e.target.value)}
          placeholder="What should the learner answer?"
        />
      </label>

      {renderTypeFields(draft, patch, addChoice, removeChoice, setChoice)}

      <label className="field-label">
        <span>Explanation / feedback</span>
        <textarea
          className="text-input textarea"
          value={draft.explanation}
          onChange={(e) => patch('explanation', e.target.value)}
          placeholder="Shown after the learner answers."
        />
      </label>

      <label className="field-label">
        <span>Hints (one per line, optional)</span>
        <textarea
          className="text-input textarea"
          value={draft.hints.join('\n')}
          onChange={(e) =>
            patch(
              'hints',
              e.target.value.split('\n').map((s) => s),
            )
          }
        />
      </label>

      <label className="field-label">
        <span>Referenced key finding (optional)</span>
        <select
          className="text-input"
          value={draft.bookmarkId}
          onChange={(e) => patch('bookmarkId', e.target.value)}
        >
          <option value="">No referenced finding</option>
          {bookmarks.map((bookmark) => (
            <option key={bookmark.id} value={bookmark.id}>
              {bookmark.title}
            </option>
          ))}
        </select>
      </label>

      <div className="admin-form-actions">
        <button type="submit" className="primary-button" disabled={busy}>
          {draft.id ? 'Save question' : 'Create question'}
        </button>
        <button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>
          {draft.id ? 'Revert' : 'Discard'}
        </button>
        {onDelete && (
          <button
            type="button"
            className="secondary-button"
            onClick={onDelete}
            disabled={busy}
          >
            Delete
          </button>
        )}
      </div>
    </form>
  );
}

function renderTypeFields(
  draft: QuestionDraft,
  patch: <K extends keyof QuestionDraft>(key: K, value: QuestionDraft[K]) => void,
  addChoice: () => void,
  removeChoice: (idx: number) => void,
  setChoice: (idx: number, patch: Partial<{ id: string; label: string }>) => void,
) {
  switch (draft.type) {
    case 'multipleChoice':
      return (
        <fieldset className="admin-fieldset">
          <legend>Choices</legend>
          {draft.choices.map((c, idx) => (
            <div key={idx} className="admin-choice-row">
              <input
                type="radio"
                name="correctChoice"
                checked={draft.correctChoiceId === c.id}
                onChange={() => patch('correctChoiceId', c.id)}
                aria-label="Mark correct"
              />
              <input
                className="text-input admin-choice-id"
                value={c.id}
                onChange={(e) => setChoice(idx, { id: e.target.value })}
                placeholder="id"
              />
              <input
                className="text-input"
                value={c.label}
                onChange={(e) => setChoice(idx, { label: e.target.value })}
                placeholder="Choice text"
              />
              <button
                type="button"
                className="secondary-button small"
                onClick={() => removeChoice(idx)}
                aria-label="Remove choice"
              >
                ✕
              </button>
            </div>
          ))}
          <button type="button" className="secondary-button small" onClick={addChoice}>
            + Choice
          </button>
        </fieldset>
      );
    case 'multiSelect':
      return (
        <fieldset className="admin-fieldset">
          <legend>Choices (check all correct answers)</legend>
          {draft.choices.map((c, idx) => (
            <div key={idx} className="admin-choice-row">
              <input
                type="checkbox"
                checked={draft.correctChoiceIds.includes(c.id)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...draft.correctChoiceIds, c.id]
                    : draft.correctChoiceIds.filter((id) => id !== c.id);
                  patch('correctChoiceIds', next);
                }}
                aria-label="Mark correct"
              />
              <input
                className="text-input admin-choice-id"
                value={c.id}
                onChange={(e) => setChoice(idx, { id: e.target.value })}
                placeholder="id"
              />
              <input
                className="text-input"
                value={c.label}
                onChange={(e) => setChoice(idx, { label: e.target.value })}
                placeholder="Choice text"
              />
              <button
                type="button"
                className="secondary-button small"
                onClick={() => removeChoice(idx)}
                aria-label="Remove choice"
              >
                ✕
              </button>
            </div>
          ))}
          <button type="button" className="secondary-button small" onClick={addChoice}>
            + Choice
          </button>
        </fieldset>
      );
    case 'trueFalse':
      return (
        <fieldset className="admin-fieldset">
          <legend>Correct answer</legend>
          <div className="binary-row">
            <label className="choice-button" style={draft.correct ? activeStyle : undefined}>
              <input
                type="radio"
                name="trueFalse"
                checked={draft.correct === true}
                onChange={() => patch('correct', true)}
                style={{ marginRight: 8 }}
              />
              True
            </label>
            <label className="choice-button" style={!draft.correct ? activeStyle : undefined}>
              <input
                type="radio"
                name="trueFalse"
                checked={draft.correct === false}
                onChange={() => patch('correct', false)}
                style={{ marginRight: 8 }}
              />
              False
            </label>
          </div>
        </fieldset>
      );
    case 'numeric':
      return (
        <fieldset className="admin-fieldset">
          <legend>Numeric answer</legend>
          <div className="admin-form-grid three">
            <label className="field-label">
              <span>Correct value</span>
              <input
                type="number"
                step="any"
                className="text-input"
                value={draft.correctValue}
                onChange={(e) =>
                  patch('correctValue', e.target.value === '' ? '' : Number(e.target.value))
                }
              />
            </label>
            <label className="field-label">
              <span>Tolerance ±</span>
              <input
                type="number"
                step="any"
                min={0}
                className="text-input"
                value={draft.tolerance}
                onChange={(e) =>
                  patch('tolerance', e.target.value === '' ? '' : Number(e.target.value))
                }
              />
            </label>
            <label className="field-label">
              <span>Unit (optional)</span>
              <input
                className="text-input"
                value={draft.unit}
                onChange={(e) => patch('unit', e.target.value)}
                placeholder="mm, cm…"
              />
            </label>
          </div>
        </fieldset>
      );
    case 'shortText':
      return (
        <fieldset className="admin-fieldset">
          <legend>Accepted answers / keywords</legend>
          <KeywordList
            keywords={draft.requiredKeywords}
            onChange={(next) => patch('requiredKeywords', next)}
          />
          <p className="muted small">
            A learner's answer is correct if it contains any of these keywords (case-insensitive).
          </p>
        </fieldset>
      );
    case 'deviceSelection':
      return (
        <DeviceSelectionFieldset
          allowedCategory={draft.allowedCategory}
          correctDeviceId={draft.correctDeviceId}
          onAllowedCategoryChange={(v) => patch('allowedCategory', v)}
          onCorrectDeviceIdChange={(v) => patch('correctDeviceId', v)}
        />
      );
    case 'measurement':
      return (
        <fieldset className="admin-fieldset">
          <legend>Measurement</legend>
          <div className="admin-form-grid">
            <label className="field-label">
              <span>Required plane</span>
              <select
                className="text-input"
                value={draft.plane}
                onChange={(e) =>
                  patch('plane', e.target.value as 'axial' | 'coronal' | 'sagittal')
                }
              >
                {PLANES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              <span>Unit</span>
              <input
                className="text-input"
                value={draft.unit || 'mm'}
                onChange={(e) => patch('unit', e.target.value)}
                placeholder="mm"
              />
            </label>
          </div>
          <div className="admin-form-grid">
            <label className="field-label">
              <span>Expected value</span>
              <input
                type="number"
                step="any"
                min={0}
                className="text-input"
                value={draft.correctValue}
                onChange={(e) =>
                  patch('correctValue', e.target.value === '' ? '' : Number(e.target.value))
                }
              />
            </label>
            <label className="field-label">
              <span>Tolerance ±</span>
              <input
                type="number"
                step="any"
                min={0}
                className="text-input"
                value={draft.tolerance}
                onChange={(e) =>
                  patch('tolerance', e.target.value === '' ? '' : Number(e.target.value))
                }
              />
            </label>
          </div>
          <label className="field-label">
            <span>Target description (optional)</span>
            <input
              className="text-input"
              value={draft.target}
              onChange={(e) => patch('target', e.target.value)}
              placeholder="maximal aneurysm transverse diameter"
            />
          </label>
        </fieldset>
      );
    default:
      return null;
  }
}

function KeywordList({
  keywords,
  onChange,
}: {
  keywords: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="admin-keyword-list">
      {keywords.map((k, idx) => (
        <div key={idx} className="admin-choice-row">
          <input
            className="text-input"
            value={k}
            onChange={(e) => onChange(keywords.map((kk, i) => (i === idx ? e.target.value : kk)))}
            placeholder="endoleak"
          />
          <button
            type="button"
            className="secondary-button small"
            onClick={() => onChange(keywords.filter((_, i) => i !== idx))}
            aria-label="Remove keyword"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        className="secondary-button small"
        onClick={() => onChange([...keywords, ''])}
      >
        + Keyword
      </button>
    </div>
  );
}

function nextChoiceId(used: Set<string>): string {
  for (let i = 0; i < 26; i++) {
    const ch = String.fromCharCode('a'.charCodeAt(0) + i);
    if (!used.has(ch)) return ch;
  }
  let n = 1;
  while (used.has(`opt${n}`)) n++;
  return `opt${n}`;
}

const activeStyle: CSSProperties = {
  background: 'rgba(120,166,255,0.2)',
  borderColor: 'rgba(120,166,255,0.5)',
};

interface DeviceSelectionFieldsetProps {
  allowedCategory: string;
  correctDeviceId: string;
  onAllowedCategoryChange: (next: string) => void;
  onCorrectDeviceIdChange: (next: string) => void;
}

/**
 * Authoring fieldset for `deviceSelection` questions. Loads the device catalog
 * lazily, lets the author pick an optional category filter, and shows the
 * matching devices as a selectable list. Persists the chosen device id and
 * (optional) allowed category into the question draft.
 */
function DeviceSelectionFieldset({
  allowedCategory,
  correctDeviceId,
  onAllowedCategoryChange,
  onCorrectDeviceIdChange,
}: DeviceSelectionFieldsetProps) {
  const [categories, setCategories] = useState<string[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      listDevices(allowedCategory ? { category: allowedCategory } : undefined),
      listDeviceCategories(),
    ])
      .then(([devs, cats]) => {
        if (cancelled) return;
        setDevices(devs);
        setCategories(cats);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [allowedCategory]);

  const correctExists = devices.some((d) => d.id === correctDeviceId);

  return (
    <fieldset className="admin-fieldset">
      <legend>Device selection</legend>
      <div className="admin-form-grid">
        <label className="field-label">
          <span>Allowed category (optional)</span>
          <select
            className="text-input"
            value={allowedCategory}
            onChange={(e) => onAllowedCategoryChange(e.target.value)}
          >
            <option value="">Any category</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="field-label">
          <span>Correct device</span>
          <select
            className="text-input"
            value={correctDeviceId}
            onChange={(e) => onCorrectDeviceIdChange(e.target.value)}
          >
            <option value="">{loading ? 'Loading devices…' : 'Pick a device'}</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} — {d.manufacturer}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!loading && correctDeviceId && !correctExists ? (
        <p className="admin-banner error">
          The chosen device id is not in the current catalog
          {allowedCategory ? ' for this category' : ''}. Either change the category, pick a
          different device, or recreate the missing device.
        </p>
      ) : null}
      {!loading && devices.length === 0 ? (
        <p className="muted small">
          No devices match the selected category. Add devices in the Devices admin tab first.
        </p>
      ) : null}
    </fieldset>
  );
}
