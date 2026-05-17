import { useEffect, useState } from 'react';
import brandPrimary from '../../assets/brand/vascedu-primary.png';
import { IcAlert, IcCheck, IcCog, IcDownload, IcInfo, IcMoon, IcSun, IcUpload } from '../../components/prototype/icons';
import { SectionHead } from '../../components/prototype/primitives';
import { exportAppBackup } from '../../lib/admin';
import { getStoredThemeMode, saveThemeMode, type ThemeMode } from '../../lib/appearance';
import { friendlyError } from '../../lib/productionState';
import { safeInvoke } from '../../lib/tauri';

interface AppInfo {
  name: string;
  version: string;
  backend: string;
  build: string;
  dataLocation: string | null;
}

const THEME_OPTIONS: Array<{ id: ThemeMode; label: string; icon: (p: { size?: number }) => JSX.Element }> = [
  { id: 'dark', label: 'Dark', icon: IcMoon },
  { id: 'light', label: 'Light', icon: IcSun },
  { id: 'system', label: 'System', icon: IcCog },
];

const RELEASE_CHECKS: Array<{ ok: boolean; title: string; detail: string }> = [
  { ok: true, title: 'Desktop packaging', detail: 'Windows/macOS bundle metadata configured' },
  { ok: true, title: 'Privacy', detail: 'All learner data stored locally' },
  { ok: true, title: 'Content schema', detail: 'Zod-validated case packs' },
  { ok: false, title: 'DICOM ingest', detail: 'Pending — sample NRRD only' },
];

