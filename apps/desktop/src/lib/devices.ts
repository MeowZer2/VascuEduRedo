import { isTauriDesktop, safeInvoke } from './tauri';

// Structured device spec. To stay fully backward compatible (no SQLite
// migration, no Rust change) the spec is carried inside the existing device
// `properties` JSON object under the reserved key below. Existing devices
// simply have no such key and a `spec` of `undefined`.
export const RESERVED_SPEC_KEY = '__deviceSpec';

export interface DeviceSpec {
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
  /** ISO date (YYYY-MM-DD) the spec was verified against a source / IFU. */
  lastVerifiedAt?: string;
  notes?: string;
}

export const NUMERIC_SPEC_FIELDS: Array<keyof DeviceSpec> = [
  'availableDiametersMm',
  'availableLengthsMm',
  'compatibleSheathFr',
  'workingLengthCm',
  'wireCompatibilityInch',
];

export const TEXT_SPEC_FIELDS: Array<keyof DeviceSpec> = [
  'deviceFamily',
  'vascularTerritory',
  'indicationsSummary',
  'deliverySystem',
  'mriCompatibility',
  'radiopaqueMarkers',
  'sourceReference',
  'sourceUrl',
  'lastVerifiedAt',
  'notes',
];

export interface Device {
  id: string;
  name: string;
  manufacturer: string;
  category: string;
  subtype: string | null;
  description: string;
  sizes: string[];
  properties: Record<string, string>;
  tags: string[];
  /** Parsed structured spec (undefined for legacy / unstructured devices). */
  spec?: DeviceSpec;
}

export interface DeviceInput {
  name: string;
  manufacturer: string;
  category: string;
  subtype: string | null;
  description: string;
  sizes: string[];
  /** May include the reserved spec key; values can be nested objects/arrays. */
  properties: Record<string, unknown>;
  tags: string[];
}

export interface DeviceFilter {
  category?: string;
  manufacturer?: string;
  search?: string;
}

/** Backend wire shape — Rust returns sizes/properties/tags as raw JSON values. */
interface DeviceWire {
  id: string;
  name: string;
  manufacturer: string;
  category: string;
  subtype: string | null;
  description: string;
  sizes: unknown;
  properties: unknown;
  tags: unknown;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function sanitizeSpec(raw: Record<string, unknown>): DeviceSpec {
  const spec: DeviceSpec = {};
  for (const field of TEXT_SPEC_FIELDS) {
    const v = raw[field];
    if (typeof v === 'string' && v.trim()) (spec as Record<string, unknown>)[field] = v.trim();
  }
  for (const field of NUMERIC_SPEC_FIELDS) {
    const v = raw[field];
    if (Array.isArray(v)) {
      const nums = v.filter(
        (n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0,
      );
      if (nums.length > 0) (spec as Record<string, unknown>)[field] = nums;
    }
  }
  return spec;
}

/** Split a raw properties object into display key/values and the typed spec. */
export function extractSpec(rawProperties: unknown): {
  spec: DeviceSpec | undefined;
  displayProperties: Record<string, string>;
} {
  const display: Record<string, string> = {};
  let spec: DeviceSpec | undefined;
  if (rawProperties && typeof rawProperties === 'object' && !Array.isArray(rawProperties)) {
    for (const [k, v] of Object.entries(rawProperties as Record<string, unknown>)) {
      if (k === RESERVED_SPEC_KEY) {
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          const parsed = sanitizeSpec(v as Record<string, unknown>);
          if (Object.keys(parsed).length > 0) spec = parsed;
        }
        continue;
      }
      if (typeof v === 'string') display[k] = v;
      else if (typeof v === 'number' || typeof v === 'boolean') display[k] = String(v);
    }
  }
  return { spec, displayProperties: display };
}

/** Re-attach a spec into a properties object under the reserved key. */
export function mergeSpecIntoProperties(
  properties: Record<string, unknown>,
  spec: DeviceSpec | undefined,
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(properties)) {
    if (k !== RESERVED_SPEC_KEY) next[k] = v;
  }
  if (spec && Object.keys(spec).length > 0) next[RESERVED_SPEC_KEY] = spec;
  return next;
}

export function isSizingIncomplete(device: Device): boolean {
  if (device.sizes.length > 0) return false;
  const s = device.spec;
  if (!s) return true;
  return !NUMERIC_SPEC_FIELDS.some((f) => Array.isArray(s[f]) && (s[f] as number[]).length > 0);
}

export function isVerified(device: Device): boolean {
  const s = device.spec;
  return !!(s && (s.sourceReference || s.sourceUrl) && s.lastVerifiedAt);
}

function fromWire(row: DeviceWire): Device {
  const { spec, displayProperties } = extractSpec(row.properties);
  return {
    id: row.id,
    name: row.name,
    manufacturer: row.manufacturer,
    category: row.category,
    subtype: row.subtype,
    description: row.description,
    sizes: asStringArray(row.sizes),
    properties: displayProperties,
    tags: asStringArray(row.tags),
    spec,
  };
}

export function isDeviceCatalogAvailable(): boolean {
  return isTauriDesktop();
}

export async function listDevices(filter?: DeviceFilter): Promise<Device[]> {
  if (!isTauriDesktop()) return [];
  try {
    const rows = await safeInvoke<DeviceWire[]>('list_devices', { filter: filter ?? null });
    return (rows ?? []).map(fromWire);
  } catch (error) {
    console.error('list_devices failed:', error);
    return [];
  }
}

export async function getDevice(deviceId: string): Promise<Device | null> {
  if (!isTauriDesktop()) return null;
  try {
    const row = await safeInvoke<DeviceWire | null>('get_device', { deviceId });
    return row ? fromWire(row) : null;
  } catch (error) {
    console.error('get_device failed:', error);
    return null;
  }
}

export async function listDeviceCategories(): Promise<string[]> {
  if (!isTauriDesktop()) return [];
  try {
    return (await safeInvoke<string[]>('list_device_categories')) ?? [];
  } catch (error) {
    console.error('list_device_categories failed:', error);
    return [];
  }
}

export async function adminCreateDevice(input: DeviceInput): Promise<Device> {
  if (!isTauriDesktop()) throw new Error('Device authoring requires desktop mode.');
  const row = await safeInvoke<DeviceWire>('admin_create_device', { input });
  if (!row) throw new Error('admin_create_device returned no row');
  return fromWire(row);
}

export async function adminUpdateDevice(
  deviceId: string,
  input: DeviceInput,
): Promise<Device> {
  if (!isTauriDesktop()) throw new Error('Device authoring requires desktop mode.');
  const row = await safeInvoke<DeviceWire>('admin_update_device', { deviceId, input });
  if (!row) throw new Error('admin_update_device returned no row');
  return fromWire(row);
}

export async function adminDeleteDevice(deviceId: string): Promise<void> {
  if (!isTauriDesktop()) throw new Error('Device authoring requires desktop mode.');
  await safeInvoke<void>('admin_delete_device', { deviceId });
}
