// Verified device catalog import/export pipeline.
//
// DESIGN: the structured device spec is carried inside the existing device
// `properties` JSON object under the reserved key `__deviceSpec` (see
// lib/devices.ts). This means NO SQLite schema migration and NO Rust changes
// are required — the device store already round-trips `properties` as an
// arbitrary JSON object, so existing devices, backups, and deviceSelection
// questions are unaffected.
//
// Import format (JSON):
//
//   {
//     "version": "vascedu/devices@1",
//     "sourceName": "Manufacturer IFU export — 2026",
//     "sourceDate": "2026-05-17",
//     "devices": [ DeviceImportInput, ... ]
//   }
//
// DeviceImportInput required:  name, manufacturer, category
// DeviceImportInput optional:  subtype, description, deviceFamily,
//   vascularTerritory, indicationsSummary, availableDiametersMm[],
//   availableLengthsMm[], compatibleSheathFr[], workingLengthCm[],
//   wireCompatibilityInch[], deliverySystem, mriCompatibility,
//   radiopaqueMarkers, sizes[], properties{}, tags[], sourceReference,
//   sourceUrl, lastVerifiedAt (ISO date), notes
//
// IMPORTANT: this module never fabricates specifications. Numeric spec fields
// are only written when explicitly provided in the import payload.

import {
  adminCreateDevice,
  adminUpdateDevice,
  mergeSpecIntoProperties,
  NUMERIC_SPEC_FIELDS,
  RESERVED_SPEC_KEY,
  TEXT_SPEC_FIELDS,
  type Device,
  type DeviceInput,
  type DeviceSpec,
} from './devices';

export const DEVICE_IMPORT_VERSION = 'vascedu/devices@1';

export interface DeviceImportInput {
  name: string;
  manufacturer: string;
  category: string;
  subtype?: string | null;
  description?: string;
  sizes?: string[];
  properties?: Record<string, string>;
  tags?: string[];
  deviceFamily?: string;
  vascularTerritory?: string;
  indicationsSummary?: string;
  availableDiametersMm?: number[];
  availableLengthsMm?: number[];
  compatibleSheathFr?: number[];
  workingLengthCm?: number[];
  wireCompatibilityInch?: number[];
  deliverySystem?: string;
  mriCompatibility?: string;
  radiopaqueMarkers?: string;
  sourceReference?: string;
  sourceUrl?: string;
  lastVerifiedAt?: string;
  notes?: string;
}

export interface DeviceCatalogImport {
  version: string;
  sourceName?: string;
  sourceDate?: string;
  devices: DeviceImportInput[];
}

export interface CatalogIssue {
  level: 'error' | 'warning';
  deviceIndex?: number;
  deviceName?: string;
  field?: string;
  message: string;
}

export interface CatalogValidationReport {
  ok: boolean;
  errors: CatalogIssue[];
  warnings: CatalogIssue[];
  total: number;
  toCreate: number;
  toUpdate: number;
  toSkip: number;
  duplicatesInFile: number;
}

export type CollisionStrategy = 'skip' | 'update' | 'new-copy';

export interface ImportSummary {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  failures: string[];
}

// --- parsing + validation --------------------------------------------------

export type ParseResult =
  | { kind: 'empty' }
  | { kind: 'invalid'; message: string }
  | { kind: 'parsed'; payload: DeviceCatalogImport };

export function parseCatalogText(text: string): ParseResult {
  if (!text.trim()) return { kind: 'empty' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { kind: 'invalid', message: e instanceof Error ? e.message : String(e) };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { kind: 'invalid', message: 'Top-level JSON must be an object.' };
  }
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.devices)) {
    return { kind: 'invalid', message: 'Missing "devices" array.' };
  }
  return {
    kind: 'parsed',
    payload: {
      version: typeof obj.version === 'string' ? obj.version : '',
      sourceName: typeof obj.sourceName === 'string' ? obj.sourceName : undefined,
      sourceDate: typeof obj.sourceDate === 'string' ? obj.sourceDate : undefined,
      devices: obj.devices as DeviceImportInput[],
    },
  };
}

