import { isTauriDesktop, safeInvoke } from './tauri';

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
}

export interface DeviceInput {
  name: string;
  manufacturer: string;
  category: string;
  subtype: string | null;
  description: string;
  sizes: string[];
  properties: Record<string, string>;
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

function asStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = String(v);
  }
  return out;
}

function fromWire(row: DeviceWire): Device {
  return {
    id: row.id,
    name: row.name,
    manufacturer: row.manufacturer,
    category: row.category,
    subtype: row.subtype,
    description: row.description,
    sizes: asStringArray(row.sizes),
    properties: asStringRecord(row.properties),
    tags: asStringArray(row.tags),
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
