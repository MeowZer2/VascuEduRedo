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
  MAX_WINDOW_LEVEL,
  MAX_WINDOW_WIDTH,
  MAX_ZOOM,
  MIN_WINDOW_LEVEL,
  MIN_WINDOW_WIDTH,
  MIN_ZOOM,
  ZOOM_STEP,
  angleDeg,
  clamp,
  composeFlips,
  displayToImagePoint,
  distanceMm,
  fitImageToPanel,
  getDisplayFlips,
  getDisplayedOrientationLabels,
  getPlaneLabel,
  getPlaneOrientationLabels,
  getPlaneSpacing,
  imageToDisplayPoint,
  paneFromVoxel,
  sanitizeSliceIndex,
  type AngleMeasurement,
  type CrosshairVoxel,
  type DisplayConvention,
  type DisplayConventionContext,
  type DisplayFlips,
  type DisplayPoint,
  type DistanceMeasurement,
  type ImagePoint,
  type ImageSize,
  type Measurement,
  type ViewerToolMode,
} from './viewerShared';

interface PanDragState {
  pointerId: number;
  start: DisplayPoint;
  panStart: DisplayPoint;
}

interface ScrollDragState {
  pointerId: number;
  startY: number;
  startX: number;
  startSlice: number;
  startPoint: ImagePoint;
  /** True once we've moved past the click/drag threshold. */
  locked: boolean;
}

type PacsDragMode = 'window' | 'zoom' | 'pan';

interface PacsDragState {
  pointerId: number;
  mode: PacsDragMode;
  start: DisplayPoint;
  wwStart: number;
  wlStart: number;
  zoomStart: number;
  panStart: DisplayPoint;
}

const SCROLL_DRAG_PX_PER_SLICE = 8;
const SCROLL_DRAG_THRESHOLD_PX = 4;
const WINDOW_WIDTH_PX_SENSITIVITY = 4;
const WINDOW_LEVEL_PX_SENSITIVITY = 2;
const MIDDLE_ZOOM_PX_SENSITIVITY = 160;
const SLICE_CACHE_LIMIT = 24;
const SLICE_SCHEDULER_DEBUG_FLAG = 'vascuedu.sliceSchedulerDebug';

interface HuReadout {
  x: number;
  y: number;
  intensity: number;
}

interface SlicePixels extends ImageSize {
  pixels: Uint8Array;
}

interface SliceRequestTarget {
  key: string;
  contextKey: string;
  handleId: string;
  plane: VolumePlane;
  sliceIndex: number;
  ww: number;
  wl: number;
  planeLabel: string;
  desiredAtMs: number;
}

interface SliceSchedulerState {
  desired: SliceRequestTarget | null;
  displayedKey: string | null;
  displayedSlice: number | null;
  requestInFlight: boolean;
  lastRequestedKey: string | null;
  lastRequestedSlice: number | null;
  sequence: number;
}

export interface PaneSnapshot {
  id: string;
  plane: VolumePlane;
  slice: number;
  ww: number;
  wl: number;
  zoom: number;
  pan: DisplayPoint;
  measurements: Measurement[];
  /** In-progress points for the active tool (1 for distance, 2 for angle). */
  pendingPoints: ImagePoint[];
  /** Currently selected measurement id in this pane (or null). */
  selectedMeasurementId: string | null;
}

