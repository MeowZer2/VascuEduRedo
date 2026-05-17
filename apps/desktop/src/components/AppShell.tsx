import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import type { Screen } from '../App';
import brandIcon from '../assets/brand/vascedu-icon.png';
import { useProfiles } from '../lib/profileContext';
import { deriveInitials, PROFILE_ROLES, type Profile } from '../lib/profiles';

interface AppShellProps {
  activeScreen: Screen;
  onNavigate: (screen: Screen) => void;
  children: ReactNode;
}

type IconProps = { size?: number; className?: string };
type NavItem = { id: Screen; label: string; icon: (props: IconProps) => JSX.Element; badge?: string };

const iconStroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

const HomeIcon = ({ size = 18, className = '' }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 18 18" className={className} aria-hidden="true" {...iconStroke}>
    <path d="M2.5 8.5 9 3l6.5 5.5" />
    <path d="M4 7.8V15h4v-4h2v4h4V7.8" />
  </svg>
);

const CasesIcon = ({ size = 18, className = '' }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 18 18" className={className} aria-hidden="true" {...iconStroke}>
    <path d="M9 2.5 2.5 5.5 9 8.5l6.5-3z" />
    <path d="M2.5 9 9 12l6.5-3" />
    <path d="M2.5 12.5 9 15.5l6.5-3" />
  </svg>
);

const PulseIcon = ({ size = 18, className = '' }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 18 18" className={className} aria-hidden="true" {...iconStroke}>
    <path d="M2 9h3l1.5-4 3 9 1.8-5 1.4 2H16" />
  </svg>
);

const DeviceIcon = ({ size = 18, className = '' }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 18 18" className={className} aria-hidden="true" {...iconStroke}>
    <path d="M3 9c2-2 4-2 6 0s4 2 6 0" />
    <path d="M3 5.5c2-2 4-2 6 0s4 2 6 0" />
    <path d="M3 12.5c2-2 4-2 6 0s4 2 6 0" />
  </svg>
);

const ChartIcon = ({ size = 18, className = '' }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 18 18" className={className} aria-hidden="true" {...iconStroke}>
    <path d="M2.5 14.5h13" />
    <path d="M5 12V8" />
    <path d="M8 12V5" />
    <path d="M11 12v-5" />
    <path d="M14 12V9" />
  </svg>
);

const CogIcon = ({ size = 18, className = '' }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 18 18" className={className} aria-hidden="true" {...iconStroke}>
    <circle cx="9" cy="9" r="2.4" />
    <path d="M9 1.5v2M9 14.5v2M3.7 3.7l1.4 1.4M12.9 12.9l1.4 1.4M1.5 9h2M14.5 9h2M3.7 14.3l1.4-1.4M12.9 5.1l1.4-1.4" />
  </svg>
);

const BranchIcon = ({ size = 18, className = '' }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 18 18" className={className} aria-hidden="true" {...iconStroke}>
    <circle cx="5" cy="4" r="1.4" />
    <circle cx="13" cy="4" r="1.4" />
    <circle cx="5" cy="14" r="1.4" />
    <path d="M5 5.4v7.2" />
    <path d="M13 5.4c0 3-3 4-8 4.6" />
  </svg>
);

const ShieldIcon = ({ size = 18, className = '' }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 18 18" className={className} aria-hidden="true" {...iconStroke}>
    <path d="M9 2.2 14.5 4v4.7c0 3.3-2.2 5.7-5.5 7.1-3.3-1.4-5.5-3.8-5.5-7.1V4z" />
    <path d="M6.3 9 8.2 11 12 6.8" />
  </svg>
);

const SearchIcon = ({ size = 18, className = '' }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 18 18" className={className} aria-hidden="true" {...iconStroke}>
    <circle cx="8" cy="8" r="4.5" />
    <path d="M11.5 11.5 15 15" />
  </svg>
);

const BellIcon = ({ size = 18, className = '' }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 18 18" className={className} aria-hidden="true" {...iconStroke}>
    <path d="M4 12.5h10l-1-2V7.5c0-2.2-1.8-4-4-4s-4 1.8-4 4v3z" />
    <path d="M7.5 14.5c.2.8 1 1.4 1.5 1.4s1.3-.6 1.5-1.4" />
  </svg>
);

const ChevronIcon = ({ size = 18, className = '' }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 18 18" className={className} aria-hidden="true" {...iconStroke}>
    <path d="M7 4.5 11.5 9 7 13.5" />
  </svg>
);

const navItems: NavItem[] = [
  { id: 'home', label: 'Home', icon: HomeIcon },
  { id: 'cases', label: 'Cases', icon: CasesIcon },
  { id: 'training', label: 'Practice', icon: PulseIcon },
  { id: 'vessel-composer', label: 'Planning', icon: BranchIcon },
  { id: 'devices', label: 'Devices', icon: DeviceIcon },
  { id: 'progress', label: 'Progress', icon: ChartIcon },
];

