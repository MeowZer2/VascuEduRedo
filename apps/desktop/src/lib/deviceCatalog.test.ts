import { describe, expect, it } from 'vitest';
import { DEVICE_IMPORT_VERSION, parseCatalogText, validateCatalog } from './deviceCatalog';
import { isVerified, type Device } from './devices';

describe('device import validation', () => {
  it.each([null, 'foo', 42])('reports malformed device entry %p without throwing', (entry) => {
    const parsed = parseCatalogText(JSON.stringify({ version: DEVICE_IMPORT_VERSION, devices: [entry] }));
    expect(parsed.kind).toBe('parsed');
    if (parsed.kind !== 'parsed') return;
    const report = validateCatalog(parsed.payload, [], 'skip');
    expect(report.ok).toBe(false);
    expect(report.errors[0]?.message).toContain('must be an object');
  });

  it('rejects wrong field types, invalid URLs, and impossible dates', () => {
    const parsed = parseCatalogText(JSON.stringify({
      version: DEVICE_IMPORT_VERSION,
      sourceDate: 'not-a-date',
      devices: [{ name: 123, manufacturer: 'Maker', category: 'Stent', sourceUrl: 'not a url', lastVerifiedAt: 'yesterday-ish' }],
    }));
    if (parsed.kind !== 'parsed') throw new Error('fixture did not parse');
    const fields = validateCatalog(parsed.payload, [], 'skip').errors.map((issue) => issue.field);
    expect(fields).toEqual(expect.arrayContaining(['sourceDate', 'name', 'sourceUrl', 'lastVerifiedAt']));
  });

  it('does not infer clinical verification from source/date strings', () => {
    const device: Device = {
      id: 'd', name: 'D', manufacturer: 'M', category: 'C', subtype: null,
      description: 'x', sizes: [], properties: {}, tags: [],
      spec: { sourceUrl: 'https://example.com/ifu', lastVerifiedAt: '2026-01-01' },
    };
    expect(isVerified(device)).toBe(false);
  });
});