function isValidNumberArray(value: unknown): { ok: boolean; reason?: string } {
  if (value === undefined || value === null) return { ok: true };
  if (!Array.isArray(value)) return { ok: false, reason: 'must be an array of numbers' };
  for (const n of value) {
    if (typeof n !== 'number' || !Number.isFinite(n)) {
      return { ok: false, reason: 'contains a non-numeric value' };
    }
    if (n <= 0) return { ok: false, reason: 'contains a zero or negative value' };
  }
  return { ok: true };
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value.trim());
}

function dupKey(d: { manufacturer: string; name: string; deviceFamily?: string }): string {
  return [d.manufacturer, d.name, d.deviceFamily ?? '']
    .map((s) => s.trim().toLowerCase())
    .join('|');
}

export function validateCatalog(
  payload: DeviceCatalogImport,
  existing: Device[],
  collision: CollisionStrategy,
): CatalogValidationReport {
  const errors: CatalogIssue[] = [];
  const warnings: CatalogIssue[] = [];

  if (payload.version !== DEVICE_IMPORT_VERSION) {
    warnings.push({
      level: 'warning',
      message: `Unrecognized version "${payload.version || '(none)'}" — expected "${DEVICE_IMPORT_VERSION}". Import will still be attempted.`,
    });
  }

  const existingKeys = new Set<string>();
  for (const d of existing) {
    existingKeys.add(dupKey({ manufacturer: d.manufacturer, name: d.name, deviceFamily: d.spec?.deviceFamily }));
  }

  const seenInFile = new Set<string>();
  let duplicatesInFile = 0;
  let toCreate = 0;
  let toUpdate = 0;
  let toSkip = 0;

  payload.devices.forEach((dev, index) => {
    const name = typeof dev.name === 'string' ? dev.name.trim() : '';
    const manufacturer = typeof dev.manufacturer === 'string' ? dev.manufacturer.trim() : '';
    const category = typeof dev.category === 'string' ? dev.category.trim() : '';
    const ref = { deviceIndex: index, deviceName: name || `device #${index + 1}` };

    if (!name) errors.push({ level: 'error', ...ref, field: 'name', message: 'name is required.' });
    if (!manufacturer) {
      errors.push({ level: 'error', ...ref, field: 'manufacturer', message: 'manufacturer is required.' });
    }
    if (!category) {
      errors.push({ level: 'error', ...ref, field: 'category', message: 'category is required.' });
    }

    for (const field of NUMERIC_SPEC_FIELDS) {
      const check = isValidNumberArray((dev as unknown as Record<string, unknown>)[field]);
      if (!check.ok) {
        errors.push({ level: 'error', ...ref, field: String(field), message: `${String(field)} ${check.reason}.` });
      }
    }

    if (dev.sourceUrl && !looksLikeUrl(dev.sourceUrl)) {
      warnings.push({ level: 'warning', ...ref, field: 'sourceUrl', message: 'sourceUrl does not look like a valid http(s) URL.' });
    }
    if (!dev.sourceReference && !dev.sourceUrl) {
      warnings.push({ level: 'warning', ...ref, message: 'No sourceReference/sourceUrl — device will be marked unverified.' });
    }
    if (!dev.lastVerifiedAt) {
      warnings.push({ level: 'warning', ...ref, message: 'No lastVerifiedAt — device will be marked unverified.' });
    }
    const hasSizing =
      (Array.isArray(dev.sizes) && dev.sizes.length > 0) ||
      NUMERIC_SPEC_FIELDS.some((f) => {
        const v = (dev as unknown as Record<string, unknown>)[f];
        return Array.isArray(v) && v.length > 0;
      });
    if (!hasSizing) {
      warnings.push({ level: 'warning', ...ref, message: 'No sizing data (sizes or numeric spec) — flagged as incomplete.' });
    }
    if (!dev.description || !dev.description.trim()) {
      warnings.push({ level: 'warning', ...ref, message: 'No description — a neutral label will be generated from name/manufacturer/category.' });
    }

    if (!name || !manufacturer || !category) return;

    const key = dupKey({ manufacturer, name, deviceFamily: dev.deviceFamily });
    if (seenInFile.has(key)) {
      duplicatesInFile += 1;
      warnings.push({ level: 'warning', ...ref, message: 'Duplicate of an earlier device in this file (same manufacturer + name + family).' });
    }
    seenInFile.add(key);

    const collides = existingKeys.has(key);
    if (collides && collision === 'skip') toSkip += 1;
    else if (collides && collision === 'update') toUpdate += 1;
    else toCreate += 1;
  });

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    total: payload.devices.length,
    toCreate,
    toUpdate,
    toSkip,
    duplicatesInFile,
  };
}

