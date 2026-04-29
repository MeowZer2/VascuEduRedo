import { type PointerEvent, type WheelEvent, useEffect, useMemo, useRef, useState } from 'react';
import { isTauriDesktop, TAURI_DESKTOP_REQUIRED_MESSAGE } from '../lib/tauri';
import {
  base64ToUint8Array,
  loadVolume,
  loadVolumeSlice,
  releaseVolume,
  sampleVolume,
  type VolumeInfo,
  type VolumePlane,
} from '../lib/volume';

export interface ViewerMeasurement {
  id: string;
  plane: VolumePlane;
  sliceIndex: number;
  distanceMm: number;
}

interface NrrdViewerProps {
  volumePath: string;
  description: string;
  /** Suggest a tool mode (e.g. 'distance' when a measurement question is active). */
  requestedTool?: ViewerToolMode;
  /** Called whenever the most recently completed measurement changes or is cleared. */
  onLatestMeasurementChange?: (measurement: ViewerMeasurement | null) => void;
}

type ViewerStatus = 'browser' | 'loading' | 'ready' | 'error';
type ViewerToolMode = 'scroll' | 'pan' | 'distance';

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

interface SlicePixels extends ImageSize {
  pixels: Uint8Array;
}

interface ImagePoint {
  x: number;
  y: number;
}

interface DisplayPoint {
  x: number;
  y: number;
}

interface FittedImageRect {
  left: number;
  top: number;
  width: number;
  height: number;
  scale: number;
}

interface PanDragState {
  pointerId: number;
  start: DisplayPoint;
  panStart: DisplayPoint;
}

interface HuReadout {
  x: number;
  y: number;
  intensity: number;
}

interface DistanceMeasurement {
  id: string;
  plane: VolumePlane;
  sliceIndex: number;
  start: ImagePoint;
  end: ImagePoint;
  distanceMm: number;
}

const DEFAULT_WINDOW_WIDTH = 700;
const DEFAULT_WINDOW_LEVEL = 200;
const MIN_WINDOW_WIDTH = 1;
const MAX_WINDOW_WIDTH = 4000;
const MIN_WINDOW_LEVEL = -1200;
const MAX_WINDOW_LEVEL = 1200;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 8;
const ZOOM_STEP = 1.25;

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

function getPlaneSpacing(spacing: [number, number, number], plane: VolumePlane): [number, number] {
  switch (plane) {
    case 'axial':
      return [spacing[0], spacing[1]];
    case 'coronal':
      return [spacing[0], spacing[2]];
    case 'sagittal':
      return [spacing[1], spacing[2]];
  }
}

function distanceMm(start: ImagePoint, end: ImagePoint, spacing: [number, number]): number {
  const deltaA = (end.x - start.x) * spacing[0];
  const deltaB = (end.y - start.y) * spacing[1];
  return Math.sqrt(deltaA * deltaA + deltaB * deltaB);
}

