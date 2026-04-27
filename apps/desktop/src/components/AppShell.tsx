import type { ReactNode } from 'react';
import type { Screen } from '../App';

interface AppShellProps {
  activeScreen: Screen;
  onNavigate: (screen: Screen) => void;
  children: ReactNode;
}

const navItems: Array<{ id: Screen; label: string }> = [
  { id: 'home', label: 'Home' },
  { id: 'cases', label: 'Cases' },
  { id: 'training', label: 'Training' },
  { id: 'progress', label: 'Progress' },
  { id: 'admin', label: 'Admin Preview' },
  { id: 'settings', label: 'Settings' },
];

export function AppShell({ activeScreen, onNavigate, children }: AppShellProps) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">V</div>
          <div>
            <h1>VascEdu</h1>
            <p>vascular imaging education</p>
          </div>
        </div>

        <nav className="nav-list" aria-label="Main navigation">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={item.id === activeScreen ? 'nav-item active' : 'nav-item'}
              onClick={() => onNavigate(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-note">
          <strong>v0.1 scaffold</strong>
          <span>Real NRRD viewer + quiz flow</span>
        </div>
      </aside>

      <main className="main-panel">{children}</main>
    </div>
  );
}
