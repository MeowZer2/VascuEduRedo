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
          <h3>About VascEdu</h3>
          <p>Local training workspace for vascular imaging cases, measurements, and progress review.</p>
          <dl className="detail-list">
            <div><dt>App</dt><dd>{appInfo?.name ?? 'VascEdu'}</dd></div>
            <div><dt>Version</dt><dd>{appInfo?.version ?? '0.1.0'}</dd></div>
            <div><dt>Mode</dt><dd>{appInfo ? 'Desktop app' : 'Browser preview'}</dd></div>
          </dl>
        </article>

        <article className="content-card">
          <h3>Study data</h3>
          <p>
            Imaging and progress data stay local to this workstation unless you export or import content
            through the Admin area.
          </p>
        </article>
      </section>
    </div>
  );
}