export function SettingsPage() {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [backupStatus, setBackupStatus] = useState<string | null>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => getStoredThemeMode());
  const [density, setDensity] = useState<'compact' | 'comfortable' | 'spacious'>('comfortable');
  const [orientation, setOrientation] = useState<'radiologic' | 'neurologic'>('radiologic');
  const [autoplay, setAutoplay] = useState(true);
  const [hints, setHints] = useState(false);
  const [analytics, setAnalytics] = useState(false);

  useEffect(() => {
    safeInvoke<AppInfo>('app_info').then(setAppInfo);
  }, []);

  function updateThemeMode(mode: ThemeMode) {
    setThemeMode(mode);
    saveThemeMode(mode);
  }

  async function exportBackup() {
    setBackupStatus(null);
    try {
      const payload = await exportAppBackup();
      if (!payload) {
        setBackupStatus('Backup is available in the desktop app.');
        return;
      }
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const date = new Date().toISOString().slice(0, 10);
      anchor.href = url;
      anchor.download = `vascedu-backup-${date}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setBackupStatus('Backup exported.');
    } catch (error) {
      setBackupStatus(
        `Backup could not be exported. ${friendlyError(error, 'Please try again from the desktop app.')}`,
      );
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-eyebrow">System · workstation</div>
          <h1 className="page-title">
            <span className="display-italic">Settings</span>
          </h1>
          <p className="page-subtitle">
            Configure the desktop app, data safety, and learner preferences.
          </p>
        </div>
      </div>

      <section className="grid grid-12">
        {/* Left column */}
        <div className="col-8" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <article className="card">
            <SectionHead title="Appearance" subtitle="Theme and information density" />
            <div className="setting-row">
              <div>
                <strong>Theme</strong>
                <p>Switch between dark, light, or follow the desktop preference.</p>
              </div>
              <div className="segmented" role="group" aria-label="Theme mode">
                {THEME_OPTIONS.map((option) => {
                  const Icon = option.icon;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      className={themeMode === option.id ? 'active' : ''}
                      onClick={() => updateThemeMode(option.id)}
                    >
                      <Icon size={12} /> <span style={{ marginLeft: 4 }}>{option.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="setting-row">
              <div>
                <strong>Density</strong>
                <p>Adjust spacing and card sizes across the workspace.</p>
              </div>
              <div className="segmented" role="group" aria-label="Workspace density">
                {(['compact', 'comfortable', 'spacious'] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={density === item ? 'active' : ''}
                    onClick={() => setDensity(item)}
                  >
                    {item[0].toUpperCase() + item.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div className="setting-row">
              <div>
                <strong>Imaging orientation</strong>
                <p>Default convention used when displaying axial slices in the viewer.</p>
              </div>
              <div className="segmented" role="group" aria-label="Imaging orientation">
                <button
                  type="button"
                  className={orientation === 'radiologic' ? 'active' : ''}
                  onClick={() => setOrientation('radiologic')}
                >
                  Radiologic
                </button>
                <button
                  type="button"
                  className={orientation === 'neurologic' ? 'active' : ''}
                  onClick={() => setOrientation('neurologic')}
                >
                  Neurologic
                </button>
              </div>
            </div>
          </article>

          <article className="card">
            <SectionHead title="Practice behavior" subtitle="How sessions and feedback are presented" />
            <ToggleRow
              title="Auto-advance after correct answer"
              description="Move to the next question 2 seconds after a correct response."
              enabled={autoplay}
              onToggle={() => setAutoplay((value) => !value)}
            />
            <ToggleRow
              title="Reveal hints automatically"
              description="Show the first hint if no answer is submitted within 60 seconds."
              enabled={hints}
              onToggle={() => setHints((value) => !value)}
            />
            <ToggleRow
              title="Share anonymized usage analytics"
              description="Help improve VascEdu — no PHI or imaging data is ever shared."
              enabled={analytics}
              onToggle={() => setAnalytics((value) => !value)}
            />
          </article>

          <article className="card">
            <SectionHead
              title="Data & backup"
              subtitle="Local content packs, learner record, and procedural plans"
            />
            <div className="setting-row">
              <div>
                <strong>Export app backup</strong>
                <p>
                  JSON snapshot of cases, questions, plans, devices, and attempts. Imaging files are
                  referenced by path.
                </p>
              </div>
              <button type="button" className="btn secondary" onClick={() => void exportBackup()}>
                <IcDownload size={14} /> Export backup
              </button>
            </div>
            {backupStatus ? (
              <p className="muted settings-status" style={{ marginTop: -4 }}>
                {backupStatus}
              </p>
            ) : null}
            <div className="setting-row">
              <div>
                <strong>Import content pack</strong>
                <p>Add or update cases from a signed VascEdu content pack folder.</p>
              </div>
              <button type="button" className="btn secondary" disabled title="Available in the desktop app">
                <IcUpload size={14} /> Import
              </button>
            </div>
            <div className="setting-row">
              <div>
                <strong>Reset local progress</strong>
                <p>
                  Clear all attempts, scores, and bookmarks on this workstation. Does not affect
                  content.
                </p>
              </div>
              <button
                type="button"
                className="btn secondary"
                style={{ color: 'var(--danger)', borderColor: 'rgba(236,107,120,0.3)' }}
                disabled
                title="Available in the desktop app"
              >
                Reset
              </button>
            </div>
          </article>
        </div>

        {/* Right column */}
        <aside className="col-4" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <article className="card">
            <div style={{ padding: '4px 0 14px', display: 'flex', justifyContent: 'center' }}>
              <img
                src={brandPrimary}
                alt="VascEdu — vascular imaging training"
                style={{
                  maxWidth: '260px',
                  width: '100%',
                  height: 'auto',
                  display: 'block',
                  filter: 'drop-shadow(0 8px 24px rgba(93,212,230,0.12))',
                }}
              />
            </div>
            <hr className="divider" style={{ margin: '4px 0 16px' }} />
            <SectionHead title="About" />
            <dl className="def" style={{ gridTemplateColumns: '110px 1fr' }}>
              <dt>App</dt>
              <dd>{appInfo?.name ?? 'VascEdu'}</dd>
              <dt>Version</dt>
              <dd className="mono">{appInfo?.version ?? '0.29.0'}</dd>
              <dt>Build</dt>
              <dd className="mono">{appInfo?.build ?? 'Browser preview'}</dd>
              <dt>Backend</dt>
              <dd>{appInfo?.backend ?? 'SQLite · local'}</dd>
              <dt>Data path</dt>
              <dd
                className="mono"
                style={{ fontSize: 11.5, wordBreak: 'break-all', color: 'var(--text-2)' }}
              >
                {appInfo?.dataLocation ?? 'Desktop mode'}
              </dd>
            </dl>
            <hr className="divider" style={{ margin: '16px 0' }} />
            <p className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>
              Local-first vascular imaging and endovascular training workspace for CT review,
              procedural planning, and guided practice.
            </p>
          </article>

          <article className="card">
            <SectionHead title="Release readiness" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {RELEASE_CHECKS.map((check) => (
                <div
                  key={check.title}
                  style={{ display: 'grid', gridTemplateColumns: '20px 1fr', gap: 10, alignItems: 'start' }}
                >
                  <div
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 5,
                      display: 'grid',
                      placeItems: 'center',
                      background: check.ok ? 'var(--success-soft)' : 'var(--warning-soft)',
                      color: check.ok ? 'var(--success)' : 'var(--warning)',
                      border: `1px solid ${check.ok ? 'rgba(94,196,141,0.3)' : 'rgba(230,178,86,0.3)'}`,
                    }}
                  >
                    {check.ok ? <IcCheck size={11} /> : <IcAlert size={11} />}
                  </div>
                  <div>
                    <strong style={{ fontSize: 12.5, display: 'block', fontWeight: 600 }}>
                      {check.title}
                    </strong>
                    <span className="muted" style={{ fontSize: 11.5 }}>
                      {check.detail}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </article>

          <article className="card flat">
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <IcInfo size={16} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2 }} />
              <div>
                <strong style={{ fontSize: 13, display: 'block' }}>Educational use only</strong>
                <p className="muted" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.5 }}>
                  VascEdu is a training environment. Decisions about real patients require
                  institutional protocols and current device IFUs.
                </p>
              </div>
            </div>
          </article>
        </aside>
      </section>
    </div>
  );
}

function ToggleRow({
  title,
  description,
  enabled,
  onToggle,
}: {
  title: string;
  description: string;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="setting-row">
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      <button
        type="button"
        className={enabled ? 'switch on' : 'switch'}
        aria-label={title}
        aria-pressed={enabled}
        onClick={onToggle}
      />
    </div>
  );
}