function fitImageToPanel(
  imageSize: ImageSize | null,
  panelSize: ImageSize,
  zoom: number,
  panOffset: DisplayPoint,
): FittedImageRect | null {
  if (!imageSize || imageSize.width <= 0 || imageSize.height <= 0 || panelSize.width <= 0 || panelSize.height <= 0) {
    return null;
  }

  const scale = Math.min(panelSize.width / imageSize.width, panelSize.height / imageSize.height) * zoom;
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

function imageToDisplayPoint(point: ImagePoint, fitRect: FittedImageRect): DisplayPoint {
  return {
    x: fitRect.left + point.x * fitRect.scale,
    y: fitRect.top + point.y * fitRect.scale,
  };
}

function displayToImagePoint(point: DisplayPoint, imageSize: ImageSize, fitRect: FittedImageRect): ImagePoint | null {
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

export function NrrdViewer({ volumePath, description, requestedTool, onLatestMeasurementChange }: NrrdViewerProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const measurementCounterRef = useRef(0);
  const [volume, setVolume] = useState<VolumeInfo | null>(null);
  const [status, setStatus] = useState<ViewerStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [plane, setPlane] = useState<VolumePlane>('axial');
  const [toolMode, setToolMode] = useState<ViewerToolMode>('scroll');
  const [slice, setSlice] = useState(0);
  const [imageSize, setImageSize] = useState<ImageSize | null>(null);
  const [slicePixels, setSlicePixels] = useState<SlicePixels | null>(null);
  const [panelSize, setPanelSize] = useState<ImageSize>({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState<DisplayPoint>({ x: 0, y: 0 });
  const [panDrag, setPanDrag] = useState<PanDragState | null>(null);
  const [hoverPoint, setHoverPoint] = useState<ImagePoint | null>(null);
  const [huReadout, setHuReadout] = useState<HuReadout | null>(null);
  const [pendingPoint, setPendingPoint] = useState<ImagePoint | null>(null);
  const [measurements, setMeasurements] = useState<DistanceMeasurement[]>([]);
  const [windowWidth, setWindowWidth] = useState(DEFAULT_WINDOW_WIDTH);
  const [windowLevel, setWindowLevel] = useState(DEFAULT_WINDOW_LEVEL);
  const onLatestMeasurementChangeRef = useRef(onLatestMeasurementChange);
  onLatestMeasurementChangeRef.current = onLatestMeasurementChange;

  useEffect(() => {
    let cancelled = false;
    let loadedHandle: string | null = null;

    clearCanvas(canvasRef.current);
    setError(null);
    setImageSize(null);
    setSlicePixels(null);
    setVolume(null);
    setPlane('axial');
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
    setPanDrag(null);
    setHoverPoint(null);
    setHuReadout(null);
    setPendingPoint(null);
    setMeasurements([]);
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
  const fitRect = useMemo(() => fitImageToPanel(imageSize, panelSize, zoom, panOffset), [imageSize, panelSize, zoom, panOffset]);

  useEffect(() => {
    const observedPanel = panelRef.current;
    if (!observedPanel) return;
    const panel = observedPanel;

    function updatePanelSize() {
      setPanelSize((current) => {
        const next = { width: panel.clientWidth, height: panel.clientHeight };
        if (current.width === next.width && current.height === next.height) {
          return current;
        }
        return next;
      });
    }

    updatePanelSize();
    const observer = new ResizeObserver(updatePanelSize);
    observer.observe(panel);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setPendingPoint(null);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    setPendingPoint(null);
  }, [plane, currentSliceIndex, toolMode]);

  useEffect(() => {
    setHoverPoint(null);
    setHuReadout(null);
    setPanDrag(null);
  }, [plane, currentSliceIndex]);

  // Apply a suggested tool mode from the parent (e.g. when a measurement question is active).
  useEffect(() => {
    if (requestedTool && status === 'ready') {
      setToolMode(requestedTool);
    }
  }, [requestedTool, status]);

  // Notify parent whenever the set of measurements changes so it can track the latest one.
  useEffect(() => {
    const cb = onLatestMeasurementChangeRef.current;
    if (!cb) return;
    if (measurements.length === 0) {
      cb(null);
    } else {
      const last = measurements[measurements.length - 1];
      cb({ id: last.id, plane: last.plane, sliceIndex: last.sliceIndex, distanceMm: last.distanceMm });
    }
  }, [measurements]);

  useEffect(() => {
    if (!volume || status !== 'ready' || !currentRange) return;
    let cancelled = false;

    const safeSlice = clamp(slice, currentRange.min, currentRange.max);
    const safeWindowWidth = clamp(windowWidth, MIN_WINDOW_WIDTH, MAX_WINDOW_WIDTH);
    const safeWindowLevel = clamp(windowLevel, MIN_WINDOW_LEVEL, MAX_WINDOW_LEVEL);

    setImageSize(null);
    setSlicePixels(null);
    clearCanvas(canvasRef.current);
    loadVolumeSlice(volume.handleId, plane, safeSlice, safeWindowWidth, safeWindowLevel)
      .then((image) => {
        if (cancelled) return;
        const gray = base64ToUint8Array(image.pixelsBase64);
        if (gray.length !== image.width * image.height) {
          throw new Error(`${planeLabel} slice returned ${gray.length} pixels for ${image.width} x ${image.height}.`);
        }

        setImageSize({ width: image.width, height: image.height });
        setSlicePixels({ width: image.width, height: image.height, pixels: gray });
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !slicePixels || !fitRect) return;

    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(fitRect.width * dpr));
    canvas.height = Math.max(1, Math.round(fitRect.height * dpr));

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rawCanvas = document.createElement('canvas');
    rawCanvas.width = slicePixels.width;
    rawCanvas.height = slicePixels.height;
    const rawCtx = rawCanvas.getContext('2d');
    if (!rawCtx) return;

    const rgba = rawCtx.createImageData(slicePixels.width, slicePixels.height);
    for (let index = 0; index < slicePixels.pixels.length; index += 1) {
      const pixelOffset = index * 4;
      const value = slicePixels.pixels[index];
      rgba.data[pixelOffset] = value;
      rgba.data[pixelOffset + 1] = value;
      rgba.data[pixelOffset + 2] = value;
      rgba.data[pixelOffset + 3] = 255;
    }
    rawCtx.putImageData(rgba, 0, 0);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, fitRect.width, fitRect.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(rawCanvas, 0, 0, slicePixels.width, slicePixels.height, 0, 0, fitRect.width, fitRect.height);
  }, [fitRect, slicePixels]);

  useEffect(() => {
    if (!volume || !hoverPoint || !imageSize || status !== 'ready') {
      setHuReadout(null);
      return;
    }

    const sampleX = Math.floor(clamp(hoverPoint.x, 0, imageSize.width - 1));
    const sampleY = Math.floor(clamp(hoverPoint.y, 0, imageSize.height - 1));
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      sampleVolume(volume.handleId, plane, currentSliceIndex, sampleX, sampleY)
        .then((sample) => {
          if (cancelled) return;
          setHuReadout({ x: sample.x, y: sample.y, intensity: sample.intensity });
        })
        .catch(() => {
          if (cancelled) return;
          setHuReadout(null);
        });
    }, 75);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [currentSliceIndex, hoverPoint, imageSize, plane, status, volume]);

  const metadata = useMemo(() => {
    if (!volume) return null;
    const [width, height, depth] = volume.dims;
    const [sx, sy, sz] = volume.spacing;
    return `${width} x ${height} x ${depth} voxels | ${sx.toFixed(2)} / ${sy.toFixed(2)} / ${sz.toFixed(2)} mm | intensity ${volume.intensityMin} to ${volume.intensityMax}`;
  }, [volume]);

  const sliceLabel = volume ? `${currentSliceIndex + 1} / ${totalSlices}` : '-';
  const imageSizeLabel = imageSize ? `${imageSize.width} x ${imageSize.height}` : '-';
  const controlsDisabled = !volume || status !== 'ready';
  const visibleMeasurements = useMemo(
    () => measurements.filter((measurement) => measurement.plane === plane && measurement.sliceIndex === currentSliceIndex),
    [measurements, plane, currentSliceIndex],
  );

  function handlePlaneChange(nextPlane: VolumePlane) {
    setPlane(nextPlane);
    if (volume) {
      setSlice(midpoint(getSliceCount(volume, nextPlane)));
      setImageSize(null);
      setZoom(1);
      setPanOffset({ x: 0, y: 0 });
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
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
    setPanDrag(null);
    setPendingPoint(null);
    setWindowWidth(DEFAULT_WINDOW_WIDTH);
    setWindowLevel(DEFAULT_WINDOW_LEVEL);
  }

  function setBoundedWindowWidth(value: number) {
    setWindowWidth(clamp(value, MIN_WINDOW_WIDTH, MAX_WINDOW_WIDTH));
  }

  function setBoundedWindowLevel(value: number) {
    setWindowLevel(clamp(value, MIN_WINDOW_LEVEL, MAX_WINDOW_LEVEL));
  }

  function setBoundedZoom(value: number) {
    const nextZoom = clamp(value, MIN_ZOOM, MAX_ZOOM);
    setZoom(nextZoom);
    if (nextZoom <= 1) {
      setPanOffset({ x: 0, y: 0 });
    }
  }

  function zoomBy(factor: number) {
    setBoundedZoom(zoom * factor);
  }

  function displayPointFromPointer(event: PointerEvent<HTMLDivElement>): DisplayPoint | null {
    const panel = panelRef.current;
    if (!panel) return null;

    const rect = panel.getBoundingClientRect();
    return {
      x: event.clientX - rect.left - panel.clientLeft,
      y: event.clientY - rect.top - panel.clientTop,
    };
  }

  function imagePointFromPointer(event: PointerEvent<HTMLDivElement>): ImagePoint | null {
    const displayPoint = displayPointFromPointer(event);
    if (!displayPoint || !imageSize || !fitRect) return null;

    return displayToImagePoint(displayPoint, imageSize, fitRect);
  }

  function handleCanvasPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!volume || controlsDisabled) return;

    const canStartPan = zoom > 1 && ((toolMode === 'pan' && event.button === 0) || event.button === 1 || event.button === 2);
    if (canStartPan) {
      const start = displayPointFromPointer(event);
      if (!start) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setPanDrag({ pointerId: event.pointerId, start, panStart: panOffset });
      setHoverPoint(null);
      setHuReadout(null);
      return;
    }

    if (event.button !== 0 || toolMode !== 'distance') return;
    const nextPoint = imagePointFromPointer(event);
    if (!nextPoint) return;

    event.preventDefault();
    if (!pendingPoint) {
      setPendingPoint(nextPoint);
      return;
    }

    const spacing = getPlaneSpacing(volume.spacing, plane);
    measurementCounterRef.current += 1;
    const measurement: DistanceMeasurement = {
      id: `measurement-${measurementCounterRef.current}`,
      plane,
      sliceIndex: currentSliceIndex,
      start: pendingPoint,
      end: nextPoint,
      distanceMm: distanceMm(pendingPoint, nextPoint, spacing),
    };

    setMeasurements((current) => [...current, measurement]);
    setPendingPoint(null);
  }

  function handleCanvasPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (panDrag) {
      const point = displayPointFromPointer(event);
      if (!point) return;
      event.preventDefault();
      setPanOffset({
        x: panDrag.panStart.x + point.x - panDrag.start.x,
        y: panDrag.panStart.y + point.y - panDrag.start.y,
      });
      return;
    }

    setHoverPoint(imagePointFromPointer(event));
  }

  function endPanDrag(event: PointerEvent<HTMLDivElement>) {
    if (panDrag?.pointerId === event.pointerId) {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setPanDrag(null);
    }
  }

  function handleCanvasPointerLeave() {
    if (!panDrag) {
      setHoverPoint(null);
      setHuReadout(null);
    }
  }

  function handleCanvasWheel(event: WheelEvent<HTMLDivElement>) {
    if (controlsDisabled || !currentRange || event.deltaY === 0) return;

    event.preventDefault();
    if (event.ctrlKey) {
      zoomBy(event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
      return;
    }

    const step = event.deltaY > 0 ? 1 : -1;
    setSlice((current) => clamp(current + step, currentRange.min, currentRange.max));
  }

  function clearCurrentMeasurements() {
    setMeasurements((current) =>
      current.filter((measurement) => measurement.plane !== plane || measurement.sliceIndex !== currentSliceIndex),
    );
    setPendingPoint(null);
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

      <div className="viewer-tool-row">
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
        <div className="tool-tabs" role="group" aria-label="Viewer tool">
          <button
            type="button"
            className={toolMode === 'scroll' ? 'tool-tab active' : 'tool-tab'}
            disabled={controlsDisabled}
            onClick={() => setToolMode('scroll')}
          >
            Scroll
          </button>
          <button
            type="button"
            className={toolMode === 'pan' ? 'tool-tab active' : 'tool-tab'}
            disabled={controlsDisabled}
            onClick={() => setToolMode('pan')}
          >
            Pan
          </button>
          <button
            type="button"
            className={toolMode === 'distance' ? 'tool-tab active' : 'tool-tab'}
            disabled={controlsDisabled}
            onClick={() => setToolMode('distance')}
          >
            Distance
          </button>
        </div>
        <div className="zoom-tools" aria-label="Zoom controls">
          <button type="button" className="tool-tab" disabled={controlsDisabled} onClick={() => zoomBy(1 / ZOOM_STEP)}>
            Zoom -
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" className="tool-tab" disabled={controlsDisabled} onClick={() => zoomBy(ZOOM_STEP)}>
            Zoom +
          </button>
        </div>
        <button type="button" className="secondary-button small" disabled={controlsDisabled} onClick={resetView}>
          Reset view
        </button>
        <button
          type="button"
          className="secondary-button small"
          disabled={controlsDisabled || visibleMeasurements.length === 0}
          onClick={clearCurrentMeasurements}
        >
          Clear measurements
        </button>
      </div>
      {toolMode === 'distance' ? <p className="viewer-instruction">Click two points to measure distance.</p> : null}

      <div
        ref={panelRef}
        className={`canvas-wrap nrrd-canvas-wrap ${toolMode === 'distance' ? 'measuring' : ''} ${toolMode === 'pan' ? 'panning' : ''}`}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={endPanDrag}
        onPointerCancel={endPanDrag}
        onPointerLeave={handleCanvasPointerLeave}
        onWheel={handleCanvasWheel}
        onContextMenu={(event) => event.preventDefault()}
      >
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
        <canvas
          ref={canvasRef}
          aria-label={`${planeLabel} slice rendered from an NRRD volume`}
          style={
            fitRect
              ? {
                  left: `${fitRect.left}px`,
                  top: `${fitRect.top}px`,
                  width: `${fitRect.width}px`,
                  height: `${fitRect.height}px`,
                }
              : { display: 'none' }
          }
        />
        {imageSize && fitRect && panelSize.width > 0 && panelSize.height > 0 ? (
            <svg className="measurement-svg" viewBox={`0 0 ${panelSize.width} ${panelSize.height}`} aria-hidden="true">
              {visibleMeasurements.map((measurement, idx) => {
                const isLatest = idx === visibleMeasurements.length - 1 && measurements[measurements.length - 1]?.id === measurement.id;
                const label = `${measurement.distanceMm.toFixed(1)} mm`;
                const start = imageToDisplayPoint(measurement.start, fitRect);
                const end = imageToDisplayPoint(measurement.end, fitRect);
                const labelX = clamp((start.x + end.x) / 2, 18, panelSize.width - 18);
                const labelY = clamp((start.y + end.y) / 2 - 10, 18, panelSize.height - 18);
                return (
                  <g key={measurement.id}>
                    <line
                      x1={start.x}
                      y1={start.y}
                      x2={end.x}
                      y2={end.y}
                      className={isLatest ? 'measurement-line measurement-line-selected' : 'measurement-line'}
                      vectorEffect="non-scaling-stroke"
                    />
                    <circle cx={start.x} cy={start.y} r="4.5" className="measurement-point" />
                    <circle cx={end.x} cy={end.y} r="4.5" className="measurement-point" />
                    <text x={labelX} y={labelY} className="measurement-label" textAnchor="middle">
                      {label}
                    </text>
                  </g>
                );
              })}
              {pendingPoint ? (
                <circle
                  cx={imageToDisplayPoint(pendingPoint, fitRect).x}
                  cy={imageToDisplayPoint(pendingPoint, fitRect).y}
                  r="5"
                  className="measurement-pending"
                />
              ) : null}
            </svg>
        ) : null}
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
      <div className="viewer-readout">
        {huReadout ? (
          <span>
            {planeLabel} {currentSliceIndex + 1}/{totalSlices} | pixel {huReadout.x}, {huReadout.y} | intensity {huReadout.intensity}
          </span>
        ) : (
          <span>Hover over the image for pixel intensity.</span>
        )}
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
      </div>
    </section>
  );
}
