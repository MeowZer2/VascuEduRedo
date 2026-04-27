import { useEffect, useMemo, useRef, useState } from 'react';
import { isTauriDesktop, TAURI_DESKTOP_REQUIRED_MESSAGE } from '../lib/tauri';
import {
  base64ToUint8Array,
  loadVolume,
  loadVolumeSlice,
  releaseVolume,
  type VolumeInfo,
  type VolumePlane,
} from '../lib/volume';

interface NrrdViewerProps {
  volumePath: string;
  description: string;
}

type ViewerStatus = 'browser' | 'loading' | 'ready' | 'error';

interface WindowPreset {
  label: string;
  width: number;
  level: number;
}

interface PlaneOption {
  value: VolumePlane;
  label: string;
}

interface ImageSize {
  width: number;
  height: number;
}

const DEFAULT_WINDOW_WIDTH = 700;
const DEFAULT_WINDOW_LEVEL = 200;
const MIN_WINDOW_WIDTH = 1;
const MAX_WINDOW_WIDTH = 4000;
const MIN_WINDOW_LEVEL = -1200;
const MAX_WINDOW_LEVEL = 1200;

const PLANE_OPTIONS: PlaneOption[] = [
  { value: 'axial', label: 'Axial' },
  { value: 'coronal', label: 'Coronal' },
  { value: 'sagittal', label: 'Sagittal' },
];

const WINDOW_PRESETS: WindowPreset[] = [
  { label: 'Soft tissue', width: 400, level: 40 },
  { label: 'Lung', width: 1500, level: -600 },
  { label: 'Bone', width: 2000, level: 500 },
  { label: 'CTA', width: 700, level: 200 },
];

