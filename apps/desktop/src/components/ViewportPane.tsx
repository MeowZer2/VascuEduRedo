import { type PointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  base64ToUint8Array,
  loadVolumeSlice,
  sampleVolume,
  type VolumeInfo,
  type VolumePlane,
} from '../lib/volume';
import {
  PLANE_OPTIONS,
  ZOOM_STEP,
  clamp,
  clearCanvas,
  displayToImagePoint,
  distanceMm,
  fitImageToPanel,
  getPlaneLabel,
  getPlaneSpacing,
  imageToDisplayPoint,
  paneFromVoxel,
  sanitizeSliceIndex,
  type CrosshairVoxel,
  type DisplayPoint,
  type DistanceMeasurement,
  type ImagePoint,
  type ImageSize,
  type ViewerToolMode,
} from './viewerShared';

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

interface SlicePixels extends ImageSize {
  pixels: Uint8Array;
}

export interface PaneSnapshot {
  id: string;
  plane: VolumePlane;
  slice: number;
  ww: number;
  wl: number;
  zoom: number;
  pan: DisplayPoint;
  measurements: DistanceMeasurement[];
  pendingPoint: ImagePoint | null;
}

export interface ViewportPaneProps {
  volume: VolumeInfo;
  pane: PaneSnapshot;
  index: number;
  toolMode: ViewerToolMode;
  /** Crosshair in volume voxel coordinates (or null when not yet set). */
  crosshairVoxel: CrosshairVoxel | null;
  /** Whether this pane is the "primary" — driven by the parent toolbar's WL slider. */
  active: boolean;
  /** Whether to draw the crosshair overlay on this pane. */
  showCrosshair: boolean;
  isLatestMeasurementOwner: boolean;
  latestMeasurementId: string | null;
  onActivate: () => void;
  onPlaneChange: (plane: VolumePlane) => void;
  onSliceChange: (slice: number) => void;
  onZoomChange: (zoom: number) => void;
  onPanChange: (pan: DisplayPoint) => void;
  onCrosshairFromPane: (imagePoint: ImagePoint) => void;
  onPendingPointChange: (point: ImagePoint | null) => void;
  onAddMeasurement: (measurement: DistanceMeasurement) => void;
  onClearMeasurements: () => void;
}

/**
 * Single MPR viewport pane. Owns its canvas, slice request, hover/HU readout, and
 * pointer handlers. The parent (`NrrdViewer`) owns volume state, sync flags, and
 * the crosshair voxel and decides which sibling panes to update on each event.
 */