export interface ViewportPaneProps {
  volume: VolumeInfo;
  pane: PaneSnapshot;
  index: number;
  toolMode: ViewerToolMode;
  /** Display-only viewer convention (PACS vs canonical RAS). */
  displayConvention: DisplayConvention;
  /** Manual fallback flips composed with the convention (display-only). */
  manualFlips: DisplayFlips;
  /** Crosshair in volume voxel coordinates (or null when not yet set). */
  crosshairVoxel: CrosshairVoxel | null;
  /** Whether this pane is the "primary" — driven by the parent toolbar's WL slider. */
  active: boolean;
  /** Whether to draw the crosshair overlay on this pane. */
  showCrosshair: boolean;
  isLatestMeasurementOwner: boolean;
  latestMeasurementId: string | null;
  onActivate: () => void;
  /** Optional: fired when the user double-clicks the pane (used for focus mode). */
  onPaneDoubleClick?: () => void;
  onPlaneChange: (plane: VolumePlane) => void;
  onSliceChange: (slice: number) => void;
  onZoomChange: (zoom: number) => void;
  onPanChange: (pan: DisplayPoint) => void;
  onWLChange: (ww: number, wl: number) => void;
  onCrosshairFromPane: (imagePoint: ImagePoint) => void;
  onPendingPointsChange: (points: ImagePoint[]) => void;
  onAddMeasurement: (measurement: Measurement) => void;
  onClearMeasurements: () => void;
  onSelectMeasurement: (id: string | null) => void;
}

function makeSliceKey(
  handleId: string,
  plane: VolumePlane,
  sliceIndex: number,
  ww: number,
  wl: number,
): string {
  return `${handleId}:${plane}:${sliceIndex}:ww${ww}:wl${wl}`;
}

function makeSliceContextKey(handleId: string, plane: VolumePlane): string {
  return `${handleId}:${plane}`;
}

function getCachedSlice(
  cache: Map<string, SlicePixels>,
  key: string,
): SlicePixels | null {
  const cached = cache.get(key);
  if (!cached) return null;
  cache.delete(key);
  cache.set(key, cached);
  return cached;
}

function rememberCachedSlice(cache: Map<string, SlicePixels>, key: string, pixels: SlicePixels) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, pixels);
  while (cache.size > SLICE_CACHE_LIMIT) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

