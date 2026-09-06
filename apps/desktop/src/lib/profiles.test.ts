// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createProfile,
  deleteProfile,
  ensureDefaultProfile,
  getActiveProfileId,
  LEGACY_ATTEMPTS_KEY,
  listProfiles,
  profileScopedKey,
} from './profiles';

const VESSEL_KEY = 'vascedu.vesselCompositions.v0.13';

describe('profile learner-data deletion', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('keeps the registry intact when native cleanup fails', async () => {
    const profileA = ensureDefaultProfile();
    createProfile({ displayName: 'Profile B', role: 'PGY-2' }, false);
    const cleanup = vi.fn().mockRejectedValue(new Error('database unavailable'));

    await expect(deleteProfile(profileA.id, cleanup)).rejects.toThrow('database unavailable');

    expect(listProfiles().map((profile) => profile.id)).toContain(profileA.id);
    expect(getActiveProfileId()).toBe(profileA.id);
  });

  it('removes only the selected profile browser records after durable cleanup', async () => {
    const profileA = ensureDefaultProfile();
    const profileB = createProfile({ displayName: 'Profile B', role: 'PGY-2' }, false);
    window.localStorage.setItem(profileScopedKey(LEGACY_ATTEMPTS_KEY, profileA.id), '["a"]');
    window.localStorage.setItem(profileScopedKey(LEGACY_ATTEMPTS_KEY, profileB.id), '["b"]');
    window.localStorage.setItem(profileScopedKey('vascedu.composerDraft', profileA.id), 'draft-a');
    window.localStorage.setItem(
      VESSEL_KEY,
      JSON.stringify([
        { id: 'plan-a', scope: 'learner', profileId: profileA.id },
        { id: 'plan-b', scope: 'learner', profileId: profileB.id },
        { id: 'reference', scope: 'reference', profileId: null },
      ]),
    );

    await expect(
      deleteProfile(profileA.id, async () => ({ attempts: 1, responses: 2, learnerPlans: 1 })),
    ).resolves.toBe(true);

    expect(window.localStorage.getItem(profileScopedKey(LEGACY_ATTEMPTS_KEY, profileA.id))).toBeNull();
    expect(window.localStorage.getItem(profileScopedKey('vascedu.composerDraft', profileA.id))).toBeNull();
    expect(window.localStorage.getItem(profileScopedKey(LEGACY_ATTEMPTS_KEY, profileB.id))).toBe('["b"]');
    const plans = JSON.parse(window.localStorage.getItem(VESSEL_KEY) ?? '[]') as Array<{ id: string }>;
    expect(plans.map((plan) => plan.id)).toEqual(['plan-b', 'reference']);
    expect(listProfiles().map((profile) => profile.id)).toEqual([profileB.id]);
    expect(getActiveProfileId()).toBe(profileB.id);
  });
});