function midpoint(max: number): number {
  return Math.max(0, Math.floor((max - 1) / 2));
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function clearCanvas(canvas: HTMLCanvasElement | null): void {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function getSliceCount(volume: VolumeInfo, plane: VolumePlane): number {
  return volume.planeSliceRanges[plane].count;
}

function getPlaneLabel(plane: VolumePlane): string {
  return PLANE_OPTIONS.find((option) => option.value === plane)?.label ?? plane;
}

export function NrrdViewer({ volumePath, description }: NrrdViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [volume, setVolume] = useState<VolumeInfo | null>(null);
  const [status, setStatus] = useState<ViewerStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [plane, setPlane] = useState<VolumePlane>('axial');
  const [slice, setSlice] = useState(0);
  const [imageSize, setImageSize] = useState<ImageSize | null>(null);
  const [windowWidth, setWindowWidth] = useState(DEFAULT_WINDOW_WIDTH);
  const [windowLevel, setWindowLevel] = useState(DEFAULT_WINDOW_LEVEL);

  useEffect(() => {
    let cancelled = false;
    let loadedHandle: string | null = null;

    clearCanvas(canvasRef.current);
    setError(null);
    setImageSize(null);
    setVolume(null);
    setPlane('axial');
    setSlice(0);

    if (!isTauriDesktop()) {
      setStatus('browser');
      setError(TAURI_DESKTOP_REQUIRED_MESSAGE);
      return;
    }

    setStatus('loading');

    loadVolume(volumePath)
      .then((info) => {
        if (cancelled) {
          void releaseVolume(info.handleId);
          return;
        }
        loadedHandle = info.handleId;
        setVolume(info);
        setPlane('axial');
        setSlice(midpoint(getSliceCount(info, 'axial')));
        setWindowWidth(DEFAULT_WINDOW_WIDTH);
        setWindowLevel(DEFAULT_WINDOW_LEVEL);
        setStatus('ready');
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setStatus('error');
        setError(caught instanceof Error ? caught.message : String(caught));
      });

    return () => {
      cancelled = true;
      if (loadedHandle) {
        void releaseVolume(loadedHandle);
      }
    };
  }, [volumePath]);

  const currentRange = volume?.planeSliceRanges[plane];
  const totalSlices = currentRange?.count ?? 0;
  const currentSliceIndex = currentRange ? clamp(slice, currentRange.min, currentRange.max) : 0;
  const planeLabel = getPlaneLabel(plane);

  useEffect(() => {
    if (!volume || status !== 'ready' || !currentRange) return;
    let cancelled = false;

    const safeSlice = clamp(slice, currentRange.min, currentRange.max);
    const safeWindowWidth = clamp(windowWidth, MIN_WINDOW_WIDTH, MAX_WINDOW_WIDTH);
    const safeWindowLevel = clamp(windowLevel, MIN_WINDOW_LEVEL, MAX_WINDOW_LEVEL);

    setImageSize(null);
    loadVolumeSlice(volume.handleId, plane, safeSlice, safeWindowWidth, safeWindowLevel)
      .then((image) => {
        if (cancelled) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const gray = base64ToUint8Array(image.pixelsBase64);
        if (gray.length !== image.width * image.height) {
          throw new Error(`${planeLabel} slice returned ${gray.length} pixels for ${image.width} x ${image.height}.`);
        }

        const rgba = ctx.createImageData(image.width, image.height);
        for (let index = 0; index < gray.length; index += 1) {
          const pixelOffset = index * 4;
          const value = gray[index];
          rgba.data[pixelOffset] = value;
          rgba.data[pixelOffset + 1] = value;
          rgba.data[pixelOffset + 2] = value;
          rgba.data[pixelOffset + 3] = 255;
        }
        ctx.putImageData(rgba, 0, 0);
        setImageSize({ width: image.width, height: image.height });
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setStatus('error');
        setError(caught instanceof Error ? caught.message : String(caught));
      });

    return () => {
      cancelled = true;
    };
  }, [volume, plane, slice, windowWidth, windowLevel, status, currentRange, planeLabel]);

  const metadata = useMemo(() => {
    if (!volume) return null;
    const [width, height, depth] = volume.dims;
    const [sx, sy, sz] = volume.spacing;
    return `${width} x ${height} x ${depth} voxels | ${sx.toFixed(2)} / ${sy.toFixed(2)} / ${sz.toFixed(2)} mm | intensity ${volume.intensityMin} to ${volume.intensityMax}`;
  }, [volume]);

  const sliceLabel = volume ? `${currentSliceIndex + 1} / ${totalSlices}` : '-';
  const imageSizeLabel = imageSize ? `${imageSize.width} x ${imageSize.height}` : '-';
  const controlsDisabled = !volume || status !== 'ready';

  function handlePlaneChange(nextPlane: VolumePlane) {
    setPlane(nextPlane);
    if (volume) {
      setSlice(midpoint(getSliceCount(volume, nextPlane)));
      setImageSize(null);
      if (status === 'error') {
        setStatus('ready');
        setError(null);
      }
    }
  }

  function setPreset(preset: WindowPreset) {
    setWindowWidth(preset.width);
    setWindowLevel(preset.level);
  }

  function resetView() {
    if (volume) {
      setSlice(midpoint(getSliceCount(volume, plane)));
    }
    setWindowWidth(DEFAULT_WINDOW_WIDTH);
    setWindowLevel(DEFAULT_WINDOW_LEVEL);
  }

  function setBoundedWindowWidth(value: number) {
    setWindowWidth(clamp(value, MIN_WINDOW_WIDTH, MAX_WINDOW_WIDTH));
  }

  function setBoundedWindowLevel(value: number) {
    setWindowLevel(clamp(value, MIN_WINDOW_LEVEL, MAX_WINDOW_LEVEL));
  }

  return (
    <section className="viewer-card">
      <div className="viewer-header">
        <div>
          <h3>NRRD MPR Viewer</h3>
          <p>{description}</p>
          {metadata ? <p className="viewer-metadata">{metadata}</p> : null}
        </div>
        <span className="pill">{planeLabel} / Real NRRD</span>
      </div>

      <div className="plane-tabs" role="group" aria-label="MPR plane">
        {PLANE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={option.value === plane ? 'plane-tab active' : 'plane-tab'}
            disabled={controlsDisabled}
            onClick={() => handlePlaneChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="canvas-wrap nrrd-canvas-wrap">
        {status === 'loading' ? <div className="viewer-state">Loading bundled NRRD volume through Rust...</div> : null}
        {status === 'browser' ? (
          <div className="viewer-state viewer-state-info">
            <strong>Desktop viewer required</strong>
            <span>{error ?? TAURI_DESKTOP_REQUIRED_MESSAGE}</span>
          </div>
        ) : null}
        {status === 'error' ? (
          <div className="viewer-state viewer-state-error">
            <strong>Unable to load NRRD volume</strong>
            <span>{error}</span>
          </div>
        ) : null}
        <canvas ref={canvasRef} aria-label={`${planeLabel} slice rendered from an NRRD volume`} />
        {volume && status === 'ready' ? (
          <div className="measurement-overlay">
            {planeLabel} {currentSliceIndex + 1}/{totalSlices} | {imageSizeLabel} | W {windowWidth} / L {windowLevel}
          </div>
        ) : null}
      </div>

      <div className="viewer-status-row" aria-live="polite">
        <span className={`viewer-status-dot ${status}`} />
        <span>
          {status === 'ready' && volume
            ? `Loaded ${volume.sourcePath}. ${planeLabel} slice ${sliceLabel}. Image ${imageSizeLabel}.`
            : null}
          {status === 'loading' ? 'Preparing volume metadata and MPR slice.' : null}
          {status === 'browser' ? TAURI_DESKTOP_REQUIRED_MESSAGE : null}
          {status === 'error' ? 'The viewer stopped before rendering the slice.' : null}
        </span>
      </div>

      <div className="viewer-controls">
        <label className="control-wide">
          <span className="control-label-row">
            <span>{planeLabel} slice</span>
            <strong>{sliceLabel}</strong>
          </span>
          <input
            type="range"
            min={currentRange?.min ?? 0}
            max={currentRange?.max ?? 0}
            value={currentSliceIndex}
            disabled={controlsDisabled}
            onChange={(event) => setSlice(Number(event.target.value))}
          />
        </label>
        <label>
          <span className="control-label-row">
            <span>Window width</span>
            <strong>{windowWidth}</strong>
          </span>
          <input
            type="range"
            min={MIN_WINDOW_WIDTH}
            max={MAX_WINDOW_WIDTH}
            step="10"
            value={windowWidth}
            disabled={controlsDisabled}
            onChange={(event) => setBoundedWindowWidth(Number(event.target.value))}
          />
          <input
            className="number-input"
            type="number"
            min={MIN_WINDOW_WIDTH}
            max={MAX_WINDOW_WIDTH}
            step="10"
            value={windowWidth}
            disabled={controlsDisabled}
            onChange={(event) => setBoundedWindowWidth(Number(event.target.value))}
          />
        </label>
        <label>
          <span className="control-label-row">
            <span>Window level</span>
            <strong>{windowLevel}</strong>
          </span>
          <input
            type="range"
            min={MIN_WINDOW_LEVEL}
            max={MAX_WINDOW_LEVEL}
            step="5"
            value={windowLevel}
            disabled={controlsDisabled}
            onChange={(event) => setBoundedWindowLevel(Number(event.target.value))}
          />
          <input
            className="number-input"
            type="number"
            min={MIN_WINDOW_LEVEL}
            max={MAX_WINDOW_LEVEL}
            step="5"
            value={windowLevel}
            disabled={controlsDisabled}
            onChange={(event) => setBoundedWindowLevel(Number(event.target.value))}
          />
        </label>
      </div>

      <div className="viewer-presets">
        {WINDOW_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className="secondary-button small"
            disabled={controlsDisabled}
            onClick={() => setPreset(preset)}
          >
            {preset.label}
          </button>
        ))}
        <button type="button" className="secondary-button small" disabled={controlsDisabled} onClick={resetView}>
          Reset view
        </button>
      </div>
    </section>
  );
}
