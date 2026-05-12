import type { ReactNode } from 'react';
import type { Screen } from '../App';

interface AppShellProps {
  activeScreen: Screen;
  onNavigate: (screen: Screen) => void;
  children: ReactNode;
}

const learnerNavItems: Array<{ id: Screen; label: string; kicker: string; icon: string }> = [
  { id: 'home', label: 'Home', kicker: 'Dashboard', icon: 'H' },
  { id: 'training', label: 'Practice', kicker: 'Guided sessions', icon: 'P' },
  { id: 'cases', label: 'Cases', kicker: 'Case library', icon: 'C' },
  { id: 'vessel-composer', label: 'Planning', kicker: 'Angiogram workspace', icon: 'L' },
  { id: 'devices', label: 'Devices', kicker: 'Catalog reference', icon: 'D' },
  { id: 'progress', label: 'Progress', kicker: 'Learning record', icon: 'R' },
];

const utilityNavItems: Array<{ id: Screen; label: string; kicker: string; icon: string }> = [
  { id: 'settings', label: 'Settings', kicker: 'App preferences', icon: 'S' },
  { id: 'admin', label: 'Admin', kicker: 'Authoring tools', icon: 'A' },
];

export function AppShell({ activeScreen, onNavigate, children }: AppShellProps) {
  const activeNav = activeScreen === 'training-session' ? 'training' : activeScreen;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">V</div>
          <div>
            <h1>VascEdu</h1>
            <p>vascular imaging training</p>
          </div>
        </div>

        <nav className="nav-list" aria-label="Main navigation">
          <span className="nav-section-label">Learn</span>
          {learnerNavItems.map((item) => (
            <NavButton key={item.id} item={item} active={item.id === activeNav} onNavigate={onNavigate} />
          ))}
          <span className="nav-section-label utility">Workspace</span>
          {utilityNavItems.map((item) => (
            <NavButton key={item.id} item={item} active={item.id === activeNav} onNavigate={onNavigate} secondary />
          ))}
        </nav>

        <div className="sidebar-note">
          <strong>Local-first desktop</strong>
          <span>Cases, scans, planning, and progress stay on this workstation</span>
        </div>
      </aside>

      <main className="main-panel">{children}</main>
    </div>
  );
}

function NavButton({
  item,
  active,
  secondary = false,
  onNavigate,
}: {
  item: { id: Screen; label: string; kicker: string; icon: string };
  active: boolean;
  secondary?: boolean;
  onNavigate: (screen: Screen) => void;
}) {
  return (
    <button
      className={`${active ? 'nav-item active' : 'nav-item'}${secondary ? ' secondary-nav' : ''}`}
      onClick={() => onNavigate(item.id)}
    >
      <span className="nav-icon" aria-hidden="true">{item.icon}</span>
      <span>
        <strong>{item.label}</strong>
        <small>{item.kicker}</small>
      </span>
    </button>
  );
}
