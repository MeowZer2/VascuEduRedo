// Local profile registry.
//
// Profiles let several residents/users share one workstation without sharing
// learner progress. Everything here is local-only (localStorage), so it works
// identically in the Tauri desktop app and in browser preview mode, and it
// never touches the imaging viewer / scan cache / SQLite content.
//
// Scoping strategy: profile-specific learner data is stored under a key that
// is namespaced by the active profile id via `profileScopedKey`. Shared data
// (case library, devices, admin-authored content, scan files) keeps its
// original global keys and is intentionally NOT namespaced.

const PROFILES_KEY = 'vascedu.profiles.v1';
const ACTIVE_KEY = 'vascedu.activeProfileId.v1';
const MIGRATION_FLAG = 'vascedu.profiles.legacyMigrated.v1';

/** Base key of the legacy (pre-profile) attempts store, migrated on first run. */
export const LEGACY_ATTEMPTS_KEY = 'vascedu.attempts.v0';

export const PROFILE_CHANGED_EVENT = 'vascedu:profile-changed';

export const PROFILE_ROLES = [
  'Medical Student',
  'PGY-1',
  'PGY-2',
  'PGY-3',
  'PGY-4',
  'PGY-5',
  'PGY-6',
  'PGY-7',
  'Fellow',
  'Staff',
  'Admin',
] as const;

export type ProfileRole = (typeof PROFILE_ROLES)[number];

export interface Profile {
  id: string;
  displayName: string;
  role: string;
  initials?: string;
  avatarColor?: string;
  createdAt: string;
  updatedAt: string;
  lastActiveAt: string;
  preferences?: Record<string, unknown>;
}

const AVATAR_COLORS = [
  '#5dd4e6',
  '#6f8fff',
  '#5ec48d',
  '#e6b256',
  '#ec6b78',
  '#b48ce6',
  '#e68c5c',
];

function hasWindow(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function deriveInitials(name: string): string {
  const cleaned = name.replace(/^Dr\.?\s+/i, '').trim();
  if (!cleaned) return '?';
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function colorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function readProfiles(): Profile[] {
  if (!hasWindow()) return [];
  try {
    const raw = window.localStorage.getItem(PROFILES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is Profile =>
        !!p && typeof p === 'object' && typeof (p as Profile).id === 'string',
    );
  } catch {
    return [];
  }
}

function writeProfiles(profiles: Profile[]): void {
  if (!hasWindow()) return;
  try {
    window.localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
  } catch {
    // best effort
  }
}

function emitChange(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PROFILE_CHANGED_EVENT));
}

/** Namespace a learner-data storage key to a profile so users don't share progress. */
export function profileScopedKey(baseKey: string, profileId: string): string {
  return `${baseKey}::p:${profileId}`;
}

export function listProfiles(): Profile[] {
  return readProfiles().slice().sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function getActiveProfileId(): string {
  // ensureDefaultProfile() always runs at startup, so this is safe afterwards.
  if (!hasWindow()) return 'default';
  const id = window.localStorage.getItem(ACTIVE_KEY);
  const profiles = readProfiles();
  if (id && profiles.some((p) => p.id === id)) return id;
  return profiles[0]?.id ?? 'default';
}

export function getActiveProfile(): Profile | null {
  const id = getActiveProfileId();
  return readProfiles().find((p) => p.id === id) ?? null;
}

function persistActiveId(id: string): void {
  if (!hasWindow()) return;
  try {
    window.localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    // best effort
  }
}

export function setActiveProfile(id: string): void {
  const profiles = readProfiles();
  const target = profiles.find((p) => p.id === id);
  if (!target) return;
  target.lastActiveAt = nowIso();
  writeProfiles(profiles);
  persistActiveId(id);
  emitChange();
}

export interface CreateProfileInput {
  displayName: string;
  role: string;
  initials?: string;
  avatarColor?: string;
}

export function createProfile(input: CreateProfileInput, makeActive = true): Profile {
  const displayName = input.displayName.trim() || 'Local User';
  const id = `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const profile: Profile = {
    id,
    displayName,
    role: input.role || 'Resident',
    initials: (input.initials || deriveInitials(displayName)).slice(0, 3),
    avatarColor: input.avatarColor || colorFor(id),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    lastActiveAt: nowIso(),
  };
  const profiles = readProfiles();
  profiles.push(profile);
  writeProfiles(profiles);
  if (makeActive) persistActiveId(id);
  emitChange();
  return profile;
}

export function updateProfile(
  id: string,
  patch: Partial<Pick<Profile, 'displayName' | 'role' | 'initials' | 'avatarColor' | 'preferences'>>,
): Profile | null {
  const profiles = readProfiles();
  const profile = profiles.find((p) => p.id === id);
  if (!profile) return null;
  if (patch.displayName !== undefined) {
    profile.displayName = patch.displayName.trim() || profile.displayName;
    if (patch.initials === undefined) profile.initials = deriveInitials(profile.displayName);
  }
  if (patch.role !== undefined) profile.role = patch.role;
  if (patch.initials !== undefined) profile.initials = patch.initials.slice(0, 3);
  if (patch.avatarColor !== undefined) profile.avatarColor = patch.avatarColor;
  if (patch.preferences !== undefined) profile.preferences = patch.preferences;
  profile.updatedAt = nowIso();
  writeProfiles(profiles);
  emitChange();
  return profile;
}

/**
 * Delete a profile. Refuses to delete the last remaining profile so the app
 * always has an active profile. Also clears that profile's scoped learner data.
 */
export function deleteProfile(id: string): boolean {
  const profiles = readProfiles();
  if (profiles.length <= 1) return false;
  const next = profiles.filter((p) => p.id !== id);
  if (next.length === profiles.length) return false;
  writeProfiles(next);
  // Drop the deleted profile's scoped learner data.
  if (hasWindow()) {
    try {
      window.localStorage.removeItem(profileScopedKey(LEGACY_ATTEMPTS_KEY, id));
    } catch {
      // best effort
    }
  }
  if (getActiveProfileId() === id) {
    persistActiveId(next[0].id);
  }
  emitChange();
  return true;
}

/**
 * Guarantees at least one profile exists and an active id is set. On the very
 * first run it also migrates any pre-profile learner data (the legacy global
 * attempts store) onto the default profile so existing progress is preserved.
 * Safe to call repeatedly; non-destructive.
 */
export function ensureDefaultProfile(): Profile {
  const profiles = readProfiles();
  if (profiles.length > 0) {
    const activeId = window.localStorage.getItem(ACTIVE_KEY);
    if (!activeId || !profiles.some((p) => p.id === activeId)) {
      persistActiveId(profiles[0].id);
    }
    return profiles.find((p) => p.id === getActiveProfileId()) ?? profiles[0];
  }

  const profile = createProfile({ displayName: 'Local User', role: 'Resident' }, true);

  // One-time, non-destructive migration: copy legacy (un-namespaced) attempts
  // into the default profile's scoped key. The original key is left intact.
  if (hasWindow()) {
    try {
      const alreadyMigrated = window.localStorage.getItem(MIGRATION_FLAG);
      const legacy = window.localStorage.getItem(LEGACY_ATTEMPTS_KEY);
      const scopedKey = profileScopedKey(LEGACY_ATTEMPTS_KEY, profile.id);
      if (!alreadyMigrated && legacy && !window.localStorage.getItem(scopedKey)) {
        window.localStorage.setItem(scopedKey, legacy);
      }
      window.localStorage.setItem(MIGRATION_FLAG, '1');
    } catch {
      // best effort — a failed migration just means the default profile starts empty
    }
  }
  return profile;
}
