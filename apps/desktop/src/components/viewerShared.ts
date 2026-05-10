import type { VolumeInfo, VolumePlane } from '../lib/volume';

// ---------------------------------------------------------------------------
// Types shared by NrrdViewer (multi-viewport parent) and ViewportPane (single
// pane). Kept in their own module so the two components can import each other
// without circular references.
// ---------------------------------------------------------------------------

export type ViewerLayout = '1x1' | '1x2' | '1x3' | '2x2';
export type ViewerToolMode = 'scroll' | 'pan' | 'distance';

export interface ImagePoint {
  x: number;
  y: number;
}

export interface DisplayPoint {
  x: number;
  y: number;
}

export interface DistanceMeasurement {
  id: string;
  plane: VolumePlane;
  sliceIndex: number;
  start: ImagePoint;
  end: ImagePoint;
  distanceMm: number;
}

export interface ViewerMeasurement {
  id: string;
  plane: VolumePlane;
  sliceIndex: number;
  distanceMm: number;
}

export interface CrosshairVoxel {
  x: number;
  y: number;
  z: number;
}

export interface PlaneOption {
  value: VolumePlane;
  label: string;
}

export interface WindowPreset {
  label: string;
  width: number;
  level: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_WINDOW_WIDTH = 700;
export const DEFAULT_WINDOW_LEVEL = 200;
export const MIN_WINDOW_WIDTH = 1;
export const MAX_WINDOW_WIDTH = 4000;
export const MIN_WINDOW_LEVEL = -1200;
export const MAX_WINDOW_LEVEL = 1200;
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 8;
export const ZOOM_STEP = 1.25;

export const PLANE_OPTIONS: PlaneOption[] = [
  { value: 'axial', label: 'Axial' },
  { value: 'coronal', label: 'Coronal' },
  { value: 'sagittal', label: 'Sagittal' },
];

export const WINDOW_PRESETS: WindowPreset[] = [
  { label: 'Soft tissue', width: 400, level: 40 },
  { label: 'Lung', width: 1500, level: -600 },
  { label: 'Bone', width: 2000, level: 500 },
  { label: 'CTA', width: 700, level: 200 },
];

export const PANE_COUNT_BY_LAYOUT: Record<ViewerLayout, number> = {
  '1x1': 1,
  '1x2': 2,
  '1x3': 3,
  '2x2': 4,
};

export const DEFAULT_PANE_PLANES: Record<ViewerLayout, VolumePlane[]> = {
  '1x1': ['axial'],
  '1x2': ['axial', 'coronal'],
  '1x3': ['axial', 'coronal', 'sagittal'],
  // 4th panel duplicates axial so users can keep two zoom/scroll views of the
  // primary plane side by side. Each pane has its own plane selector to swap.
  '2x2': ['axial', 'coronal', 'sagittal', 'axial'],
};

// ---------------------------------------------------------------------------
// Math + plane helpers
// ---------------------------------------------------------------------------

export function midpoint(max: number): number {
  return Math.max(0, Math.floor((max - 1) / 2));
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * Coerce any number into a valid integer slice index for a plane with `count` slices.
 * Handles NaN/Infinity (→ 0), rounds floats, and clamps to [0, count-1].
 *
 * Use this every time a slice index is derived from sync/crosshair math (which
 * produces floats from per-pixel image coordinates) before:
 *   - calling `volume_slice` / `loadVolumeSlice` in Rust
 *   - storing the slice in pane state
 */
export function sanitizeSliceIndex(value: number, count: number): number {
  if (count <= 0) return 0;
  if (!Number.isFinite(value)) return 0;
  const max = count - 1;
  return Math.min(max, Math.max(0, Math.round(value)));
}

export function getSliceCount(volume: VolumeInfo, plane: VolumePlane): number {
  return volume.planeSliceRanges[plane].count;
}

export function getPlaneLabel(plane: VolumePlane): string {
  return PLANE_OPTIONS.find((option) => option.value === plane)?.label ?? plane;
}

export function getPlaneSpacing(
  spacing: [number, number, number],
  plane: VolumePlane,
): [number, number] {
  switch (plane) {
    case 'axial':
      return [spacing[0], spacing[1]];
    case 'coronal':
      return [spacing[0], spacing[2]];
    case 'sagittal':
      return [spacing[1], spacing[2]];
  }
}

export function distanceMm(
  start: ImagePoint,
  end: ImagePoint,
  spacing: [number, number],
): number {
  const deltaA = (end.x - start.x) * spacing[0];
  const deltaB = (end.y - start.y) * spacing[1];
  return Math.sqrt(deltaA * deltaA + deltaB * deltaB);
}

// ---------------------------------------------------------------------------
// Crosshair / voxel mapping (matches the Rust slicing convention in volume.rs)
// axial slice (s=z): image (x, y) → voxel (px, py, s)
// coronal slice (s=y): image (x, z) → voxel (px, s, py)
// sagittal slice (s=x): image (y, z) → voxel (s, px, py)
// ---------------------------------------------------------------------------

export interface PaneProjection {
  px: number;
  py: number;
  slice: number;
}

export function paneFromVoxel(voxel: CrosshairVoxel, plane: VolumePlane): PaneProjection {
  switch (plane) {
    case 'axial':
      return { px: voxel.x, py: voxel.y, slice: voxel.z };
    case 'coronal':
      return { px: voxel.x, py: voxel.z, slice: voxel.y };
    case 'sagittal':
      return { px: voxel.y, py: voxel.z, slice: voxel.x };
  }
}

/**
 * Build a crosshair voxel from a click on a plane. Inputs come from
 * `displayToImagePoint`, which produces sub-pixel floats — round to integers
 * here so the voxel stays in volume-coordinate (whole-voxel) space.
 */
export function voxelFromPane(
  _prev: CrosshairVoxel,
  plane: VolumePlane,
  px: number,
  py: number,
  slice: number,
): CrosshairVoxel {
  const ipx = Math.round(px);
  const ipy = Math.round(py);
  const isl = Math.round(slice);
  switch (plane) {
    case 'axial':
      return { x: ipx, y: ipy, z: isl };
    case 'coronal':
      return { x: ipx, y: isl, z: ipy };
    case 'sagittal':
      return { x: isl, y: ipx, z: ipy };
  }
}

export function voxelWithSlice(
  prev: CrosshairVoxel,
  plane: VolumePlane,
  slice: number,
): CrosshairVoxel {
  const isl = Math.round(slice);
  switch (plane) {
    case 'axial':
      return { ...prev, z: isl };
    case 'coronal':
      return { ...prev, y: isl };
    case 'sagittal':
      return { ...prev, x: isl };
  }
}

// ---------------------------------------------------------------------------
// Image fitting helpers (used by the per-pane canvas)
// ---------------------------------------------------------------------------

export interface ImageSize {
  width: number;
  height: number;
}

export interface FittedImageRect {
  left: number;
  top: number;
  width: number;
  height: number;
  scale: number;
}

export function fitImageToPanel(
  imageSize: ImageSize | null,
  panelSize: ImageSize,
  zoom: number,
  panOffset: DisplayPoint,
): FittedImageRect | null {
  if (
    !imageSize ||
    imageSize.width <= 0 ||
    imageSize.height <= 0 ||
    panelSize.width <= 0 ||
    panelSize.height <= 0
  ) {
    return null;
  }
  const scale =
    Math.min(panelSize.width / imageSize.width, panelSize.height / imageSize.height) * zoom;
  const width = imageSize.width * scale;
  const height = imageSize.height * scale;
  return {
    left: (panelSize.width - width) / 2 + panOffset.x,
    top: (panelSize.height - height) / 2 + panOffset.y,
    width,
    height,
    scale,
  };
}

export function imageToDisplayPoint(point: ImagePoint, fitRect: FittedImageRect): DisplayPoint {
  return {
    x: fitRect.left + point.x * fitRect.scale,
    y: fitRect.top + point.y * fitRect.scale,
  };
}

export function displayToImagePoint(
  point: DisplayPoint,
  imageSize: ImageSize,
  fitRect: FittedImageRect,
): ImagePoint | null {
  const localX = point.x - fitRect.left;
  const localY = point.y - fitRect.top;
  if (localX < 0 || localY < 0 || localX > fitRect.width || localY > fitRect.height) {
    return null;
  }
  return {
    x: clamp(localX / fitRect.scale, 0, imageSize.width),
    y: clamp(localY / fitRect.scale, 0, imageSize.height),
  };
}

export function clearCanvas(canvas: HTMLCanvasElement | null): void {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

export function makePaneId(): string {
  return `pane-${Math.random().toString(36).slice(2, 9)}-${Date.now().toString(36)}`;
}
