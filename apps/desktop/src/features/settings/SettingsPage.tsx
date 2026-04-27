import { useEffect, useState } from 'react';
import { safeInvoke } from '../../lib/tauri';

interface AppInfo {
  name: string;
  version: string;
  backend: string;
}

export function SettingsPage() {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    safeInvoke<AppInfo>('app_info').then(setAppInfo);
  }, []);

  return (
    <div className="page-stack">
      <header className="page-header">
        <p className="eyebrow">Settings</p>
        <h2>Application settings</h2>
      </header>

      <section className="grid-2">
        <article className="content-card">
          <h3>Current scaffold</h3>
          <p>Frontend runs in browser mode or Tauri mode. The Rust command bridge is optional for this v0.1 UI.</p>
          <dl className="detail-list">
            <div><dt>App</dt><dd>{appInfo?.name ?? 'VascEdu'}</dd></div>
            <div><dt>Version</dt><dd>{appInfo?.version ?? '0.1.0'}</dd></div>
            <div><dt>Backend</dt><dd>{appInfo?.backend ?? 'Browser preview / Tauri unavailable'}</dd></div>
          </dl>
        </article>

        <article className="content-card">
          <h3>Next technical milestone</h3>
          <p>
            Build a Rust-side NRRD loader command that returns slice metadata and an 8-bit windowed image buffer to the frontend.
          </p>
        </article>
      </section>
    </div>
  );
}
