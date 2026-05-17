// React binding for the local profile registry (lib/profiles.ts).
//
// The provider runs ensureDefaultProfile() synchronously on first render so
// there is always an active profile before any progress-reading screen mounts.
// `activeProfileId` is meant to be used as a React `key` on profile-scoped
// screens (Home / Progress) so switching profiles fully refreshes them.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  createProfile as createProfileCore,
  deleteProfile as deleteProfileCore,
  ensureDefaultProfile,
  getActiveProfileId,
  listProfiles,
  PROFILE_CHANGED_EVENT,
  setActiveProfile as setActiveProfileCore,
  updateProfile as updateProfileCore,
  type CreateProfileInput,
  type Profile,
} from './profiles';

interface ProfileContextValue {
  profiles: Profile[];
  activeProfile: Profile;
  activeProfileId: string;
  switchProfile: (id: string) => void;
  addProfile: (input: CreateProfileInput) => Profile;
  editProfile: (
    id: string,
    patch: Partial<Pick<Profile, 'displayName' | 'role' | 'initials' | 'avatarColor' | 'preferences'>>,
  ) => void;
  removeProfile: (id: string) => boolean;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }) {
  // ensureDefaultProfile() is idempotent and localStorage-only; running it in
  // the initializer guarantees a valid active profile before children render.
  const [bootProfile] = useState<Profile>(() => ensureDefaultProfile());
  const [profiles, setProfiles] = useState<Profile[]>(() => listProfiles());
  const [activeProfileId, setActiveProfileId] = useState<string>(
    () => getActiveProfileId() || bootProfile.id,
  );

  const refresh = useCallback(() => {
    setProfiles(listProfiles());
    setActiveProfileId(getActiveProfileId());
  }, []);

  // Keep in sync when another part of the app (or another tab) changes profiles.
  useEffect(() => {
    window.addEventListener(PROFILE_CHANGED_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(PROFILE_CHANGED_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [refresh]);

  const switchProfile = useCallback(
    (id: string) => {
      setActiveProfileCore(id);
      refresh();
    },
    [refresh],
  );

  const addProfile = useCallback(
    (input: CreateProfileInput) => {
      const created = createProfileCore(input, true);
      refresh();
      return created;
    },
    [refresh],
  );

  const editProfile = useCallback(
    (
      id: string,
      patch: Partial<
        Pick<Profile, 'displayName' | 'role' | 'initials' | 'avatarColor' | 'preferences'>
      >,
    ) => {
      updateProfileCore(id, patch);
      refresh();
    },
    [refresh],
  );

  const removeProfile = useCallback(
    (id: string) => {
      const ok = deleteProfileCore(id);
      refresh();
      return ok;
    },
    [refresh],
  );

  const activeProfile = useMemo(
    () => profiles.find((p) => p.id === activeProfileId) ?? profiles[0] ?? bootProfile,
    [profiles, activeProfileId, bootProfile],
  );

  const value = useMemo<ProfileContextValue>(
    () => ({
      profiles,
      activeProfile,
      activeProfileId: activeProfile.id,
      switchProfile,
      addProfile,
      editProfile,
      removeProfile,
    }),
    [profiles, activeProfile, switchProfile, addProfile, editProfile, removeProfile],
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfiles(): ProfileContextValue {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error('useProfiles must be used within a ProfileProvider');
  return ctx;
}
