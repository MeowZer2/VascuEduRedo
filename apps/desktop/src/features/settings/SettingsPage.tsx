import { useEffect, useState } from 'react';
import { exportAppBackup } from '../../lib/admin';
import { friendlyError } from '../../lib/productionState';
import { safeInvoke } from '../../lib/tauri';

interface AppInfo {
  name: string;
  version: string;
  backend: string;
  build: string;
  dataLocation: string | null;
}

export function SettingsPage() {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [backupStatus, setBackupStatus] = useState<string | null>(null);

  useEffect(() => {
    safeInvoke<AppInfo>('app_info').then(setAppInfo);
  }, []);

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
      setBackupStatus(`Backup could not be exported. ${friendlyError(error, 'Please try again from the desktop app.')}`);
    }
  }

  return (
    <div className="page-stack">
      <header className="page-header">
        <p className="eyebrow">Settings</p>
        <h2>VascEdu settings</h2>
        <p className="muted">Release information, local data safety, and desktop app details.</p>
      </header>

      <section className="grid-2">
        <article className="content-card">
          <h3>About VascEdu</h3>
          <p>Local-first vascular imaging and endovascular training workspace for CT review, procedural planning, and guided practice.</p>
          <dl className="detail-list">
            <div><dt>App</dt><dd>{appInfo?.name ?? 'VascEdu'}</dd></div>
            <div><dt>Version</dt><dd>{appInfo?.version ?? '0.29.0'}</dd></div>
            <div><dt>Mode</dt><dd>{appInfo ? 'Desktop app' : 'Browser preview'}</dd></div>
            <div><dt>Build</dt><dd>{appInfo?.build ?? 'Browser preview'}</dd></div>
            <div><dt>Local data</dt><dd>{appInfo?.dataLocation ?? 'Available in desktop mode'}</dd></div>
          </dl>
        </article>

        <article className="content-card">
          <h3>Data backup</h3>
          <p>
            Export a local JSON backup of cases, questions, key images, procedural plans, devices,
            attempts, and responses. Imaging files remain where they are referenced on disk.
          </p>
          <div className="row-actions compact-actions">
            <button type="button" className="primary-button" onClick={() => void exportBackup()}>
              Export app backup
            </button>
          </div>
          {backupStatus ? <p className="muted small">{backupStatus}</p> : null}
        </article>
      </section>

      <section className="content-card release-readiness-card">
        <h3>Release readiness</h3>
        <div className="release-check-grid">
          <div><strong>Desktop packaging</strong><span>Windows/macOS bundle metadata is configured for local builds.</span></div>
          <div><strong>Privacy</strong><span>Case content, planning data, and progress are stored locally.</span></div>
          <div><strong>Backup</strong><span>Use the backup export before major content edits or app updates.</span></div>
        </div>
      </section>
    </div>
  );
}
