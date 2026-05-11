import type { ReactNode } from 'react';
import type { Screen } from '../App';

interface AppShellProps {
  activeScreen: Screen;
  onNavigate: (screen: Screen) => void;
  children: ReactNode;
}

const navItems: Array<{ id: Screen; label: string }> = [
  { id: 'home', label: 'Home' },
  { id: 'training', label: 'Practice' },
  { id: 'cases', label: 'Cases' },
  { id: 'vessel-composer', label: 'Planning' },
  { id: 'devices', label: 'Devices' },
  { id: 'progress', label: 'Progress' },
  { id: 'admin', label: 'Admin' },
  { id: 'settings', label: 'Settings' },
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
            <p>vascular training</p>
          </div>
        </div>

        <nav className="nav-list" aria-label="Main navigation">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={item.id === activeNav ? 'nav-item active' : 'nav-item'}
              onClick={() => onNavigate(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-note">
          <strong>Guided practice</strong>
          <span>Cases, measurements, and feedback</span>
        </div>
      </aside>

      <main className="main-panel">{children}</main>
    </div>
  );
}