const utilityItems: NavItem[] = [
  { id: 'settings', label: 'Settings', icon: CogIcon },
  { id: 'admin', label: 'Admin', icon: ShieldIcon },
];

const screenLabels: Record<Screen, string> = {
  home: 'Home',
  cases: 'Cases',
  'case-detail': 'Case detail',
  training: 'Practice',
  'training-session': 'Training workspace',
  'vessel-composer': 'Planning',
  devices: 'Devices',
  progress: 'Progress',
  admin: 'Admin',
  settings: 'Settings',
};

export function AppShell({ activeScreen, onNavigate, children }: AppShellProps) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('vascedu.sidebarCollapsed') === '1');
  const activeNav: Screen =
    activeScreen === 'case-detail' || activeScreen === 'training-session' ? 'cases' : activeScreen;
  const crumbs = useMemo(() => ['VascEdu', screenLabels[activeScreen]], [activeScreen]);

  useEffect(() => {
    localStorage.setItem('vascedu.sidebarCollapsed', collapsed ? '1' : '0');
  }, [collapsed]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={`app cards-elevated icon-style-line${collapsed ? ' nav-rail' : ''}`} data-screen-label={activeScreen}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <img src={brandIcon} alt="VascEdu" />
          </div>
          <div className="brand-text">
            <strong>VascEdu</strong>
            <small>v0.29 · LOCAL</small>
          </div>
          <button
            className="sidebar-collapse"
            onClick={() => setCollapsed((value) => !value)}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <ChevronIcon size={14} className={collapsed ? '' : 'rotate-180'} />
          </button>
        </div>

        <nav className="nav-section" aria-label="Primary">
          <div className="nav-label">Workspace</div>
          {navItems.map((item) => (
            <NavButton key={item.id} item={item} active={item.id === activeNav} onNavigate={onNavigate} />
          ))}
        </nav>

        <nav className="nav-section" aria-label="System">
          <div className="nav-label">System</div>
          {utilityItems.map((item) => (
            <NavButton key={item.id} item={item} active={item.id === activeNav} onNavigate={onNavigate} />
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-status">
            <span className="status-dot" />
            <span>Tauri desktop · SQLite synced</span>
          </div>
          <ProfileMenu collapsed={collapsed} />
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <div className="crumbs">
            {crumbs.map((crumb, index) => (
              <span key={crumb} className={index === crumbs.length - 1 ? 'crumb-current' : undefined}>
                {index > 0 && <span className="sep">/</span>}
                {index === crumbs.length - 1 ? <strong>{crumb}</strong> : crumb}
              </span>
            ))}
          </div>
          <div className="topbar-actions">
            <button
              className="search-input"
              onClick={() => setPaletteOpen(true)}
              aria-label="Quick navigation"
            >
              <SearchIcon size={14} />
              <span>Jump to a section...</span>
              <kbd>Ctrl K</kbd>
            </button>
            <button
              className="icon-btn"
              aria-label="Notifications"
              disabled
              title="Notifications are not available in this build"
            >
              <BellIcon size={15} />
            </button>
            {activeScreen !== 'training-session' && (
              <button className="btn primary small" onClick={() => onNavigate('training')}>
                <PulseIcon size={12} /> Start practice
              </button>
            )}
          </div>
        </div>

        <div className="main-panel redesign-main-panel">{children}</div>
      </main>

      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} onNavigate={onNavigate} />}
    </div>
  );
}

function NavButton({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate: (screen: Screen) => void;
}) {
  const Icon = item.icon;
  return (
    <button className={`nav-item ${active ? 'active' : ''}`} onClick={() => onNavigate(item.id)} title={item.label}>
      <span className="nav-ic">
        <Icon size={16} />
      </span>
      <span>{item.label}</span>
      {item.badge ? <span className="nav-badge">{item.badge}</span> : <span />}
    </button>
  );
}