function logSliceScheduler(
  paneId: string,
  event: string,
  detail: Record<string, unknown>,
) {
  try {
    if (window.localStorage.getItem(SLICE_SCHEDULER_DEBUG_FLAG) !== '1') return;
  } catch {
    return;
  }
  console.debug(`[slice-scheduler:${paneId}] ${event}`, detail);
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
  displayConvention,
  manualFlips,
  crosshairVoxel,
  active,
  showCrosshair,
  isLatestMeasurementOwner,
  latestMeasurementId,
  onActivate,
  onPaneDoubleClick,
  onPlaneChange,
  onSliceChange,
  onZoomChange,
  onPanChange,
  onWLChange,
  onCrosshairFromPane,
  onPendingPointsChange,
  onAddMeasurement,
  onClearMeasurements,
  onSelectMeasurement,
}: ViewportPaneProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const measurementCounterRef = useRef(0);
  const [imageSize, setImageSize] = useState<ImageSize | null>(null);
  const [slicePixels, setSlicePixels] = useState<SlicePixels | null>(null);
  const [panelSize, setPanelSize] = useState<ImageSize>({ width: 0, height: 0 });
  const [panDrag, setPanDrag] = useState<PanDragState | null>(null);
  const [scrollDrag, setScrollDrag] = useState<ScrollDragState | null>(null);
  const [pacsDrag, setPacsDrag] = useState<PacsDragState | null>(null);
  const [hoverPoint, setHoverPoint] = useState<ImagePoint | null>(null);
  const [huReadout, setHuReadout] = useState<HuReadout | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slicePending, setSlicePending] = useState(false);
  const sliceCacheRef = useRef(new Map<string, SlicePixels>());
  const mountedRef = useRef(false);
  const schedulerRef = useRef<SliceSchedulerState>({
    desired: null,
    displayedKey: null,
    displayedSlice: null,
    requestInFlight: false,
    lastRequestedKey: null,
    lastRequestedSlice: null,
    sequence: 0,
  });
  const loadedContextRef = useRef<string | null>(null);
  const scrollDragDesiredSliceRef = useRef<number | null>(null);
  const scrollDragPendingSliceRef = useRef<number | null>(null);
  const scrollDragRafRef = useRef<number | null>(null);

  const range = volume.planeSliceRanges[pane.plane];
  const totalSlices = range.count;
  // Always coerce to a valid integer before sending to Rust — sync/crosshair math
  // can produce floats from per-pixel image coordinates.
  const sliceIndex = sanitizeSliceIndex(pane.slice, range.count);
  const planeLabel = getPlaneLabel(pane.plane);

  const planeSpacing = useMemo(
    () => getPlaneSpacing(volume.spacing, pane.plane),
    [volume.spacing, pane.plane],
  );
  const fitRect = useMemo(
    () => fitImageToPanel(imageSize, panelSize, pane.zoom, pane.pan, planeSpacing),
    [imageSize, panelSize, pane.zoom, pane.pan, planeSpacing],
  );
  const flips = useMemo(
    () => composeFlips(getDisplayFlips(pane.plane, displayConvention), manualFlips),
    [pane.plane, displayConvention, manualFlips],
  );
  const conventionContext = useMemo<DisplayConventionContext | null>(
    () => (imageSize ? { imageSize, flips } : null),
    [imageSize, flips],
  );
  const orientationLabels = useMemo(
    () => getDisplayedOrientationLabels(getPlaneOrientationLabels(volume, pane.plane), flips),
    [volume, pane.plane, flips],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (scrollDragRafRef.current !== null) {
        window.cancelAnimationFrame(scrollDragRafRef.current);
        scrollDragRafRef.current = null;
      }
    };
  }, []);

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
    setPacsDrag(null);
  }, [pane.plane, sliceIndex]);

  // Slice scheduler. `pane.slice` is the desired target; request/displayed
  // state is owned here so rapid browsing cannot flood the backend with stale
  // decodes. The old frame stays painted while the next request resolves.
  function commitSlice(target: SliceRequestTarget, pixels: SlicePixels) {
    setImageSize({ width: pixels.width, height: pixels.height });
    setSlicePixels(pixels);
    loadedContextRef.current = target.contextKey;
    schedulerRef.current.displayedKey = target.key;
    schedulerRef.current.displayedSlice = target.sliceIndex;
    logSliceScheduler(pane.id, 'slice committed', {
      displayedSlice: target.sliceIndex,
      desiredToCommitMs: performance.now() - target.desiredAtMs,
    });
  }

  function pumpSliceScheduler() {
    const scheduler = schedulerRef.current;
    const desired = scheduler.desired;
    if (!desired) return;

    if (scheduler.displayedKey === desired.key) {
      setSlicePending(false);
      return;
    }

    const cached = getCachedSlice(sliceCacheRef.current, desired.key);
    if (cached) {
      logSliceScheduler(pane.id, 'cache hit', {
        desiredSlice: desired.sliceIndex,
        displayedSlice: scheduler.displayedSlice,
      });
      setError(null);
      commitSlice(desired, cached);
      if (!scheduler.requestInFlight) setSlicePending(false);
      return;
    }

    logSliceScheduler(pane.id, 'cache miss', {
      desiredSlice: desired.sliceIndex,
      displayedSlice: scheduler.displayedSlice,
      requestInFlight: scheduler.requestInFlight,
    });

    if (scheduler.requestInFlight) return;

    const request = desired;
    const sequence = scheduler.sequence + 1;
    scheduler.sequence = sequence;
    scheduler.requestInFlight = true;
    scheduler.lastRequestedKey = request.key;
    scheduler.lastRequestedSlice = request.sliceIndex;
    setError(null);
    setSlicePending(true);
    const frontendRequestStarted = performance.now();
    logSliceScheduler(pane.id, 'request started', {
      sequence,
      requestedSlice: request.sliceIndex,
      desiredSlice: scheduler.desired?.sliceIndex,
      displayedSlice: scheduler.displayedSlice,
    });

    loadVolumeSlice(request.handleId, request.plane, request.sliceIndex, request.ww, request.wl)
      .then((image) => {
        if (!mountedRef.current) return;
        const frontendReceiveMs = performance.now() - frontendRequestStarted;
        const decodeStarted = performance.now();
        const gray = image.pixels ?? base64ToUint8Array(image.pixelsBase64);
        const frontendDecodeMs = performance.now() - decodeStarted;
        if (gray.length !== image.width * image.height) {
          throw new Error(
            `${request.planeLabel} slice returned ${gray.length} pixels for ${image.width} x ${image.height}.`,
          );
        }
        const pixels = { width: image.width, height: image.height, pixels: gray };
        rememberCachedSlice(sliceCacheRef.current, request.key, pixels);

        const latest = schedulerRef.current.desired;
        const canCommit =
          latest?.key === request.key ||
          (schedulerRef.current.displayedKey === null && latest?.contextKey === request.contextKey);
        if (canCommit) {
          commitSlice(request, pixels);
        } else {
          logSliceScheduler(pane.id, 'request skipped', {
            sequence,
            requestedSlice: request.sliceIndex,
            desiredSlice: latest?.sliceIndex,
            displayedSlice: schedulerRef.current.displayedSlice,
          });
        }
        logSliceScheduler(pane.id, 'request completed', {
          sequence,
          requestedSlice: request.sliceIndex,
          desiredSlice: latest?.sliceIndex,
          displayedSlice: schedulerRef.current.displayedSlice,
          frontendReceiveMs,
          frontendDecodeMs,
          rust: image.timings,
        });
      })
      .catch((caught: unknown) => {
        if (!mountedRef.current) return;
        const latest = schedulerRef.current.desired;
        if (latest?.key === request.key) {
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      })
      .finally(() => {
        if (!mountedRef.current) return;
        schedulerRef.current.requestInFlight = false;
        const latest = schedulerRef.current.desired;
        const hasOutstanding = Boolean(latest && schedulerRef.current.displayedKey !== latest.key);
        setSlicePending(hasOutstanding);
        if (hasOutstanding) {
          window.setTimeout(pumpSliceScheduler, 0);
        }
      });
  }

  useEffect(() => {
    const target: SliceRequestTarget = {
      key: makeSliceKey(volume.handleId, pane.plane, sliceIndex, pane.ww, pane.wl),
      contextKey: makeSliceContextKey(volume.handleId, pane.plane),
      handleId: volume.handleId,
      plane: pane.plane,
      sliceIndex,
      ww: pane.ww,
      wl: pane.wl,
      planeLabel,
      desiredAtMs: performance.now(),
    };

    const scheduler = schedulerRef.current;
    scheduler.desired = target;
    logSliceScheduler(pane.id, 'request scheduled', {
      desiredSlice: target.sliceIndex,
      displayedSlice: scheduler.displayedSlice,
      requestInFlight: scheduler.requestInFlight,
    });

    if (loadedContextRef.current !== null && loadedContextRef.current !== target.contextKey) {
      setSlicePixels(null);
      setImageSize(null);
      scheduler.displayedKey = null;
      scheduler.displayedSlice = null;
    }

    setError(null);
    pumpSliceScheduler();
  }, [volume.handleId, pane.plane, sliceIndex, pane.ww, pane.wl, planeLabel]);

  // Render the slice into the (DPR-scaled) canvas whenever pixels or fit change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !slicePixels || !fitRect) return;
    const drawStarted = performance.now();
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
    if (flips.flipX) {
      ctx.translate(fitRect.width, 0);
      ctx.scale(-1, 1);
    }
    if (flips.flipY) {
      ctx.translate(0, fitRect.height);
      ctx.scale(1, -1);
    }
    // Bilinear / high-quality scaling so zoomed CT looks continuous rather
    // than blocky. The underlying voxel data and the source rawCanvas pixels
    // are unchanged — smoothing only affects the upscale during drawImage.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
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
    logSliceScheduler(pane.id, 'canvas drawn', {
      displayedSlice: schedulerRef.current.displayedSlice,
      canvasDrawMs: performance.now() - drawStarted,
    });
  }, [fitRect, slicePixels, flips]);

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
  const crosshairOverlay = useMemo(() => {
    if (!showCrosshair || !crosshairVoxel || !imageSize || !fitRect) return null;
    const projection = paneFromVoxel(crosshairVoxel, pane.plane, volume.dims);
    const display = imageToDisplayPoint(
      {
        x: clamp(projection.px, 0, imageSize.width),
        y: clamp(projection.py, 0, imageSize.height),
      },
      fitRect,
      conventionContext ?? undefined,
    );
    return {
      display,
      onSlice: Math.round(projection.slice) === sliceIndex,
    };
  }, [
    showCrosshair,
    crosshairVoxel,
    imageSize,
    fitRect,
    pane.plane,
    sliceIndex,
    volume.dims,
    conventionContext,
  ]);

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
    return displayToImagePoint(display, imageSize, fitRect, flips);
  }

  function sliceFromScrollDrag(
    event: PointerEvent<HTMLDivElement>,
    drag: ScrollDragState,
  ): number | null {
    const display = displayPointFromPointer(event);
    if (!display) return null;
    const dy = display.y - drag.startY;
    const sliceDelta = Math.round(dy / SCROLL_DRAG_PX_PER_SLICE);
    return sanitizeSliceIndex(drag.startSlice + sliceDelta, range.count);
  }

  function emitScrubSlice(slice: number) {
    scrollDragDesiredSliceRef.current = slice;
    scrollDragPendingSliceRef.current = slice;
    if (scrollDragRafRef.current !== null) return;
    scrollDragRafRef.current = window.requestAnimationFrame(() => {
      scrollDragRafRef.current = null;
      const pending = scrollDragPendingSliceRef.current;
      scrollDragPendingSliceRef.current = null;
      if (pending !== null) onSliceChange(pending);
    });
  }

  function flushScrubSlice(slice: number) {
    if (scrollDragRafRef.current !== null) {
      window.cancelAnimationFrame(scrollDragRafRef.current);
      scrollDragRafRef.current = null;
    }
    scrollDragPendingSliceRef.current = null;
    if (scrollDragDesiredSliceRef.current !== slice || slice !== sliceIndex) {
      scrollDragDesiredSliceRef.current = slice;
      onSliceChange(slice);
    }
  }

  function newMeasurementId(prefix: string): string {
    measurementCounterRef.current += 1;
    return `${pane.id}-${prefix}-${Date.now()}-${measurementCounterRef.current}`;
  }

  function startPacsDrag(event: PointerEvent<HTMLDivElement>, mode: PacsDragMode) {
    const start = displayPointFromPointer(event);
    if (!start) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setPacsDrag({
      pointerId: event.pointerId,
      mode,
      start,
      wwStart: pane.ww,
      wlStart: pane.wl,
      zoomStart: pane.zoom,
      panStart: pane.pan,
    });
    setHoverPoint(null);
    setHuReadout(null);
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    onActivate();
    // PACS-style chords take priority over the selected tool:
    // RMB drag = contrast, MMB drag = zoom, LMB+RMB drag = pan.
    if (event.button === 2 && (event.buttons & 1) === 1) {
      startPacsDrag(event, 'pan');
      return;
    }
    if (event.button === 1) {
      startPacsDrag(event, 'zoom');
      return;
    }
    if (event.button === 2) {
      startPacsDrag(event, 'window');
      return;
    }
    const canStartPan =
      pane.zoom > 1 &&
      toolMode === 'pan' &&
      event.button === 0;
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
      if (pane.pendingPoints.length === 0) {
        onPendingPointsChange([point]);
        return;
      }
      const [start] = pane.pendingPoints;
      const spacing = getPlaneSpacing(volume.spacing, pane.plane);
      const measurement: DistanceMeasurement = {
        type: 'distance',
        id: newMeasurementId('d'),
        plane: pane.plane,
        sliceIndex,
        start,
        end: point,
        distanceMm: distanceMm(start, point, spacing),
        createdAt: Date.now(),
      };
      onAddMeasurement(measurement);
      onPendingPointsChange([]);
      return;
    }

    if (toolMode === 'angle') {
      event.preventDefault();
      if (pane.pendingPoints.length < 2) {
        onPendingPointsChange([...pane.pendingPoints, point]);
        return;
      }
      const [a, vertex] = pane.pendingPoints;
      const spacing = getPlaneSpacing(volume.spacing, pane.plane);
      const measurement: AngleMeasurement = {
        type: 'angle',
        id: newMeasurementId('a'),
        plane: pane.plane,
        sliceIndex,
        a,
        vertex,
        c: point,
        angleDeg: angleDeg(a, vertex, point, spacing),
        createdAt: Date.now(),
      };
      onAddMeasurement(measurement);
      onPendingPointsChange([]);
      return;
    }

    if (toolMode === 'scroll') {
      // Defer the action until pointerup so the same press can either
      // (a) relocate the crosshair on a quick click, or
      // (b) scrub slices on a vertical drag (see handlePointerMove).
      event.preventDefault();
      const display = displayPointFromPointer(event);
      if (!display) {
        onCrosshairFromPane(point);
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      scrollDragDesiredSliceRef.current = sliceIndex;
      scrollDragPendingSliceRef.current = null;
      setScrollDrag({
        pointerId: event.pointerId,
        startY: display.y,
        startX: display.x,
        startSlice: sliceIndex,
        startPoint: point,
        locked: false,
      });
    }
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (pacsDrag && pacsDrag.pointerId === event.pointerId) {
      const point = displayPointFromPointer(event);
      if (!point) return;
      event.preventDefault();
      if (pacsDrag.mode === 'window' && (event.buttons & 3) === 3) {
        setPacsDrag({ ...pacsDrag, mode: 'pan', start: point, panStart: pane.pan });
        return;
      }
      const dx = point.x - pacsDrag.start.x;
      const dy = point.y - pacsDrag.start.y;
      if (pacsDrag.mode === 'window') {
        onWLChange(
          Math.round(clamp(pacsDrag.wwStart + dx * WINDOW_WIDTH_PX_SENSITIVITY, MIN_WINDOW_WIDTH, MAX_WINDOW_WIDTH)),
          Math.round(clamp(pacsDrag.wlStart - dy * WINDOW_LEVEL_PX_SENSITIVITY, MIN_WINDOW_LEVEL, MAX_WINDOW_LEVEL)),
        );
        return;
      }
      if (pacsDrag.mode === 'zoom') {
        const factor = Math.exp(-dy / MIDDLE_ZOOM_PX_SENSITIVITY);
        onZoomChange(clamp(pacsDrag.zoomStart * factor, MIN_ZOOM, MAX_ZOOM));
        return;
      }
      onPanChange({
        x: pacsDrag.panStart.x + dx,
        y: pacsDrag.panStart.y + dy,
      });
      return;
    }
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
    if (scrollDrag && scrollDrag.pointerId === event.pointerId) {
      const display = displayPointFromPointer(event);
      if (!display) return;
      const dy = display.y - scrollDrag.startY;
      const dx = display.x - scrollDrag.startX;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (!scrollDrag.locked && dist < SCROLL_DRAG_THRESHOLD_PX) {
        // Still within the click "dead zone" — don't scrub yet.
        return;
      }
      event.preventDefault();
      if (!scrollDrag.locked) {
        setScrollDrag({ ...scrollDrag, locked: true });
      }
      const nextSlice = sliceFromScrollDrag(event, scrollDrag);
      if (nextSlice !== null && nextSlice !== scrollDragDesiredSliceRef.current) {
        emitScrubSlice(nextSlice);
      }
      return;
    }
    setHoverPoint(imagePointFromPointer(event));
  }

  function endPanDrag(event: PointerEvent<HTMLDivElement>) {
    if (pacsDrag?.pointerId === event.pointerId) {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setPacsDrag(null);
    }
    if (panDrag?.pointerId === event.pointerId) {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setPanDrag(null);
    }
    if (scrollDrag?.pointerId === event.pointerId) {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (!scrollDrag.locked) {
        // No real drag happened — treat it as a click: relocate the crosshair.
        onCrosshairFromPane(scrollDrag.startPoint);
      } else {
        const finalSlice = sliceFromScrollDrag(event, scrollDrag);
        if (finalSlice !== null) flushScrubSlice(finalSlice);
      }
      scrollDragDesiredSliceRef.current = null;
      scrollDragPendingSliceRef.current = null;
      setScrollDrag(null);
    }
  }

  function handlePointerLeave() {
    if (!panDrag && !scrollDrag && !pacsDrag) {
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

  function handleSelectMeasurement(event: PointerEvent, id: string) {
    // Stop the canvas-wrap from also receiving a pointerdown (which would, e.g.,
    // start a distance click in distance mode or relocate the crosshair).
    event.stopPropagation();
    event.preventDefault();
    onActivate();
    onSelectMeasurement(id);
  }

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
        className={`canvas-wrap nrrd-canvas-wrap ${toolMode === 'distance' || toolMode === 'angle' ? 'measuring' : ''} ${toolMode === 'pan' ? 'panning' : ''} ${toolMode === 'scroll' ? 'scrolling' : ''}${scrollDrag?.locked ? ' is-scrubbing' : ''}${pacsDrag ? ` pacs-drag-${pacsDrag.mode}` : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endPanDrag}
        onPointerCancel={endPanDrag}
        onPointerLeave={handlePointerLeave}
        onDoubleClick={onPaneDoubleClick}
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
          aria-label={`${planeLabel} slice rendered from a scan volume`}
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
            {visibleMeasurements.map((measurement) => {
              const isSelected = measurement.id === pane.selectedMeasurementId;
              const isLatest =
                isLatestMeasurementOwner && latestMeasurementId === measurement.id;
              if (measurement.type === 'distance') {
                return (
                  <DistanceOverlay
                    key={measurement.id}
                    measurement={measurement}
                    fitRect={fitRect}
                    panelSize={panelSize}
                    convention={conventionContext ?? undefined}
                    isSelected={isSelected}
                    isLatest={isLatest}
                    onSelect={(e) => handleSelectMeasurement(e, measurement.id)}
                  />
                );
              }
              return (
                <AngleOverlay
                  key={measurement.id}
                  measurement={measurement}
                  fitRect={fitRect}
                  panelSize={panelSize}
                  convention={conventionContext ?? undefined}
                  isSelected={isSelected}
                  onSelect={(e) => handleSelectMeasurement(e, measurement.id)}
                />
              );
            })}
            {/* Pending points for the in-progress tool. */}
            {pane.pendingPoints.map((point, idx) => {
              const display = imageToDisplayPoint(point, fitRect, conventionContext ?? undefined);
              return (
                <circle
                  key={`pending-${idx}`}
                  cx={display.x}
                  cy={display.y}
                  r="5"
                  className="measurement-pending"
                />
              );
            })}
            {/* Pending segment lines for the angle tool (a→vertex visible after vertex click). */}
            {toolMode === 'angle' && pane.pendingPoints.length === 2 ? (
              (() => {
                const a = imageToDisplayPoint(
                  pane.pendingPoints[0],
                  fitRect,
                  conventionContext ?? undefined,
                );
                const v = imageToDisplayPoint(
                  pane.pendingPoints[1],
                  fitRect,
                  conventionContext ?? undefined,
                );
                return (
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={v.x}
                    y2={v.y}
                    className="measurement-line measurement-line-pending"
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })()
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
        {slicePending ? (
          <div className="slice-pending-indicator" aria-hidden="true">
            <span />
          </div>
        ) : null}
        <div
          className="orientation-overlay"
          aria-hidden="true"
          data-uncertain={volume.orientation?.status === 'uncertain' ? 'true' : undefined}
        >
          <span className="orientation-label orientation-top">{orientationLabels.top}</span>
          <span className="orientation-label orientation-bottom">{orientationLabels.bottom}</span>
          <span className="orientation-label orientation-left">{orientationLabels.left}</span>
          <span className="orientation-label orientation-right">{orientationLabels.right}</span>
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

interface DistanceOverlayProps {
  measurement: DistanceMeasurement;
  fitRect: NonNullable<ReturnType<typeof fitImageToPanel>>;
  panelSize: ImageSize;
  convention?: DisplayConventionContext;
  isSelected: boolean;
  isLatest: boolean;
  onSelect: (event: PointerEvent) => void;
}

function DistanceOverlay({
  measurement,
  fitRect,
  panelSize,
  convention,
  isSelected,
  isLatest,
  onSelect,
}: DistanceOverlayProps) {
  const start = imageToDisplayPoint(measurement.start, fitRect, convention);
  const end = imageToDisplayPoint(measurement.end, fitRect, convention);
  const labelX = clamp((start.x + end.x) / 2, 18, panelSize.width - 18);
  const labelY = clamp((start.y + end.y) / 2 - 10, 18, panelSize.height - 18);
  const lineClass = isSelected
    ? 'measurement-line measurement-line-selected'
    : isLatest
      ? 'measurement-line measurement-line-latest'
      : 'measurement-line';
  const valueLabel = `${measurement.distanceMm.toFixed(1)} mm`;
  const text = measurement.label
    ? `${measurement.label} · ${valueLabel}`
    : valueLabel;
  return (
    <g className="measurement-clickable" onPointerDown={onSelect}>
      <line
        x1={start.x}
        y1={start.y}
        x2={end.x}
        y2={end.y}
        className="measurement-hit"
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1={start.x}
        y1={start.y}
        x2={end.x}
        y2={end.y}
        className={lineClass}
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={start.x} cy={start.y} r="4.5" className="measurement-point" />
      <circle cx={end.x} cy={end.y} r="4.5" className="measurement-point" />
      <text x={labelX} y={labelY} className="measurement-label" textAnchor="middle">
        {text}
      </text>
    </g>
  );
}

interface AngleOverlayProps {
  measurement: AngleMeasurement;
  fitRect: NonNullable<ReturnType<typeof fitImageToPanel>>;
  panelSize: ImageSize;
  convention?: DisplayConventionContext;
  isSelected: boolean;
  onSelect: (event: PointerEvent) => void;
}

function AngleOverlay({
  measurement,
  fitRect,
  panelSize,
  convention,
  isSelected,
  onSelect,
}: AngleOverlayProps) {
  const a = imageToDisplayPoint(measurement.a, fitRect, convention);
  const v = imageToDisplayPoint(measurement.vertex, fitRect, convention);
  const c = imageToDisplayPoint(measurement.c, fitRect, convention);
  const labelX = clamp(v.x + 12, 18, panelSize.width - 18);
  const labelY = clamp(v.y - 12, 18, panelSize.height - 18);
  const lineClass = isSelected
    ? 'measurement-line measurement-line-selected'
    : 'measurement-line';
  const valueLabel = `${measurement.angleDeg.toFixed(1)}°`;
  const text = measurement.label ? `${measurement.label} · ${valueLabel}` : valueLabel;
  return (
    <g className="measurement-clickable" onPointerDown={onSelect}>
      <line
        x1={a.x}
        y1={a.y}
        x2={v.x}
        y2={v.y}
        className="measurement-hit"
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1={v.x}
        y1={v.y}
        x2={c.x}
        y2={c.y}
        className="measurement-hit"
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1={a.x}
        y1={a.y}
        x2={v.x}
        y2={v.y}
        className={lineClass}
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1={v.x}
        y1={v.y}
        x2={c.x}
        y2={c.y}
        className={lineClass}
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={a.x} cy={a.y} r="4.5" className="measurement-point" />
      <circle cx={v.x} cy={v.y} r="5.5" className="measurement-point measurement-point-vertex" />
      <circle cx={c.x} cy={c.y} r="4.5" className="measurement-point" />
      <text x={labelX} y={labelY} className="measurement-label" textAnchor="start">
        {text}
      </text>
    </g>
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
