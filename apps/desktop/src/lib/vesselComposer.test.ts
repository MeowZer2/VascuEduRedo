// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  emptyVesselCompositionData,
  getVesselComposition,
  listVesselCompositions,
  saveVesselComposition,
  vesselPlanDocumentKey,
  type VesselCompositionRow,
} from './vesselComposer';

const STORAGE_KEY = 'vascedu.vesselCompositions.v0.13';

function row(id: string, scope: 'reference' | 'learner', profileId: string | null, caseId: string): VesselCompositionRow {
  return { id, scope, profileId, caseId, name: id, data: emptyVesselCompositionData(), updatedAt: '2026-01-01T00:00:00.000Z' };
}

describe('browser vessel plan persistence', () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete window.__TAURI_INTERNALS__;
  });

  it('preserves reference and every learner scope while saving and editing', async () => {
    const initial = [row('reference-a', 'reference', null, 'case-a'), row('learner-a1', 'learner', 'profile-a', 'case-a'), row('learner-b1', 'learner', 'profile-b', 'case-b')];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));

    await saveVesselComposition({ id: 'learner-a2', scope: 'learner', profileId: 'profile-a', caseId: 'case-b', name: 'Learner A2', data: emptyVesselCompositionData() });
    await saveVesselComposition({ id: 'reference-b', scope: 'reference', caseId: 'case-b', name: 'Reference B', data: emptyVesselCompositionData() });
    await saveVesselComposition({ id: 'learner-b1', scope: 'learner', profileId: 'profile-b', caseId: 'case-b', name: 'Learner B1 edited', data: emptyVesselCompositionData() });

    const all = await listVesselCompositions({ scope: 'all' });
    expect(new Set(all.map((item) => item.id))).toEqual(new Set(['reference-a', 'learner-a1', 'learner-b1', 'learner-a2', 'reference-b']));
    expect(all.find((item) => item.id === 'learner-b1')?.name).toBe('Learner B1 edited');
    expect((await listVesselCompositions({ scope: 'learner', profileId: 'profile-a', caseId: 'case-a' })).map((item) => item.id)).toEqual(['learner-a1']);
  });

  it('retrieves learner plans directly by id without reference-only filtering', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([row('learner-a1', 'learner', 'profile-a', 'case-a')]));
    expect((await getVesselComposition('learner-a1'))?.scope).toBe('learner');
  });

  it('includes rename and case relink in the document identity used by dirty tracking', () => {
    const saved = vesselPlanDocumentKey('Plan', 'case-a', 'learner');
    expect(vesselPlanDocumentKey('Renamed', 'case-a', 'learner')).not.toBe(saved);
    expect(vesselPlanDocumentKey('Plan', 'case-b', 'learner')).not.toBe(saved);
    expect(vesselPlanDocumentKey('Plan', 'case-a', 'learner')).toBe(saved);
  });
});
