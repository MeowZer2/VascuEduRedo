import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  adminCreateDevice,
  adminDeleteDevice,
  adminUpdateDevice,
  isDeviceCatalogAvailable,
  listDeviceCategories,
  listDevices,
  type Device,
  type DeviceInput,
} from '../../lib/devices';
import { confirmDiscard, friendlyError, useUnsavedChangesGuard } from '../../lib/productionState';

interface DeviceDraft {
  id: string | null;
  name: string;
  manufacturer: string;
  category: string;
  subtype: string;
  description: string;
  sizes: string[];
  /** Properties edited as parallel arrays — flatter than nested object editing. */
  propertyKeys: string[];
  propertyValues: string[];
  tags: string[];
}

const EMPTY_DRAFT: DeviceDraft = {
  id: null,
  name: '',
  manufacturer: '',
  category: '',
  subtype: '',
  description: '',
  sizes: [],
  propertyKeys: [],
  propertyValues: [],
  tags: [],
};

function deviceToDraft(d: Device): DeviceDraft {
  const keys = Object.keys(d.properties);
  return {
    id: d.id,
    name: d.name,
    manufacturer: d.manufacturer,
    category: d.category,
    subtype: d.subtype ?? '',
    description: d.description,
    sizes: [...d.sizes],
    propertyKeys: keys,
    propertyValues: keys.map((k) => d.properties[k]),
    tags: [...d.tags],
  };
}

function draftToInput(draft: DeviceDraft): { ok: true; input: DeviceInput } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!draft.name.trim()) errors.push('Name is required.');
  if (!draft.manufacturer.trim()) errors.push('Manufacturer is required.');
  if (!draft.category.trim()) errors.push('Category is required.');
  if (!draft.description.trim()) errors.push('Description is required.');

  const properties: Record<string, string> = {};
  const seenPropertyKeys = new Set<string>();
  for (let i = 0; i < draft.propertyKeys.length; i += 1) {
    const key = draft.propertyKeys[i].trim();
    const value = (draft.propertyValues[i] ?? '').trim();
    if (!key) continue;
    const normalizedKey = key.toLowerCase();
    if (seenPropertyKeys.has(normalizedKey)) {
      errors.push(`Property "${key}" is listed more than once.`);
      continue;
    }
    seenPropertyKeys.add(normalizedKey);
    if (!value) errors.push(`Property "${key}" needs a value.`);
    properties[key] = value;
  }
  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    input: {
      name: draft.name.trim(),
      manufacturer: draft.manufacturer.trim(),
      category: draft.category.trim(),
      subtype: draft.subtype.trim() ? draft.subtype.trim() : null,
      description: draft.description.trim(),
      sizes: draft.sizes.map((s) => s.trim()).filter(Boolean),
      properties,
      tags: draft.tags.map((t) => t.trim()).filter(Boolean),
    },
  };
}