function CommandPalette({
  onClose,
  onNavigate,
}: {
  onClose: () => void;
  onNavigate: (screen: Screen) => void;
}) {
  const [query, setQuery] = useState('');
  const commands = [...navItems, ...utilityItems].map((item) => ({
    ...item,
    commandLabel: `Go to ${item.label}`,
  }));
  const filtered = query.trim()
    ? commands.filter((item) => item.commandLabel.toLowerCase().includes(query.toLowerCase()))
    : commands;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette" onClick={(event) => event.stopPropagation()}>
        <input
          className="palette-input"
          placeholder="Type a command or search..."
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="palette-list">
          {filtered.map((item, index) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={`palette-row ${index === 0 ? 'active' : ''}`}
                onClick={() => {
                  onNavigate(item.id);
                  onClose();
                }}
              >
                <Icon size={15} />
                <span>{item.commandLabel}</span>
                <span className="palette-shortcut">G {item.label[0]}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ProfileAvatar({ profile, size = 32 }: { profile: Profile; size?: number }) {
  const initials = profile.initials || deriveInitials(profile.displayName);
  return (
    <div
      className="user-avatar"
      style={{
        width: size,
        height: size,
        fontSize: size <= 26 ? 10 : 11,
        color: '#04181c',
        background: profile.avatarColor
          ? `linear-gradient(135deg, ${profile.avatarColor}, rgba(4,24,28,0.55))`
          : undefined,
      }}
    >
      {initials}
    </div>
  );
}

function ProfileMenu({ collapsed }: { collapsed: boolean }) {
  const { profiles, activeProfile, switchProfile, addProfile, editProfile, removeProfile } =
    useProfiles();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'menu' | 'add' | 'edit'>('menu');
  const [name, setName] = useState('');
  const [role, setRole] = useState<string>('PGY-1');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  function close() {
    setOpen(false);
    setMode('menu');
    setConfirmDelete(false);
  }

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (event: MouseEvent) => {
      if (anchorRef.current && !anchorRef.current.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function startAdd() {
    setName('');
    setRole('PGY-1');
    setConfirmDelete(false);
    setMode('add');
  }

  function startEdit() {
    setName(activeProfile.displayName);
    setRole(activeProfile.role);
    setConfirmDelete(false);
    setMode('edit');
  }

  function submitAdd(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    addProfile({ displayName: name.trim(), role });
    close();
  }

  function submitEdit(event: FormEvent) {
    event.preventDefault();
    editProfile(activeProfile.id, {
      displayName: name.trim() || activeProfile.displayName,
      role,
    });
    setMode('menu');
  }

  function doDelete() {
    if (removeProfile(activeProfile.id)) close();
  }

  const others = profiles.filter((p) => p.id !== activeProfile.id);

  return (
    <div className={`profile-menu${collapsed ? ' profile-menu--rail' : ''}`} ref={anchorRef}>
      <button
        type="button"
        className="user-chip"
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${activeProfile.displayName} · ${activeProfile.role}`}
        onClick={() => setOpen((value) => !value)}
      >
        <ProfileAvatar profile={activeProfile} />
        <div>
          <strong>{activeProfile.displayName}</strong>
          <small>{activeProfile.role}</small>
        </div>
        <ChevronIcon size={14} className={open ? 'rotate-180' : ''} />
      </button>

      {open && (
        <div className="profile-pop" role="menu">
          <div className="profile-pop-head">
            <span className="profile-pop-eyebrow">Signed in as</span>
            <div className="profile-pop-current">
              <ProfileAvatar profile={activeProfile} size={34} />
              <div>
                <strong>{activeProfile.displayName}</strong>
                <span>{activeProfile.role}</span>
              </div>
            </div>
          </div>

          {mode === 'menu' && (
            <>
              {others.length > 0 && (
                <div className="profile-pop-section">
                  <div className="profile-pop-eyebrow">Switch profile</div>
                  {others.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="profile-row"
                      role="menuitem"
                      onClick={() => {
                        switchProfile(p.id);
                        close();
                      }}
                    >
                      <ProfileAvatar profile={p} size={26} />
                      <div>
                        <strong>{p.displayName}</strong>
                        <span>{p.role}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              <div className="profile-pop-section">
                <button type="button" className="profile-action" onClick={startAdd}>
                  Add profile
                </button>
                <button type="button" className="profile-action" onClick={startEdit}>
                  Edit current profile
                </button>
                {profiles.length > 1 ? (
                  confirmDelete ? (
                    <div className="profile-confirm">
                      <span>Delete “{activeProfile.displayName}” and its local progress?</span>
                      <div className="profile-confirm-actions">
                        <button
                          type="button"
                          className="btn ghost small"
                          onClick={() => setConfirmDelete(false)}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="btn small profile-danger"
                          onClick={doDelete}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="profile-action profile-action--danger"
                      onClick={() => setConfirmDelete(true)}
                    >
                      Delete current profile
                    </button>
                  )
                ) : (
                  <button
                    type="button"
                    className="profile-action"
                    disabled
                    title="At least one profile is required"
                  >
                    Delete current profile
                  </button>
                )}
              </div>
            </>
          )}

          {(mode === 'add' || mode === 'edit') && (
            <form
              className="profile-form"
              onSubmit={mode === 'add' ? submitAdd : submitEdit}
            >
              <div className="profile-pop-eyebrow">
                {mode === 'add' ? 'New profile' : 'Edit profile'}
              </div>
              <label className="field">
                <span>Name</span>
                <input
                  className="input"
                  autoFocus
                  placeholder="e.g. Dr. Sam Chen"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Role / level</span>
                <select
                  className="input"
                  value={role}
                  onChange={(event) => setRole(event.target.value)}
                >
                  {PROFILE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
              <div className="profile-form-actions">
                <button type="button" className="btn ghost small" onClick={() => setMode('menu')}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn primary small"
                  disabled={mode === 'add' && !name.trim()}
                >
                  {mode === 'add' ? 'Create' : 'Save'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
