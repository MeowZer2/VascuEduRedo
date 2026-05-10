import { useEffect, useMemo, useState } from 'react';
import {
  isDeviceCatalogAvailable,
  listDeviceCategories,
  listDevices,
  type Device,
} from '../../lib/devices';

export function DevicesCatalogPage() {
  const available = isDeviceCatalogAvailable();
  const [devices, setDevices] = useState<Device[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [manufacturerFilter, setManufacturerFilter] = useState<string>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!available) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all([listDevices(), listDeviceCategories()])
      .then(([devs, cats]) => {
        if (cancelled) return;
        setDevices(devs);
        setCategories(cats);
        if (devs[0]) setSelectedId(devs[0].id);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [available]);

  const manufacturers = useMemo(() => {
    return Array.from(new Set(devices.map((d) => d.manufacturer))).sort();
  }, [devices]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return devices.filter((d) => {
      if (categoryFilter && d.category !== categoryFilter) return false;
      if (manufacturerFilter && d.manufacturer !== manufacturerFilter) return false;
      if (!needle) return true;
      return (
        d.name.toLowerCase().includes(needle) ||
        d.manufacturer.toLowerCase().includes(needle) ||
        d.description.toLowerCase().includes(needle) ||
        d.tags.some((t) => t.toLowerCase().includes(needle))
      );
    });
  }, [devices, search, categoryFilter, manufacturerFilter]);

  const selected = useMemo(
    () => filtered.find((d) => d.id === selectedId) ?? filtered[0] ?? null,
    [filtered, selectedId],
  );

  if (!available) {
    return (
      <div className="page-stack">
        <header className="page-header">
          <p className="eyebrow">Device catalog</p>
          <h2>Desktop mode required</h2>
          <p>Device data lives in local SQLite. Run the Tauri build (<code>pnpm dev</code>) to browse the catalog.</p>
        </header>
      </div>
    );
  }

  return (
    <div className="page-stack devices-page">
      <header className="page-header">
        <p className="eyebrow">Device catalog</p>
        <h2>Vascular devices</h2>
        <p>Local reference catalog used for device-selection questions and study.</p>
      </header>

      <section className="devices-toolbar">
        <input
          className="text-input"
          type="search"
          placeholder="Search by name, manufacturer, tag…"
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
        <select
          className="text-input"
          value={manufacturerFilter}
          onChange={(e) => setManufacturerFilter(e.target.value)}
        >
          <option value="">All manufacturers</option>
          {manufacturers.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <span className="muted small">
          {loading ? 'Loading…' : `${filtered.length} of ${devices.length} devices`}
        </span>
      </section>

      <section className="devices-layout">
        <aside className="devices-list-panel">
          {filtered.length === 0 ? (
            <p className="muted">No devices match the filters.</p>
          ) : (
            <ul className="devices-list">
              {filtered.map((device) => (
                <li
                  key={device.id}
                  className={
                    device.id === selected?.id ? 'devices-list-item active' : 'devices-list-item'
                  }
                >
                  <button
                    type="button"
                    className="devices-list-button"
                    onClick={() => setSelectedId(device.id)}
                  >
                    <strong>{device.name}</strong>
                    <span>{device.manufacturer}</span>
                    <span className="device-category-pill">{device.category}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <article className="devices-detail content-card">
          {selected ? <DeviceDetail device={selected} /> : <p className="muted">Pick a device to see details.</p>}
        </article>
      </section>
    </div>
  );
}

export function DeviceDetail({ device }: { device: Device }) {
  return (
    <>
      <header className="device-detail-header">
        <div>
          <p className="eyebrow">{device.category}{device.subtype ? ` · ${device.subtype}` : ''}</p>
          <h3>{device.name}</h3>
          <p className="muted">{device.manufacturer}</p>
        </div>
      </header>

      <p>{device.description}</p>

      {device.sizes.length > 0 && (
        <section>
          <h4>Sizes</h4>
          <ul className="compact-list">
            {device.sizes.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </section>
      )}

      {Object.keys(device.properties).length > 0 && (
        <section>
          <h4>Properties</h4>
          <dl className="device-properties">
            {Object.entries(device.properties).map(([key, value]) => (
              <div key={key}>
                <dt>{prettyKey(key)}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {device.tags.length > 0 && (
        <div className="tag-row spacious">
          {device.tags.map((tag) => (
            <span key={tag} className="tag">
              {tag}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

function prettyKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
}