export function AdminDevicesTab() {
  const available = isDeviceCatalogAvailable();
  const [devices, setDevices] = useState<Device[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<DeviceDraft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const draftDirty = useMemo(() => {
    if (creating) return JSON.stringify(draft) !== JSON.stringify(EMPTY_DRAFT);
    if (!draft.id) return false;
    const original = devices.find((device) => device.id === draft.id);
    return original ? JSON.stringify(draft) !== JSON.stringify(deviceToDraft(original)) : false;
  }, [creating, devices, draft]);

  useUnsavedChangesGuard(
    'admin-devices',
    draftDirty,
    'You have unsaved device edits. Discard them and continue?',
  );

  const flashStatus = useCallback((msg: string) => {
    setStatusMsg(msg);
    setErrorMsg(null);
    window.setTimeout(() => setStatusMsg((current) => (current === msg ? null : current)), 2500);
  }, []);
  const flashError = useCallback((msg: string) => {
    setErrorMsg(msg);
    setStatusMsg(null);
  }, []);

  const refresh = useCallback(async () => {
    if (!available) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [devs, cats] = await Promise.all([listDevices(), listDeviceCategories()]);
      setDevices(devs);
      setCategories(cats);
    } catch (e) {
      flashError(`Device catalog could not be loaded. ${friendlyError(e, 'Please reopen Admin and try again.')}`);
    } finally {
      setLoading(false);
    }
  }, [available, flashError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Load draft when selection changes (and we're not creating).
  useEffect(() => {
    if (creating || !selectedId) return;
    const dev = devices.find((d) => d.id === selectedId);
    if (dev) setDraft(deviceToDraft(dev));
  }, [creating, selectedId, devices]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return devices.filter((d) => {
      if (categoryFilter && d.category !== categoryFilter) return false;
      if (!needle) return true;
      return (
        d.name.toLowerCase().includes(needle) ||
        d.manufacturer.toLowerCase().includes(needle) ||
        d.description.toLowerCase().includes(needle)
      );
    });
  }, [devices, search, categoryFilter]);

  function startNew() {
    if (draftDirty && !confirmDiscard('Discard the current device edits and create a new device?')) return;
    setCreating(true);
    setSelectedId(null);
    setDraft(EMPTY_DRAFT);
  }

  function selectDevice(id: string) {
    if (!creating && id === selectedId) return;
    if (draftDirty && !confirmDiscard('Discard the current device edits and open another device?')) return;
    setCreating(false);
    setSelectedId(id);
  }

  async function saveDraft() {
    const conv = draftToInput(draft);
    if (!conv.ok) {
      flashError(conv.errors.join(' '));
      return;
    }
    setBusy(true);
    try {
      let saved: Device;
      if (creating || !draft.id) {
        saved = await adminCreateDevice(conv.input);
        flashStatus(`Created "${saved.name}".`);
      } else {
        saved = await adminUpdateDevice(draft.id, conv.input);
        flashStatus(`Saved "${saved.name}".`);
      }
      setCreating(false);
      setSelectedId(saved.id);
      await refresh();
    } catch (e) {
      flashError(`Device could not be saved. ${friendlyError(e, 'Review the device fields and try again.')}`);
    } finally {
      setBusy(false);
    }
  }

  async function deleteSelected() {
    if (!draft.id) return;
    if (!window.confirm(`Delete "${draft.name}" from the local device catalog?\n\nDevice-selection questions that reference it may need review. This cannot be undone.`)) return;
    setBusy(true);
    try {
      await adminDeleteDevice(draft.id);
      flashStatus('Device deleted.');
      setSelectedId(null);
      setDraft(EMPTY_DRAFT);
      await refresh();
    } catch (e) {
      flashError(`Device could not be deleted. ${friendlyError(e, 'Please try again.')}`);
    } finally {
      setBusy(false);
    }
  }

  function patch<K extends keyof DeviceDraft>(key: K, value: DeviceDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function addProperty() {
    setDraft((d) => ({
      ...d,
      propertyKeys: [...d.propertyKeys, ''],
      propertyValues: [...d.propertyValues, ''],
    }));
  }
  function removeProperty(idx: number) {
    setDraft((d) => ({
      ...d,
      propertyKeys: d.propertyKeys.filter((_, i) => i !== idx),
      propertyValues: d.propertyValues.filter((_, i) => i !== idx),
    }));
  }
  function setProperty(idx: number, patchValues: { key?: string; value?: string }) {
    setDraft((d) => ({
      ...d,
      propertyKeys: d.propertyKeys.map((k, i) =>
        i === idx && patchValues.key !== undefined ? patchValues.key : k,
      ),
      propertyValues: d.propertyValues.map((v, i) =>
        i === idx && patchValues.value !== undefined ? patchValues.value : v,
      ),
    }));
  }

  if (!available) {
    return (
      <div className="page-stack">
        <p className="muted">Device authoring requires desktop mode.</p>
      </div>
    );
  }

  return (
    <div className="admin-devices">
      {(statusMsg || errorMsg) && (
        <div className={errorMsg ? 'admin-banner error' : 'admin-banner success'} role="status">
          {errorMsg ?? statusMsg}
        </div>
      )}

      <div className="admin-layout">
        <aside className="admin-cases-panel">
          <div className="admin-panel-header">
            <h3>Devices</h3>
            <button
              type="button"
              className="secondary-button small"
              onClick={startNew}
              disabled={busy}
            >
              + New
            </button>
          </div>

          <div className="admin-form" style={{ gap: 8 }}>
            <input
              className="text-input"
              type="search"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className="text-input"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <ul className="admin-case-list">
            {creating && (
              <li className="admin-case-item active">
                <strong>New device</strong>
                <span>Unsaved</span>
              </li>
            )}
            {filtered.map((device) => (
              <li
                key={device.id}
                className={
                  !creating && device.id === selectedId
                    ? 'admin-case-item active'
                    : 'admin-case-item'
                }
              >
                <button
                  type="button"
                  className="admin-case-button"
                  onClick={() => selectDevice(device.id)}
                  disabled={busy}
                >
                  <strong>{device.name}</strong>
                  <span>
                    {device.category} · {device.manufacturer}
                  </span>
                </button>
              </li>
            ))}
            {filtered.length === 0 && !creating && (
              <li className="admin-case-item muted">
                {loading ? 'Loading devices...' : 'No devices match.'}
              </li>
            )}
          </ul>
        </aside>

        <section className="content-card admin-case-editor">
          <header className="admin-panel-header">
            <h3>{creating ? 'New device' : draft.id ? 'Edit device' : 'Pick a device'}</h3>
          </header>

          {(creating || draft.id) ? (
            <form
              className="admin-form"
              onSubmit={(e) => {
                e.preventDefault();
                void saveDraft();
              }}
            >
              <div className="admin-form-grid">
                <label className="field-label">
                  <span>Name</span>
                  <input
                    className="text-input"
                    value={draft.name}
                    onChange={(e) => patch('name', e.target.value)}
                  />
                </label>
                <label className="field-label">
                  <span>Manufacturer</span>
                  <input
                    className="text-input"
                    value={draft.manufacturer}
                    onChange={(e) => patch('manufacturer', e.target.value)}
                  />
                </label>
              </div>
              <div className="admin-form-grid">
                <label className="field-label">
                  <span>Category</span>
                  <input
                    className="text-input"
                    value={draft.category}
                    onChange={(e) => patch('category', e.target.value)}
                    list="device-category-options"
                    placeholder="covered stent"
                  />
                  <datalist id="device-category-options">
                    {categories.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </label>
                <label className="field-label">
                  <span>Subtype (optional)</span>
                  <input
                    className="text-input"
                    value={draft.subtype}
                    onChange={(e) => patch('subtype', e.target.value)}
                    placeholder="self-expanding peripheral"
                  />
                </label>
              </div>

              <label className="field-label">
                <span>Description</span>
                <textarea
                  className="text-input textarea"
                  value={draft.description}
                  onChange={(e) => patch('description', e.target.value)}
                />
              </label>

              <fieldset className="admin-fieldset">
                <legend>Sizes</legend>
                <SimpleList
                  values={draft.sizes}
                  onChange={(next) => patch('sizes', next)}
                  placeholder="6 mm × 50 mm"
                  addLabel="+ Size"
                />
              </fieldset>

              <fieldset className="admin-fieldset">
                <legend>Properties</legend>
                {draft.propertyKeys.map((key, idx) => (
                  <div key={idx} className="admin-choice-row">
                    <input
                      className="text-input admin-choice-id"
                      value={key}
                      onChange={(e) => setProperty(idx, { key: e.target.value })}
                      placeholder="key"
                    />
                    <input
                      className="text-input"
                      value={draft.propertyValues[idx] ?? ''}
                      onChange={(e) => setProperty(idx, { value: e.target.value })}
                      placeholder="value"
                    />
                    <button
                      type="button"
                      className="secondary-button small"
                      onClick={() => removeProperty(idx)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button type="button" className="secondary-button small" onClick={addProperty}>
                  + Property
                </button>
              </fieldset>

              <fieldset className="admin-fieldset">
                <legend>Tags</legend>
                <SimpleList
                  values={draft.tags}
                  onChange={(next) => patch('tags', next)}
                  placeholder="EVAR"
                  addLabel="+ Tag"
                />
              </fieldset>

              <div className="admin-form-actions">
                <button type="submit" className="primary-button" disabled={busy}>
                  {creating ? 'Create device' : 'Save device'}
                </button>
                {!creating && draft.id && (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void deleteSelected()}
                    disabled={busy}
                  >
                    Delete device
                  </button>
                )}
                {creating && (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      if (draftDirty && !confirmDiscard('Discard the new device draft?')) return;
                      setCreating(false);
                      setDraft(EMPTY_DRAFT);
                    }}
                    disabled={busy}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>
          ) : (
            <p className="muted">Pick a device on the left, or hit <em>+ New</em>.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function SimpleList({
  values,
  onChange,
  placeholder,
  addLabel,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  addLabel: string;
}) {
  return (
    <div className="admin-keyword-list">
      {values.map((value, idx) => (
        <div key={idx} className="admin-choice-row">
          <input
            className="text-input"
            value={value}
            onChange={(e) => onChange(values.map((v, i) => (i === idx ? e.target.value : v)))}
            placeholder={placeholder}
          />
          <button
            type="button"
            className="secondary-button small"
            onClick={() => onChange(values.filter((_, i) => i !== idx))}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        className="secondary-button small"
        onClick={() => onChange([...values, ''])}
      >
        {addLabel}
      </button>
    </div>
  );
}
