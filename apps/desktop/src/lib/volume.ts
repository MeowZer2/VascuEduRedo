import { safeInvoke } from './tauri';

export interface VolumeInfo {
  id: string;
  sourcePath: string;
  dims: [number, number, number];
  spacing: [number, number, number];
  intensityRange: [number, number];
  axialSliceCount: number;
}

export interface SliceImage {
  handleId: string;
  plane: 'axial';
  sliceIndex: number;
  width: number;
  height: number;
  windowWidth: number;
  windowLevel: number;
  bytesBase64: string;
}

export async function loadVolume(path: string): Promise<VolumeInfo> {
  const result = await safeInvoke<VolumeInfo>('volume_load', { path });
  if (!result) {
    throw new Error('Tauri volume backend is not available. Run with pnpm dev, not pnpm dev:web.');
  }
  return result;
}

export async function loadAxialSlice(
  handleId: string,
  sliceIndex: number,
  windowWidth: number,
  windowLevel: number,
): Promise<SliceImage> {
  const result = await safeInvoke<SliceImage>('volume_slice_axial', {
    handleId,
    sliceIndex,
    windowWidth,
    windowLevel,
  });
  if (!result) {
    throw new Error('Tauri volume backend is not available. Run with pnpm dev, not pnpm dev:web.');
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
