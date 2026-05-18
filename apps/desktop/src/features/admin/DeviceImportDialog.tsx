import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { SAMPLE_DEVICE_IMPORT_TEXT } from '../../data/sampleDeviceImport';
import {
  parseCatalogText,
  runCatalogImport,
  validateCatalog,
  type CollisionStrategy,
  type ImportSummary,
} from '../../lib/deviceCatalog';
import type { Device } from '../../lib/devices';
import { confirmDiscard, friendlyError } from '../../lib/productionState';

interface DeviceImportDialogProps {
  existingDevices: Device[];
  onClose: () => void;
  onImported: (summary: ImportSummary) => void;
}

export function DeviceImportDialog({ existingDevices, onClose, onImported }: DeviceImportDialogProps) {
  const [text, setText] = useState('');
  const [collision, setCollision] = useState<CollisionStrategy>('skip');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const hasDraft = text.trim().length > 0;
  const parsed = useMemo(() => parseCatalogText(text), [text]);
  const report = useMemo(() => {
    if (parsed.kind !== 'parsed') return null;
    return validateCatalog(parsed.payload, existingDevices, collision);
  }, [parsed, existingDevices, collision]);

  function requestClose() {
    if (busy) return;
    if (hasDraft && !confirmDiscard('Discard the pasted device import payload?')) return;
    onClose();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') requestClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasDraft, busy]);

  function onPickFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setText(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => setErrorMsg('That file could not be read.');
    reader.readAsText(file);
  }

  async function handleImport() {
    if (parsed.kind !== 'parsed' || !report || !report.ok) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const summary = await runCatalogImport(parsed.payload, existingDevices, collision);
      onImported(summary);
    } catch (e) {
      setErrorMsg(friendlyError(e, 'The device catalog could not be imported.'));
    } finally {
      setBusy(false);
    }
  }

  const canImport = parsed.kind === 'parsed' && !!report && report.ok && !busy;

  return (
    <div className="modal-backdrop" onClick={requestClose} role="presentation">
      <div className="modal-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <header className="modal-header">
          <div>
            <p className="eyebrow">Import devices</p>
            <h2>Verified device catalog import</h2>
            <p className="muted">
              Paste or load a <code>vascedu/devices@1</code> JSON payload. Data is validated before
              anything is written. Specifications should come from manufacturer / IFU sources —
              VascEdu is an educational reference, not a source of clinical truth.
            </p>
          </div>
          <button type="button" className="secondary-button" onClick={requestClose} disabled={busy}>
            Close
          </button>
        </header>

        <div className="admin-form-actions" style={{ marginBottom: 8 }}>
          <button
            type="button"
            className="secondary-button small"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >
            Choose JSON file…
          </button>
          <button
            type="button"
            className="secondary-button small"
            onClick={() => setText(SAMPLE_DEVICE_IMPORT_TEXT)}
            disabled={busy}
          >
            Load sample (illustrative)
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={onPickFile}
          />
        </div>

        <label className="field-label">
          <span>Device catalog JSON</span>
          <textarea
            className="text-input textarea import-textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder='{"version":"vascedu/devices@1","sourceName":"...","devices":[...]}'
            spellCheck={false}
          />
        </label>

        <label className="field-label">
          <span>If a device already exists (same manufacturer + name + family)</span>
          <select
            className="text-input"
            value={collision}
            onChange={(e) => setCollision(e.target.value as CollisionStrategy)}
          >
            <option value="skip">Skip existing (safe default)</option>
            <option value="update">Update existing</option>
            <option value="new-copy">Import as new copy</option>
          </select>
        </label>

        {parsed.kind === 'invalid' && (
          <div className="admin-banner error">The pasted JSON could not be read: {parsed.message}</div>
        )}
        {errorMsg && <div className="admin-banner error">{errorMsg}</div>}

        {report && (
          <div className="content-health">
            <h4>
              Validation:{' '}
              <span className={report.ok ? 'health-pill ok' : 'health-pill error'}>
                {report.ok ? 'Ready to import' : 'Has blocking errors'}
              </span>
            </h4>
            <p className="muted small">
              {report.total} device{report.total === 1 ? '' : 's'} in payload · create{' '}
              {report.toCreate} · update {report.toUpdate} · skip {report.toSkip}
              {report.duplicatesInFile > 0
                ? ` · ${report.duplicatesInFile} duplicate(s) within file`
                : ''}
            </p>
            <IssueList title="Errors" items={report.errors} kind="error" />
            <IssueList title="Warnings" items={report.warnings} kind="warning" />
          </div>
        )}

        <div className="admin-form-actions">
          <button
            type="button"
            className="primary-button"
            onClick={() => void handleImport()}
            disabled={!canImport}
            title={!canImport ? 'Resolve blocking errors before importing' : undefined}
          >
            {busy ? 'Importing…' : 'Import devices'}
          </button>
          <button type="button" className="secondary-button" onClick={requestClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function IssueList({
  title,
  items,
  kind,
}: {
  title: string;
  items: { deviceName?: string; field?: string; message: string }[];
  kind: 'error' | 'warning';
}) {
  if (items.length === 0) return null;
  const shown = items.slice(0, 40);
  return (
    <>
      <h4 className="detail-kicker">
        {title} ({items.length})
      </h4>
      <ul className={`health-list health-list-${kind}`}>
        {shown.map((item, idx) => (
          <li key={idx}>
            <strong>{item.deviceName ?? 'payload'}</strong>
            {item.field ? ` · ${item.field}` : ''}: {item.message}
          </li>
        ))}
        {items.length > shown.length && <li>…and {items.length - shown.length} more.</li>}
      </ul>
    </>
  );
}
