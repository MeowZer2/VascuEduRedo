import { safeInvoke, TAURI_DESKTOP_REQUIRED_MESSAGE } from './tauri';

export type VolumePlane = 'axial' | 'coronal' | 'sagittal';

export interface SliceRange {
  min: number;
  max: number;
  count: number;
}

export type PlaneSliceRanges = Record<VolumePlane, SliceRange>;

export interface PlaneOrientationLabels {
  left: string;
  right: string;
  top: string;
  bottom: string;
}

export interface PlaneOrientationLabelSet {
  axial: PlaneOrientationLabels;
  coronal: PlaneOrientationLabels;
  sagittal: PlaneOrientationLabels;
}

export type VolumeOrientationStatus = 'trusted' | 'uncertain';

export interface VolumeOrientationInfo {
  /**
   * `trusted` means the file's metadata produced a clean RAS canonicalisation;
   * `uncertain` means we fell back to raw IJK (warnings explain why).
   */
  status: VolumeOrientationStatus;
  canonical: 'RAS';
  space: string | null;
  spaceOrigin: [number, number, number] | null;
  kinds: string[];
  /** 4x4 row-major IJK→RAS transform (RAS millimetres). */
  ijkToRas: [
    [number, number, number, number],
    [number, number, number, number],
    [number, number, number, number],
    [number, number, number, number],
  ];
  warnings: string[];
  planeLabels: PlaneOrientationLabelSet;
}

export interface VolumeInfo {
  handleId: string;
  sourcePath: string;
  dims: [number, number, number];
  spacing: [number, number, number];
  orientation: VolumeOrientationInfo;
  /** NRRD encoding string (e.g. "raw", "gzip", "ascii"). */
  encoding: string;
  /** NRRD voxel type as written in the file (e.g. "short", "int16"). */
  voxelType: string;
  intensityMin: number;
  intensityMax: number;
  planeSliceRanges: PlaneSliceRanges;
}

export interface DicomSeriesInfo {
  seriesInstanceUid: string;
  folderPath: string;
  seriesFolderPath: string | null;
  seriesDescription: string | null;
  modality: string | null;
  studyDescription: string | null;
  sliceCount: number;
  warnings: string[];
  unsupportedReason: string | null;
}

export interface DicomDiscoveryResult {
  folderPath: string;
  dicomFileCount: number;
  ignoredFileCount: number;
  series: DicomSeriesInfo[];
  warnings: string[];
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

export interface VolumeSample {
  handleId: string;
  plane: VolumePlane;
  sliceIndex: number;
  x: number;
  y: number;
  intensity: number;
}

export async function loadVolume(path: string): Promise<VolumeInfo> {
  const result = await safeInvoke<VolumeInfo>('volume_load', { path });
  if (!result) {
    throw new Error(TAURI_DESKTOP_REQUIRED_MESSAGE);
  }
  return result;
}

export async function discoverDicomFolder(folderPath: string): Promise<DicomDiscoveryResult> {
  const result = await safeInvoke<DicomDiscoveryResult>('dicom_discover_folder', { folderPath });
  if (!result) {
    throw new Error(TAURI_DESKTOP_REQUIRED_MESSAGE);
  }
  return result;
}

export async function loadDicomSeries(
  folderPath: string,
  seriesInstanceUid: string,
): Promise<VolumeInfo> {
  const result = await safeInvoke<VolumeInfo>('volume_load_dicom_series', {
    folderPath,
    seriesInstanceUid,
  });
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

export async function sampleVolume(
  handleId: string,
  plane: VolumePlane,
  sliceIndex: number,
  x: number,
  y: number,
): Promise<VolumeSample> {
  const result = await safeInvoke<VolumeSample>('volume_sample', {
    handleId,
    plane,
    sliceIndex,
    x,
    y,
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
