import { safeInvoke, TAURI_DESKTOP_REQUIRED_MESSAGE } from './tauri';

export type VolumePlane = 'axial' | 'coronal' | 'sagittal';

export interface SliceRange {
  min: number;
  max: number;
  count: number;
}

export type PlaneSliceRanges = Record<VolumePlane, SliceRange>;

export interface VolumeInfo {
  handleId: string;
  sourcePath: string;
  dims: [number, number, number];
  spacing: [number, number, number];
  intensityMin: number;
  intensityMax: number;
  planeSliceRanges: PlaneSliceRanges;
}

export interface SliceImage {
  handleId: string;
  plane: VolumePlane;
  sliceIndex: number;
  width: number;
  height: number;
  windowWidth: number;
  windowLevel: number;
  pixelsBase64: string;
}

export async function loadVolume(path: string): Promise<VolumeInfo> {
  const result = await safeInvoke<VolumeInfo>('volume_load', { path });
  if (!result) {
    throw new Error(TAURI_DESKTOP_REQUIRED_MESSAGE);
  }
  return result;
}

export async function loadVolumeSlice(
  handleId: string,
  plane: VolumePlane,
  sliceIndex: number,
  windowWidth: number,
  windowLevel: number,
): Promise<SliceImage> {
  const result = await safeInvoke<SliceImage>('volume_slice', {
    handleId,
    plane,
    sliceIndex,
    windowWidth,
    windowLevel,
  });
  if (!result) {
    throw new Error(TAURI_DESKTOP_REQUIRED_MESSAGE);
  }
  return result;
}

export async function releaseVolume(handleId: string): Promise<void> {
  await safeInvoke<boolean>('volume_release', { handleId });
}

export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = window.atob(base64);
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    output[index] = binary.charCodeAt(index);
  }
  return output;
}