// --- import runner ---------------------------------------------------------

function toDeviceInput(dev: DeviceImportInput): DeviceInput {
  const name = dev.name.trim();
  const manufacturer = dev.manufacturer.trim();
  const category = dev.category.trim();
  const description =
    dev.description && dev.description.trim()
      ? dev.description.trim()
      : `${name} — ${manufacturer} ${category}`.trim();

  const spec: DeviceSpec = {};
  for (const field of TEXT_SPEC_FIELDS) {
    const v = (dev as unknown as Record<string, unknown>)[field];
    if (typeof v === 'string' && v.trim()) (spec as Record<string, unknown>)[field] = v.trim();
  }
  for (const field of NUMERIC_SPEC_FIELDS) {
    const v = (dev as unknown as Record<string, unknown>)[field];
    if (Array.isArray(v)) {
      const nums = v.filter(
        (n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0,
      );
      if (nums.length > 0) (spec as Record<string, unknown>)[field] = nums;
    }
  }

  const baseProperties: Record<string, unknown> = {};
  if (dev.properties && typeof dev.properties === 'object') {
    for (const [k, v] of Object.entries(dev.properties)) {
      if (k !== RESERVED_SPEC_KEY) baseProperties[k] = v;
    }
  }

  return {
    name,
    manufacturer,
    category,
    subtype: dev.subtype && String(dev.subtype).trim() ? String(dev.subtype).trim() : null,
    description,
    sizes: Array.isArray(dev.sizes) ? dev.sizes.map((s) => String(s).trim()).filter(Boolean) : [],
    properties: mergeSpecIntoProperties(baseProperties, spec),
    tags: Array.isArray(dev.tags) ? dev.tags.map((t) => String(t).trim()).filter(Boolean) : [],
  };
}

export async function runCatalogImport(
  payload: DeviceCatalogImport,
  existing: Device[],
  collision: CollisionStrategy,
): Promise<ImportSummary> {
  const existingMatch = new Map<string, Device>();
  for (const d of existing) {
    existingMatch.set(
      dupKey({ manufacturer: d.manufacturer, name: d.name, deviceFamily: d.spec?.deviceFamily }),
      d,
    );
  }

  const summary: ImportSummary = { created: 0, updated: 0, skipped: 0, failed: 0, failures: [] };

  for (const dev of payload.devices) {
    const name = typeof dev.name === 'string' ? dev.name.trim() : '';
    const manufacturer = typeof dev.manufacturer === 'string' ? dev.manufacturer.trim() : '';
    const category = typeof dev.category === 'string' ? dev.category.trim() : '';
    if (!name || !manufacturer || !category) {
      summary.failed += 1;
      summary.failures.push(`Skipped "${name || 'unnamed'}" — missing required field.`);
      continue;
    }
    const key = dupKey({ manufacturer, name, deviceFamily: dev.deviceFamily });
    const match = existingMatch.get(key);
    try {
      if (match && collision === 'skip') {
        summary.skipped += 1;
        continue;
      }
      if (match && collision === 'update') {
        await adminUpdateDevice(match.id, toDeviceInput(dev));
        summary.updated += 1;
        continue;
      }
      await adminCreateDevice(toDeviceInput(dev));
      summary.created += 1;
    } catch (e) {
      summary.failed += 1;
      summary.failures.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return summary;
}

// --- export ----------------------------------------------------------------

export function buildCatalogExport(
  devices: Device[],
  sourceName = 'VascEdu local device catalog',
): DeviceCatalogImport {
  return {
    version: DEVICE_IMPORT_VERSION,
    sourceName,
    sourceDate: new Date().toISOString().slice(0, 10),
    devices: devices.map((d) => {
      const out: DeviceImportInput = {
        name: d.name,
        manufacturer: d.manufacturer,
        category: d.category,
        subtype: d.subtype,
        description: d.description,
        sizes: d.sizes,
        properties: d.properties,
        tags: d.tags,
      };
      const s = d.spec;
      if (s) {
        for (const field of [...TEXT_SPEC_FIELDS, ...NUMERIC_SPEC_FIELDS]) {
          const v = s[field];
          if (v !== undefined) (out as unknown as Record<string, unknown>)[field as string] = v;
        }
      }
      return out;
    }),
  };
}
