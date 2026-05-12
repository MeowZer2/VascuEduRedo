import { useEffect, useMemo, useState } from 'react';
import {
  isDeviceCatalogAvailable,
  listDeviceCategories,
  listDevices,
  type Device,
} from '../../lib/devices';
import { friendlyError } from '../../lib/productionState';

export function DevicesCatalogPage() {
  const available = isDeviceCatalogAvailable();
  const [devices, setDevices] = useState<Device[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
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
    setErrorMsg(null);
    Promise.all([listDevices(), listDeviceCategories()])
      .then(([devs, cats]) => {
        if (cancelled) return;
        setDevices(devs);
        setCategories(cats);
        if (devs[0]) setSelectedId(devs[0].id);
      })
      .catch((e) => {
        if (cancelled) return;
        setErrorMsg(`Device catalog could not be loaded. ${friendlyError(e, 'Please try again from the desktop app.')}`);
        setDevices([]);
        setCategories([]);
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
        <header className="page-header devices-hero">
          <p className="eyebrow">Device catalog</p>
          <h2>Device reference opens in the desktop app.</h2>
          <p>The catalog is available when VascEdu is running as the local desktop application.</p>
        </header>
      </div>
    );
  }

  return (
    <div className="page-stack devices-page">
      <header className="page-header devices-hero">
        <p className="eyebrow">Device catalog</p>
        <h2>Vascular device reference.</h2>
        <p>Browse device classes, manufacturers, sizing notes, and tags used in practice questions.</p>
      </header>

      <section className="devices-toolbar">
        <input
          className="text-input"
          type="search"
          placeholder="Search by name, manufacturer, or tag"
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

      {errorMsg ? <div className="admin-banner error">{errorMsg}</div> : null}

      <section className="devices-layout">
        <aside className="devices-list-panel">
          {loading ? (
            <div className="empty-state compact">
              <strong>Loading catalog</strong>
              <span>Preparing local device reference.</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty-state compact">
              <strong>{errorMsg ? 'Catalog unavailable' : 'No matching devices'}</strong>
              <span>{errorMsg ? 'Try again once the desktop data is ready.' : 'Adjust search, category, or manufacturer filters.'}</span>
            </div>
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
          {selected ? (
            <DeviceDetail device={selected} />
          ) : (
            <div className="empty-state compact">
              <strong>No device selected</strong>
              <span>Choose a device from the catalog, or adjust the filters to find matching devices.</span>
            </div>
          )}
        </article>
      </section>
    </div>
  );
}

export function DeviceDetail({ device }: { device: Device }) {
  return (
    <>
      <header className="device-detail-header">
        <div className="device-visual-card" aria-hidden="true">
          <span>{device.category.slice(0, 2).toUpperCase()}</span>
        </div>
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
