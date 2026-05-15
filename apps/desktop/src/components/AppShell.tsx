import type { ReactNode } from 'react';
import type { Screen } from '../App';

interface AppShellProps {
  activeScreen: Screen;
  onNavigate: (screen: Screen) => void;
  children: ReactNode;
}

const learnerNavItems: Array<{ id: Screen; label: string; kicker: string; icon: string }> = [
  { id: 'home', label: 'Home', kicker: 'Dashboard', icon: 'H' },
  { id: 'cases', label: 'Cases', kicker: 'Discover & practice', icon: 'C' },
  { id: 'vessel-composer', label: 'Planning', kicker: 'Procedural workspace', icon: 'L' },
  { id: 'devices', label: 'Devices', kicker: 'Catalog reference', icon: 'D' },
  { id: 'progress', label: 'Progress', kicker: 'Performance review', icon: 'R' },
];

const utilityNavItems: Array<{ id: Screen; label: string; kicker: string; icon: string }> = [
  { id: 'settings', label: 'Settings', kicker: 'App preferences', icon: 'S' },
  { id: 'admin', label: 'Admin', kicker: 'Authoring tools', icon: 'A' },
];

export function AppShell({ activeScreen, onNavigate, children }: AppShellProps) {
  // Practice routes (training start + session) collapse onto Cases visually
  // because the merged Cases page is the single learner discovery surface.
  const activeNav: Screen =
    activeScreen === 'training' || activeScreen === 'training-session'
      ? 'cases'
      : activeScreen;
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
          <span>Cases, scans, planning, and progress stay on this workstation.</span>
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
