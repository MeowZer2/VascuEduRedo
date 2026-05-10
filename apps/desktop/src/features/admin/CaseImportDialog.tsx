import { useEffect, useMemo, useState } from 'react';
import {
  adminImportCase,
  adminValidateCasePayload,
  type CaseImportPayload,
  type ValidationReport,
} from '../../lib/admin';

interface CaseImportDialogProps {
  onClose: () => void;
  onImported: (caseId: string) => void;
}

type ParseState =
  | { kind: 'empty' }
  | { kind: 'invalid-json'; message: string }
  | { kind: 'parsed'; payload: CaseImportPayload };

function parseImportText(text: string): ParseState {
  if (!text.trim()) return { kind: 'empty' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { kind: 'invalid-json', message: e instanceof Error ? e.message : String(e) };
  }
  if (!raw || typeof raw !== 'object') {
    return { kind: 'invalid-json', message: 'Top-level JSON must be an object.' };
  }
  const obj = raw as Record<string, unknown>;
  if (!obj.case || typeof obj.case !== 'object') {
    return { kind: 'invalid-json', message: 'Missing "case" object.' };
  }
  if (!Array.isArray(obj.questions)) {
    return { kind: 'invalid-json', message: '"questions" must be an array.' };
  }
  return { kind: 'parsed', payload: obj as unknown as CaseImportPayload };
}

export function CaseImportDialog({ onClose, onImported }: CaseImportDialogProps) {
  const [text, setText] = useState('');
  const [slugStrategy, setSlugStrategy] = useState<'error' | 'rename'>('error');
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const parsed = useMemo(() => parseImportText(text), [text]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Re-validate on every successful parse so the user gets live feedback.
  useEffect(() => {
    let cancelled = false;
    if (parsed.kind !== 'parsed') {
      setReport(null);
      return;
    }
    setErrorMsg(null);
    void adminValidateCasePayload(parsed.payload)
      .then((r) => {
        if (!cancelled) setReport(r);
      })
      .catch((e) => {
        if (!cancelled) setErrorMsg(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [parsed]);

  async function handleImport() {
    if (parsed.kind !== 'parsed') return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const row = await adminImportCase(parsed.payload, { slugStrategy });
      onImported(row.id);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const canImport =
    parsed.kind === 'parsed' && (report?.ok ?? false) && !busy;

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <header className="modal-header">
          <div>
            <p className="eyebrow">Import case</p>
            <h2>Paste a case JSON</h2>
            <p className="muted">
              Paste the contents of an exported case file. The payload is validated before
              anything is written to SQLite.
            </p>
          </div>
          <button type="button" className="secondary-button" onClick={onClose}>
            Close ✕
          </button>
        </header>

        <label className="field-label">
          <span>Case JSON</span>
          <textarea
            className="text-input textarea import-textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder='{"version":"vascedu/case@1","case":{...},"questions":[...]}'
            spellCheck={false}
          />
        </label>

        <label className="field-label">
          <span>If the slug already exists</span>
          <select
            className="text-input"
            value={slugStrategy}
            onChange={(e) => setSlugStrategy(e.target.value as 'error' | 'rename')}
          >
            <option value="error">Reject the import</option>
            <option value="rename">Auto-rename (suffix -imported)</option>
          </select>
        </label>

        {parsed.kind === 'invalid-json' && (
          <div className="admin-banner error">JSON parse error: {parsed.message}</div>
        )}
        {errorMsg && <div className="admin-banner error">{errorMsg}</div>}
        {parsed.kind === 'parsed' && report && (
          <div className="content-health">
            <h4>
              Validation:{' '}
              <span className={report.ok ? 'health-pill ok' : 'health-pill error'}>
                {report.ok ? 'Ready to import' : 'Has errors'}
              </span>
            </h4>
            <HealthList items={report.errors} kind="error" />
            <HealthList items={report.warnings} kind="warning" />
          </div>
        )}

        <div className="admin-form-actions">
          <button
            type="button"
            className="primary-button"
            onClick={() => void handleImport()}
            disabled={!canImport}
          >
            {busy ? 'Importing…' : 'Import to SQLite'}
          </button>
          <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function HealthList({
  items,
  kind,
}: {
  items: { field: string; message: string }[];
  kind: 'error' | 'warning';
}) {
  if (items.length === 0) return null;
  return (
    <ul className={`health-list health-list-${kind}`}>
      {items.map((item, idx) => (
        <li key={idx}>
          <strong>{item.field}</strong>: {item.message}
        </li>
      ))}
    </ul>
  );
}
