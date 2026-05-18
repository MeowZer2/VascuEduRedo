import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  isDeviceCatalogAvailable,
  isSizingIncomplete,
  isVerified,
  listDeviceCategories,
  listDevices,
  NUMERIC_SPEC_FIELDS,
  TEXT_SPEC_FIELDS,
  type Device,
} from '../../lib/devices';
import { friendlyError } from '../../lib/productionState';

const SPEC_FIELD_LABELS: Record<string, string> = {
  deviceFamily: 'Device family',
  vascularTerritory: 'Vascular territory',
  indicationsSummary: 'Indications',
  deliverySystem: 'Delivery system',
  mriCompatibility: 'MRI compatibility',
  radiopaqueMarkers: 'Radiopaque markers',
  sourceReference: 'Source reference',
  sourceUrl: 'Source URL',
  lastVerifiedAt: 'Last verified',
  notes: 'Notes',
  availableDiametersMm: 'Diameters (mm)',
  availableLengthsMm: 'Lengths (mm)',
  compatibleSheathFr: 'Compatible sheath (Fr)',
  workingLengthCm: 'Working length (cm)',
  wireCompatibilityInch: 'Wire compatibility (in)',
};

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
      <div className="page">
        <header className="page-head">
          <div>
            <div className="page-eyebrow">Reference - endovascular devices</div>
            <h1 className="page-title">Device catalog</h1>
            <p className="page-subtitle">
              The device reference is available when VascEdu is running as the local desktop
              application.
            </p>
          </div>
        </header>
      </div>
    );
  }

  return (
    <div className="page devices-redesign">
      <header className="page-head">
        <div>
          <div className="page-eyebrow">Reference - endovascular devices</div>
          <h1 className="page-title">Device catalog</h1>
          <p className="page-subtitle">
            Browse device classes, manufacturers, sizing notes, and tags used in practice
            questions.
          </p>
        </div>
        <span className="pill pill-mono">{loading ? 'Loading' : `${filtered.length} of ${devices.length}`}</span>
      </header>

      <section className="toolbar devices-redesign-toolbar">
        <label className="search-input devices-search">
          <span aria-hidden="true">S</span>
          <input
            type="search"
            placeholder="Search by name, manufacturer, or tag..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <kbd>Catalog</kbd>
        </label>
        <div className="segmented devices-category-tabs" role="group" aria-label="Device category">
          <button
            type="button"
            className={categoryFilter === '' ? 'active' : ''}
            onClick={() => setCategoryFilter('')}
          >
            All ({devices.length})
          </button>
          {categories.map((category) => {
            const count = devices.filter((device) => device.category === category).length;
            return (
              <button
                key={category}
                type="button"
                className={categoryFilter === category ? 'active' : ''}
                onClick={() => setCategoryFilter(category)}
              >
                {category} ({count})
              </button>
            );
          })}
        </div>
        <select
          className="input devices-manufacturer-filter"
          value={manufacturerFilter}
          onChange={(e) => setManufacturerFilter(e.target.value)}
        >
          <option value="">All manufacturers</option>
          {manufacturers.map((manufacturer) => (
            <option key={manufacturer} value={manufacturer}>
              {manufacturer}
            </option>
          ))}
        </select>
      </section>

      {errorMsg ? <div className="admin-banner error">{errorMsg}</div> : null}

      <section className="devices-layout">
        <article className="card pad-sm">
          {loading ? (
            <div className="empty-state compact">
              <strong>Loading catalog</strong>
              <span>Preparing local device reference.</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty-state compact">
              <strong>{errorMsg ? 'Catalog unavailable' : 'No matching devices'}</strong>
              <span>
                {errorMsg
                  ? 'Try again once the desktop data is ready.'
                  : 'Adjust search, category, or manufacturer filters.'}
              </span>
            </div>
          ) : (
            <div className="devices-list">
              {filtered.map((device) => (
                <button
                  type="button"
                  key={device.id}
                  className={device.id === selected?.id ? 'device-row active' : 'device-row'}
                  onClick={() => setSelectedId(device.id)}
                >
                  <span className="device-icon" aria-hidden="true">
                    {device.category.slice(0, 2).toUpperCase()}
                  </span>
                  <span>
                    <strong>{device.name}</strong>
                    <span className="mfr">
                      {device.manufacturer} - {device.subtype || device.category}
                    </span>
                  </span>
                  <span className="device-meta">
                    {isVerified(device) ? (
                      <span className="pill pill-mono success" title="Has a source reference and verification date">
                        verified
                      </span>
                    ) : (
                      <span className="pill pill-mono" title="No source reference / verification date">
                        unverified
                      </span>
                    )}
                    {isSizingIncomplete(device) && (
                      <span className="pill pill-mono warning" title="No sizes or numeric specifications">
                        incomplete
                      </span>
                    )}
                    <span className="pill pill-mono">{device.sizes.length} sz</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </article>

        <article className="card pad-lg devices-detail-redesign">
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
      <header className="device-detail-redesign-header">
        <div className="device-visual-card device-visual-card-xl" aria-hidden="true">
          <span>{device.category.slice(0, 2).toUpperCase()}</span>
        </div>
        <div>
          <div className="page-eyebrow">{device.category}{device.subtype ? ` - ${device.subtype}` : ''}</div>
          <h2>{device.name}</h2>
          <p className="muted">{device.manufacturer}</p>
          <p className="device-detail-description">{device.description}</p>
        </div>
      </header>

      <hr className="divider" />

      <section className="grid grid-12 device-detail-grid">
        <div className="col-7">
          {device.spec && (
            <>
              <h4 className="detail-kicker">Specifications</h4>
              <dl className="def device-def">
                {TEXT_SPEC_FIELDS.map((field) => {
                  const value = device.spec?.[field];
                  if (typeof value !== 'string' || !value) return null;
                  return (
                    <Fragment key={field}>
                      <dt>{SPEC_FIELD_LABELS[field] ?? field}</dt>
                      <dd>
                        {field === 'sourceUrl' ? (
                          <a href={value} target="_blank" rel="noreferrer">
                            {value}
                          </a>
                        ) : (
                          value
                        )}
                      </dd>
                    </Fragment>
                  );
                })}
                {NUMERIC_SPEC_FIELDS.map((field) => {
                  const value = device.spec?.[field];
                  if (!Array.isArray(value) || value.length === 0) return null;
                  return (
                    <Fragment key={field}>
                      <dt>{SPEC_FIELD_LABELS[field] ?? field}</dt>
                      <dd>{(value as number[]).join(' · ')}</dd>
                    </Fragment>
                  );
                })}
              </dl>
            </>
          )}

          {device.sizes.length > 0 && (
            <>
              <h4 className="detail-kicker">Available sizes</h4>
              <div className="pills-row">
                {device.sizes.map((size) => (
                  <span key={size} className="pill pill-mono">
                    {size}
                  </span>
                ))}
              </div>
            </>
          )}

          {Object.keys(device.properties).length > 0 && (
            <>
              <h4 className="detail-kicker">Properties</h4>
              <dl className="def device-def">
                {Object.entries(device.properties).map(([key, value]) => (
                  <Fragment key={key}>
                    <dt>{prettyKey(key)}</dt>
                    <dd>{value}</dd>
                  </Fragment>
                ))}
              </dl>
            </>
          )}

          {device.tags.length > 0 && (
            <>
              <h4 className="detail-kicker">Tags</h4>
              <div className="pills-row">
                {device.tags.map((tag) => (
                  <span key={tag} className="pill">
                    {tag}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>

        <aside className="col-5 device-side-panel">
          <div className="card flat pad-sm">
            <div className="page-eyebrow">Used in practice</div>
            <strong>Device selection track</strong>
            <p className="muted">
              This reference card is available from device-selection questions and planning review.
            </p>
          </div>
          <div className="card flat pad-sm">
            <div className="page-eyebrow">Verification</div>
            <p className="muted">
              {isVerified(device)
                ? `Source/verification recorded${device.spec?.lastVerifiedAt ? ` (last verified ${device.spec.lastVerifiedAt})` : ''}.`
                : 'No source reference or verification date — treat specifications as unconfirmed.'}
            </p>
            <p className="muted">
              Always confirm device IFU before clinical use. This catalog is an educational
              reference, not a source of clinical truth.
            </p>
          </div>
        </aside>
      </section>
    </>
  );
}

function prettyKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
}