export function ViewportPane({
  volume,
  pane,
  index,
  toolMode,
  crosshairVoxel,
  active,
  showCrosshair,
  isLatestMeasurementOwner,
  latestMeasurementId,
  onActivate,
  onPlaneChange,
  onSliceChange,
  onZoomChange,
  onPanChange,
  onCrosshairFromPane,
  onPendingPointChange,
  onAddMeasurement,
  onClearMeasurements,
}: ViewportPaneProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const measurementCounterRef = useRef(0);
  const [imageSize, setImageSize] = useState<ImageSize | null>(null);
  const [slicePixels, setSlicePixels] = useState<SlicePixels | null>(null);
  const [panelSize, setPanelSize] = useState<ImageSize>({ width: 0, height: 0 });
  const [panDrag, setPanDrag] = useState<PanDragState | null>(null);
  const [hoverPoint, setHoverPoint] = useState<ImagePoint | null>(null);
  const [huReadout, setHuReadout] = useState<HuReadout | null>(null);
  const [error, setError] = useState<string | null>(null);

  const range = volume.planeSliceRanges[pane.plane];
  const totalSlices = range.count;
  // Always coerce to a valid integer before sending to Rust — sync/crosshair math
  // can produce floats from per-pixel image coordinates.
  const sliceIndex = sanitizeSliceIndex(pane.slice, range.count);
  const planeLabel = getPlaneLabel(pane.plane);

  const fitRect = useMemo(
    () => fitImageToPanel(imageSize, panelSize, pane.zoom, pane.pan),
    [imageSize, panelSize, pane.zoom, pane.pan],
  );

  // Track pane size with ResizeObserver so the canvas refits on layout changes.
  useEffect(() => {
    const observed = panelRef.current;
    if (!observed) return;
    function update() {
      if (!observed) return;
      setPanelSize((current) => {
        const next = { width: observed.clientWidth, height: observed.clientHeight };
        if (current.width === next.width && current.height === next.height) return current;
        return next;
      });
    }
    update();
    const observer = new ResizeObserver(update);
    observer.observe(observed);
    return () => observer.disconnect();
  }, []);

  // Reset hover/pan-drag whenever the displayed slice or plane changes.
  useEffect(() => {
    setHoverPoint(null);
    setHuReadout(null);
    setPanDrag(null);
  }, [pane.plane, sliceIndex]);

  // Slice load: every time the displayed (plane, slice, ww, wl) changes, request a fresh slice.
  useEffect(() => {
    let cancelled = false;
    setImageSize(null);
    setSlicePixels(null);
    clearCanvas(canvasRef.current);
    setError(null);

    loadVolumeSlice(volume.handleId, pane.plane, sliceIndex, pane.ww, pane.wl)
      .then((image) => {
        if (cancelled) return;
        const gray = base64ToUint8Array(image.pixelsBase64);
        if (gray.length !== image.width * image.height) {
          throw new Error(
            `${planeLabel} slice returned ${gray.length} pixels for ${image.width} x ${image.height}.`,
          );
        }
        setImageSize({ width: image.width, height: image.height });
        setSlicePixels({ width: image.width, height: image.height, pixels: gray });
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : String(caught));
      });
    return () => {
      cancelled = true;
    };
  }, [volume.handleId, pane.plane, sliceIndex, pane.ww, pane.wl, planeLabel]);

  // Render the slice into the (DPR-scaled) canvas whenever pixels or fit change.
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
    for (let i = 0; i < slicePixels.pixels.length; i += 1) {
      const offset = i * 4;
      const value = slicePixels.pixels[i];
      rgba.data[offset] = value;
      rgba.data[offset + 1] = value;
      rgba.data[offset + 2] = value;
      rgba.data[offset + 3] = 255;
    }
    rawCtx.putImageData(rgba, 0, 0);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, fitRect.width, fitRect.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      rawCanvas,
      0,
      0,
      slicePixels.width,
      slicePixels.height,
      0,
      0,
      fitRect.width,
      fitRect.height,
    );
  }, [fitRect, slicePixels]);

  // HU sample (debounced) when the user hovers a pixel.
  useEffect(() => {
    if (!hoverPoint || !imageSize) {
      setHuReadout(null);
      return;
    }
    let cancelled = false;
    const sampleX = Math.floor(clamp(hoverPoint.x, 0, imageSize.width - 1));
    const sampleY = Math.floor(clamp(hoverPoint.y, 0, imageSize.height - 1));
    const timer = window.setTimeout(() => {
      sampleVolume(volume.handleId, pane.plane, sliceIndex, sampleX, sampleY)
        .then((sample) => {
          if (!cancelled) setHuReadout({ x: sample.x, y: sample.y, intensity: sample.intensity });
        })
        .catch(() => {
          if (!cancelled) setHuReadout(null);
        });
    }, 75);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [hoverPoint, imageSize, volume.handleId, pane.plane, sliceIndex]);

  const visibleMeasurements = useMemo(
    () =>
      pane.measurements.filter(
        (m) => m.plane === pane.plane && m.sliceIndex === sliceIndex,
      ),
    [pane.measurements, pane.plane, sliceIndex],
  );

  // Crosshair overlay: project the current voxel into this pane's plane.
  // Only treat it as "on slice" (drawn solid) when the projected slice matches our slice.
  const crosshairOverlay = useMemo(() => {
    if (!showCrosshair || !crosshairVoxel || !imageSize || !fitRect) return null;
    const projection = paneFromVoxel(crosshairVoxel, pane.plane);
    const display = imageToDisplayPoint(
      {
        x: clamp(projection.px, 0, imageSize.width),
        y: clamp(projection.py, 0, imageSize.height),
      },
      fitRect,
    );
    return {
      display,
      onSlice: Math.round(projection.slice) === sliceIndex,
    };
  }, [showCrosshair, crosshairVoxel, imageSize, fitRect, pane.plane, sliceIndex]);

  // ---- pointer / wheel handling ----------------------------------------------------

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
    const display = displayPointFromPointer(event);
    if (!display || !imageSize || !fitRect) return null;
    return displayToImagePoint(display, imageSize, fitRect);
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    onActivate();
    const canStartPan =
      pane.zoom > 1 &&
      ((toolMode === 'pan' && event.button === 0) || event.button === 1 || event.button === 2);
    if (canStartPan) {
      const start = displayPointFromPointer(event);
      if (!start) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setPanDrag({ pointerId: event.pointerId, start, panStart: pane.pan });
      setHoverPoint(null);
      setHuReadout(null);
      return;
    }
    if (event.button !== 0) return;
    const point = imagePointFromPointer(event);
    if (!point) return;

    if (toolMode === 'distance') {
      event.preventDefault();
      if (!pane.pendingPoint) {
        onPendingPointChange(point);
        return;
      }
      const spacing = getPlaneSpacing(volume.spacing, pane.plane);
      measurementCounterRef.current += 1;
      const measurement: DistanceMeasurement = {
        id: `${pane.id}-m-${Date.now()}-${measurementCounterRef.current}`,
        plane: pane.plane,
        sliceIndex,
        start: pane.pendingPoint,
        end: point,
        distanceMm: distanceMm(pane.pendingPoint, point, spacing),
      };
      onAddMeasurement(measurement);
      onPendingPointChange(null);
      return;
    }

    if (toolMode === 'scroll') {
      // Default click behaviour: relocate the crosshair to the picked voxel.
      event.preventDefault();
      onCrosshairFromPane(point);
    }
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (panDrag) {
      const point = displayPointFromPointer(event);
      if (!point) return;
      event.preventDefault();
      onPanChange({
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

  function handlePointerLeave() {
    if (!panDrag) {
      setHoverPoint(null);
      setHuReadout(null);
    }
  }

  // Native, non-passive wheel listener: React's synthetic onWheel can be passive
  // and silently no-op preventDefault, which lets the page (`.main-panel { overflow: auto }`)
  // scroll behind the viewer. Attach the listener via the DOM so we control passivity.
  // We re-bind the latest closure through a ref so deps don't churn the listener.
  const wheelHandlerRef = useRef<(event: globalThis.WheelEvent) => void>(() => undefined);
  wheelHandlerRef.current = (event) => {
    if (event.deltaY === 0) return;
    event.preventDefault();
    event.stopPropagation();
    onActivate();
    if (event.ctrlKey) {
      onZoomChange(pane.zoom * (event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP));
      return;
    }
    const step = event.deltaY > 0 ? 1 : -1;
    onSliceChange(sanitizeSliceIndex(sliceIndex + step, range.count));
  };

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const listener = (event: globalThis.WheelEvent) => wheelHandlerRef.current(event);
    el.addEventListener('wheel', listener, { passive: false });
    return () => el.removeEventListener('wheel', listener);
  }, []);

  const sliceLabel = `${sliceIndex + 1} / ${totalSlices}`;
  const imageSizeLabel = imageSize ? `${imageSize.width} x ${imageSize.height}` : '-';

  return (
    <article
      className={`viewer-pane${active ? ' viewer-pane-active' : ''}`}
      onMouseDown={onActivate}
    >
      <header className="viewer-pane-header">
        <div className="viewer-pane-plane-tabs" role="group" aria-label={`Pane ${index + 1} plane`}>
          {PLANE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={option.value === pane.plane ? 'plane-tab active' : 'plane-tab'}
              onClick={() => onPlaneChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <span className="viewer-pane-readout">
          {planeLabel} {sliceLabel} · W {pane.ww} / L {pane.wl} · {Math.round(pane.zoom * 100)}%
        </span>
      </header>

      <div
        ref={panelRef}
        className={`canvas-wrap nrrd-canvas-wrap ${toolMode === 'distance' ? 'measuring' : ''} ${toolMode === 'pan' ? 'panning' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endPanDrag}
        onPointerCancel={endPanDrag}
        onPointerLeave={handlePointerLeave}
        onContextMenu={(event) => event.preventDefault()}
      >
        {error ? (
          <div className="viewer-state viewer-state-error">
            <strong>Slice error</strong>
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
          <svg
            className="measurement-svg"
            viewBox={`0 0 ${panelSize.width} ${panelSize.height}`}
            aria-hidden="true"
          >
            {visibleMeasurements.map((measurement, idx) => {
              const isLatest =
                isLatestMeasurementOwner &&
                latestMeasurementId === measurement.id &&
                idx === visibleMeasurements.length - 1;
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
                    className={
                      isLatest ? 'measurement-line measurement-line-selected' : 'measurement-line'
                    }
                    vectorEffect="non-scaling-stroke"
                  />
                  <circle cx={start.x} cy={start.y} r="4.5" className="measurement-point" />
                  <circle cx={end.x} cy={end.y} r="4.5" className="measurement-point" />
                  <text
                    x={labelX}
                    y={labelY}
                    className="measurement-label"
                    textAnchor="middle"
                  >
                    {measurement.distanceMm.toFixed(1)} mm
                  </text>
                </g>
              );
            })}
            {pane.pendingPoint && fitRect ? (
              <circle
                cx={imageToDisplayPoint(pane.pendingPoint, fitRect).x}
                cy={imageToDisplayPoint(pane.pendingPoint, fitRect).y}
                r="5"
                className="measurement-pending"
              />
            ) : null}
            {crosshairOverlay
              ? renderCrosshair(crosshairOverlay.display, panelSize, crosshairOverlay.onSlice)
              : null}
          </svg>
        ) : null}
        <div className="measurement-overlay">
          {planeLabel} {sliceLabel} · {imageSizeLabel}
          {huReadout ? (
            <>
              {' '}
              · pixel {huReadout.x},{huReadout.y} · HU {huReadout.intensity}
            </>
          ) : null}
        </div>
      </div>

      <footer className="viewer-pane-footer">
        <input
          type="range"
          min={range.min}
          max={range.max}
          value={sliceIndex}
          onChange={(event) => onSliceChange(Number(event.target.value))}
          aria-label={`${planeLabel} slice`}
        />
        <button
          type="button"
          className="secondary-button small"
          onClick={onClearMeasurements}
          disabled={visibleMeasurements.length === 0}
        >
          Clear measurements
        </button>
      </footer>
    </article>
  );
}

function renderCrosshair(point: DisplayPoint, panelSize: ImageSize, onSlice: boolean) {
  const cls = onSlice ? 'crosshair-line crosshair-line-active' : 'crosshair-line';
  return (
    <g>
      <line x1={0} y1={point.y} x2={panelSize.width} y2={point.y} className={cls} />
      <line x1={point.x} y1={0} x2={point.x} y2={panelSize.height} className={cls} />
      <circle cx={point.x} cy={point.y} r="3.5" className={cls} />
    </g>
  );
}
