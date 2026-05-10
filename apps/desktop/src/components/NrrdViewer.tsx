import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isTauriDesktop, TAURI_DESKTOP_REQUIRED_MESSAGE } from '../lib/tauri';
import {
  loadVolume,
  releaseVolume,
  type VolumeInfo,
  type VolumePlane,
} from '../lib/volume';
import { ViewportPane, type PaneSnapshot } from './ViewportPane';
import {
  DEFAULT_PANE_PLANES,
  DEFAULT_WINDOW_LEVEL,
  DEFAULT_WINDOW_WIDTH,
  MAX_WINDOW_LEVEL,
  MAX_WINDOW_WIDTH,
  MAX_ZOOM,
  MIN_WINDOW_LEVEL,
  MIN_WINDOW_WIDTH,
  MIN_ZOOM,
  PANE_COUNT_BY_LAYOUT,
  WINDOW_PRESETS,
  ZOOM_STEP,
  clamp,
  getSliceCount,
  makePaneId,
  midpoint,
  paneFromVoxel,
  sanitizeSliceIndex,
  voxelFromPane,
  voxelWithSlice,
  type CrosshairVoxel,
  type DisplayPoint,
  type DistanceMeasurement,
  type ImagePoint,
  type ViewerLayout,
  type ViewerMeasurement,
  type ViewerToolMode,
} from './viewerShared';

type ViewerStatus = 'browser' | 'loading' | 'ready' | 'error';

interface NrrdViewerProps {
  volumePath: string;
  description: string;
  /** Suggest a tool mode (e.g. 'distance' when a measurement question is active). */
  requestedTool?: ViewerToolMode;
  /** Called whenever the most recently completed measurement changes or is cleared. */
  onLatestMeasurementChange?: (measurement: ViewerMeasurement | null) => void;
}

interface SyncFlags {
  slice: boolean;
  wl: boolean;
  zoom: boolean;
}

const LAYOUT_OPTIONS: Array<{ value: ViewerLayout; label: string }> = [
  { value: '1x1', label: '1×1' },
  { value: '1x2', label: '1×2' },
  { value: '1x3', label: '1×3' },
  { value: '2x2', label: '2×2' },
];

function buildPanesForLayout(
  volume: VolumeInfo,
  layout: ViewerLayout,
  ww: number,
  wl: number,
): PaneSnapshot[] {
  return DEFAULT_PANE_PLANES[layout].map((plane) => makePane(plane, volume, ww, wl));
}

function makePane(
  plane: VolumePlane,
  volume: VolumeInfo,
  ww: number,
  wl: number,
): PaneSnapshot {
  return {
    id: makePaneId(),
    plane,
    slice: midpoint(getSliceCount(volume, plane)),
    ww,
    wl,
    zoom: 1,
    pan: { x: 0, y: 0 },
    measurements: [],
    pendingPoint: null,
  };
}

export function NrrdViewer({
  volumePath,
  description,
  requestedTool,
  onLatestMeasurementChange,
}: NrrdViewerProps) {
  const [volume, setVolume] = useState<VolumeInfo | null>(null);
  const [status, setStatus] = useState<ViewerStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [layout, setLayoutState] = useState<ViewerLayout>('1x1');
  const [panes, setPanes] = useState<PaneSnapshot[]>([]);
  const [activePane, setActivePane] = useState(0);
  const [toolMode, setToolMode] = useState<ViewerToolMode>('scroll');
  const [sync, setSync] = useState<SyncFlags>({ slice: true, wl: true, zoom: true });
  const [crosshair, setCrosshair] = useState<CrosshairVoxel | null>(null);
  const [latestMeasurement, setLatestMeasurement] = useState<ViewerMeasurement | null>(null);
  const layoutRef = useRef<ViewerLayout>(layout);
  layoutRef.current = layout;

  const onLatestMeasurementChangeRef = useRef(onLatestMeasurementChange);
  onLatestMeasurementChangeRef.current = onLatestMeasurementChange;

  // Load the volume once per `volumePath`. Slice loading happens inside each pane.
  useEffect(() => {
    let cancelled = false;
    let loadedHandle: string | null = null;

    setStatus('loading');
    setError(null);
    setVolume(null);
    setPanes([]);
    setCrosshair(null);
    setLatestMeasurement(null);
    setActivePane(0);

    if (!isTauriDesktop()) {
      setStatus('browser');
      setError(TAURI_DESKTOP_REQUIRED_MESSAGE);
      return;
    }

    loadVolume(volumePath)
      .then((info) => {
        if (cancelled) {
          void releaseVolume(info.handleId);
          return;
        }
        loadedHandle = info.handleId;
        setVolume(info);
        setPanes(
          buildPanesForLayout(info, layoutRef.current, DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_LEVEL),
        );
        setCrosshair({
          x: midpoint(info.dims[0]),
          y: midpoint(info.dims[1]),
          z: midpoint(info.dims[2]),
        });
        setStatus('ready');
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setStatus('error');
        setError(caught instanceof Error ? caught.message : String(caught));
      });

    return () => {
      cancelled = true;
      if (loadedHandle) void releaseVolume(loadedHandle);
    };
  }, [volumePath]);

  // Apply a suggested tool mode from the parent (e.g. measurement question) when ready.
  useEffect(() => {
    if (requestedTool && status === 'ready') {
      setToolMode(requestedTool);
    }
  }, [requestedTool, status]);

  // Forward latest measurement to consumers (QuestionPanel reads this).
  useEffect(() => {
    onLatestMeasurementChangeRef.current?.(latestMeasurement);
  }, [latestMeasurement]);

  // Escape clears any pending distance point in any pane.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setPanes((current) => current.map((p) => ({ ...p, pendingPoint: null })));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Helper: transform a single pane in the panes array.
  const updatePaneAt = useCallback(
    (index: number, updater: (pane: PaneSnapshot) => PaneSnapshot) => {
      setPanes((current) => current.map((pane, i) => (i === index ? updater(pane) : pane)));
    },
    [],
  );

  // Layout changes preserve panes that already exist (so the user keeps their
  // chosen plane/slice/zoom) and pad with the layout's default planes.
  function setLayout(next: ViewerLayout) {
    if (!volume) {
      setLayoutState(next);
      return;
    }
    const targetCount = PANE_COUNT_BY_LAYOUT[next];
    setPanes((current) => {
      if (current.length === targetCount) return current;
      if (current.length > targetCount) return current.slice(0, targetCount);
      const additions: PaneSnapshot[] = [];
      const defaults = DEFAULT_PANE_PLANES[next];
      const baseWW = current[0]?.ww ?? DEFAULT_WINDOW_WIDTH;
      const baseWL = current[0]?.wl ?? DEFAULT_WINDOW_LEVEL;
      for (let i = current.length; i < targetCount; i += 1) {
        additions.push(makePane(defaults[i], volume, baseWW, baseWL));
      }
      return [...current, ...additions];
    });
    setLayoutState(next);
    if (activePane >= targetCount) setActivePane(0);
  }

  // -- pane handlers ---------------------------------------------------------------

  function handlePlaneChange(paneIndex: number, plane: VolumePlane) {
    if (!volume) return;
    const newSlice = sanitizeSliceIndex(
      midpoint(getSliceCount(volume, plane)),
      getSliceCount(volume, plane),
    );
    updatePaneAt(paneIndex, (p) => ({
      ...p,
      plane,
      slice: newSlice,
      pan: { x: 0, y: 0 },
      pendingPoint: null,
    }));
  }

  // Slice change from a pane (slider or wheel). Also moves the crosshair's slice
  // axis for that pane's plane and broadcasts to siblings when slice sync is on.
  function handleSliceChange(paneIndex: number, slice: number) {
    if (!volume) return;
    const pane = panes[paneIndex];
    if (!pane) return;
    const safeSlice = sanitizeSliceIndex(slice, getSliceCount(volume, pane.plane));
    const previous =
      crosshair ?? {
        x: midpoint(volume.dims[0]),
        y: midpoint(volume.dims[1]),
        z: midpoint(volume.dims[2]),
      };
    const nextCross = voxelWithSlice(previous, pane.plane, safeSlice);
    setCrosshair(nextCross);
    setPanes((current) =>
      current.map((p, i) => {
        if (i === paneIndex) return { ...p, slice: safeSlice };
        if (!sync.slice) return p;
        const projected = paneFromVoxel(nextCross, p.plane).slice;
        return {
          ...p,
          slice: sanitizeSliceIndex(projected, volume.planeSliceRanges[p.plane].count),
        };
      }),
    );
  }

  function handleZoomChange(paneIndex: number, zoom: number) {
    const next = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    setPanes((current) =>
      current.map((p, i) => {
        if (i === paneIndex || sync.zoom) {
          return {
            ...p,
            zoom: next,
            // Re-centre when zooming back below 1 so the image stays visible.
            pan: next <= 1 ? { x: 0, y: 0 } : p.pan,
          };
        }
        return p;
      }),
    );
  }

  function handlePanChange(paneIndex: number, pan: DisplayPoint) {
    // Pan is intentionally not synced — the user's tasks said pan sync is optional.
    updatePaneAt(paneIndex, (p) => ({ ...p, pan }));
  }

  /**
   * Apply a W/L change. With Sync W/L OFF, only the source pane (`paneIndex`)
   * is updated. With Sync W/L ON, every pane gets the new W/L. Each pane
   * always owns its own ww/wl in state — this function is the only path that
   * mutates them so the sync flag has a single, explicit effect.
   */
  function handleWLChange(paneIndex: number, ww: number, wl: number) {
    const safeWW = clamp(ww, MIN_WINDOW_WIDTH, MAX_WINDOW_WIDTH);
    const safeWL = clamp(wl, MIN_WINDOW_LEVEL, MAX_WINDOW_LEVEL);
    const broadcast = sync.wl;
    setPanes((current) => {
      if (broadcast) {
        return current.map((p) => ({ ...p, ww: safeWW, wl: safeWL }));
      }
      return current.map((p, i) => (i === paneIndex ? { ...p, ww: safeWW, wl: safeWL } : p));
    });
  }

  function handleCrosshairFromPane(paneIndex: number, imagePoint: ImagePoint) {
    if (!volume) return;
    const pane = panes[paneIndex];
    if (!pane) return;
    const previous =
      crosshair ?? {
        x: midpoint(volume.dims[0]),
        y: midpoint(volume.dims[1]),
        z: midpoint(volume.dims[2]),
      };
    // voxelFromPane rounds the inputs internally so the voxel stays integer-valued.
    const nextCross = voxelFromPane(previous, pane.plane, imagePoint.x, imagePoint.y, pane.slice);
    setCrosshair(nextCross);
    if (sync.slice) {
      setPanes((current) =>
        current.map((p, i) => {
          if (i === paneIndex) return p;
          const projected = paneFromVoxel(nextCross, p.plane).slice;
          return {
            ...p,
            slice: sanitizeSliceIndex(projected, volume.planeSliceRanges[p.plane].count),
          };
        }),
      );
    }
  }

  function handlePendingPointChange(paneIndex: number, point: ImagePoint | null) {
    updatePaneAt(paneIndex, (p) => ({ ...p, pendingPoint: point }));
  }

  function handleAddMeasurement(paneIndex: number, measurement: DistanceMeasurement) {
    updatePaneAt(paneIndex, (p) => ({ ...p, measurements: [...p.measurements, measurement] }));
    setLatestMeasurement({
      id: measurement.id,
      plane: measurement.plane,
      sliceIndex: measurement.sliceIndex,
      distanceMm: measurement.distanceMm,
    });
  }

  function handleClearMeasurements(paneIndex: number) {
    const pane = panes[paneIndex];
    if (!pane) return;
    updatePaneAt(paneIndex, (p) => ({
      ...p,
      measurements: p.measurements.filter(
        (m) => m.plane !== p.plane || m.sliceIndex !== p.slice,
      ),
      pendingPoint: null,
    }));
    // If the latest measurement was in the cleared (plane, slice) bucket of THIS pane
    // and it doesn't live in another pane, drop the "latest" reference. Quiz consumers
    // re-measure to set a new one.
    if (latestMeasurement) {
      const survivedHere = pane.measurements.some(
        (m) =>
          m.id === latestMeasurement.id &&
          (m.plane !== pane.plane || m.sliceIndex !== pane.slice),
      );
      const survivedElsewhere = panes.some(
        (p, i) => i !== paneIndex && p.measurements.some((m) => m.id === latestMeasurement.id),
      );
      if (!survivedHere && !survivedElsewhere) setLatestMeasurement(null);
    }
  }

  // -- toolbar handlers ------------------------------------------------------------

  function setPreset(width: number, level: number) {
    if (panes.length === 0) return;
    handleWLChange(activePane, width, level);
  }

  function resetAllViews() {
    if (!volume) return;
    setPanes((current) =>
      current.map((p) => ({
        ...p,
        slice: midpoint(getSliceCount(volume, p.plane)),
        ww: DEFAULT_WINDOW_WIDTH,
        wl: DEFAULT_WINDOW_LEVEL,
        zoom: 1,
        pan: { x: 0, y: 0 },
        pendingPoint: null,
      })),
    );
    setCrosshair({
      x: midpoint(volume.dims[0]),
      y: midpoint(volume.dims[1]),
      z: midpoint(volume.dims[2]),
    });
  }

  function zoomActiveBy(factor: number) {
    if (panes.length === 0) return;
    handleZoomChange(activePane, panes[activePane].zoom * factor);
  }

  // -- derived values --------------------------------------------------------------

  const metadata = useMemo(() => {
    if (!volume) return null;
    const [width, height, depth] = volume.dims;
    const [sx, sy, sz] = volume.spacing;
    return `${width} x ${height} x ${depth} voxels | ${sx.toFixed(2)} / ${sy.toFixed(2)} / ${sz.toFixed(
      2,
    )} mm | intensity ${volume.intensityMin} to ${volume.intensityMax}`;
  }, [volume]);

  const activeWindow = panes[activePane] ?? null;
  const controlsDisabled = !volume || status !== 'ready' || panes.length === 0;

  return (
    <section className="viewer-card">
      <div className="viewer-header">
        <div>
          <h3>NRRD MPR Viewer</h3>
          <p>{description}</p>
          {metadata ? <p className="viewer-metadata">{metadata}</p> : null}
        </div>
        <span className="pill">{layout.toUpperCase()} · MPR</span>
      </div>

      <div className="viewer-tool-row">
        <div className="layout-tabs" role="group" aria-label="Viewer layout">
          {LAYOUT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={opt.value === layout ? 'plane-tab active' : 'plane-tab'}
              disabled={controlsDisabled && opt.value !== layout}
              onClick={() => setLayout(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="tool-tabs" role="group" aria-label="Viewer tool">
          <button
            type="button"
            className={toolMode === 'scroll' ? 'tool-tab active' : 'tool-tab'}
            disabled={controlsDisabled}
            onClick={() => setToolMode('scroll')}
            title="Scroll & crosshair: click to relocate the crosshair"
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
        <div className="sync-tabs" role="group" aria-label="Sync toggles">
          <button
            type="button"
            className={sync.slice ? 'tool-tab active' : 'tool-tab'}
            disabled={controlsDisabled}
            onClick={() => setSync((s) => ({ ...s, slice: !s.slice }))}
          >
            Sync slice
          </button>
          <button
            type="button"
            className={sync.wl ? 'tool-tab active' : 'tool-tab'}
            disabled={controlsDisabled}
            onClick={() => setSync((s) => ({ ...s, wl: !s.wl }))}
          >
            Sync W/L
          </button>
          <button
            type="button"
            className={sync.zoom ? 'tool-tab active' : 'tool-tab'}
            disabled={controlsDisabled}
            onClick={() => setSync((s) => ({ ...s, zoom: !s.zoom }))}
          >
            Sync zoom
          </button>
        </div>
        <div className="zoom-tools" aria-label="Zoom controls">
          <button
            type="button"
            className="tool-tab"
            disabled={controlsDisabled}
            onClick={() => zoomActiveBy(1 / ZOOM_STEP)}
          >
            Zoom -
          </button>
          <span>{activeWindow ? `${Math.round(activeWindow.zoom * 100)}%` : '—'}</span>
          <button
            type="button"
            className="tool-tab"
            disabled={controlsDisabled}
            onClick={() => zoomActiveBy(ZOOM_STEP)}
          >
            Zoom +
          </button>
        </div>
        <button
          type="button"
          className="secondary-button small"
          disabled={controlsDisabled}
          onClick={resetAllViews}
        >
          Reset all views
        </button>
      </div>

      {toolMode === 'distance' ? (
        <p className="viewer-instruction">Click two points in any viewport to measure distance.</p>
      ) : null}
      {toolMode === 'scroll' ? (
        <p className="viewer-instruction">Click anywhere to relocate the crosshair across viewports.</p>
      ) : null}

      {status === 'loading' ? (
        <div className="viewer-state viewer-state-info">
          <strong>Loading volume…</strong>
          <span>Preparing volume metadata and MPR slices.</span>
        </div>
      ) : null}
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

      {volume && status === 'ready' && panes.length > 0 ? (
        <div className={`viewer-grid layout-${layout}`}>
          {panes.map((pane, idx) => (
            <ViewportPane
              key={pane.id}
              volume={volume}
              pane={pane}
              index={idx}
              toolMode={toolMode}
              crosshairVoxel={crosshair}
              showCrosshair
              active={idx === activePane}
              isLatestMeasurementOwner={
                latestMeasurement
                  ? pane.measurements.some((m) => m.id === latestMeasurement.id)
                  : false
              }
              latestMeasurementId={latestMeasurement?.id ?? null}
              onActivate={() => setActivePane(idx)}
              onPlaneChange={(plane) => handlePlaneChange(idx, plane)}
              onSliceChange={(slice) => handleSliceChange(idx, slice)}
              onZoomChange={(zoom) => handleZoomChange(idx, zoom)}
              onPanChange={(pan) => handlePanChange(idx, pan)}
              onCrosshairFromPane={(point) => handleCrosshairFromPane(idx, point)}
              onPendingPointChange={(point) => handlePendingPointChange(idx, point)}
              onAddMeasurement={(m) => handleAddMeasurement(idx, m)}
              onClearMeasurements={() => handleClearMeasurements(idx)}
            />
          ))}
        </div>
      ) : null}

      <div className="viewer-status-row" aria-live="polite">
        <span className={`viewer-status-dot ${status}`} />
        <span>
          {status === 'ready' && volume && activeWindow
            ? `Loaded ${volume.sourcePath}. Active pane ${activePane + 1}: ${activeWindow.plane} ${activeWindow.slice + 1}/${getSliceCount(volume, activeWindow.plane)}.`
            : null}
          {status === 'loading' ? 'Preparing volume metadata and MPR slice.' : null}
          {status === 'browser' ? TAURI_DESKTOP_REQUIRED_MESSAGE : null}
          {status === 'error' ? 'The viewer stopped before rendering the slice.' : null}
        </span>
      </div>

      {activeWindow ? (
        <div className="viewer-controls">
          <label>
            <span className="control-label-row">
              <span>Window width (active pane)</span>
              <strong>{activeWindow.ww}</strong>
            </span>
            <input
              type="range"
              min={MIN_WINDOW_WIDTH}
              max={MAX_WINDOW_WIDTH}
              step="10"
              value={activeWindow.ww}
              disabled={controlsDisabled}
              onChange={(event) =>
                handleWLChange(activePane, Number(event.target.value), activeWindow.wl)
              }
            />
            <input
              className="number-input"
              type="number"
              min={MIN_WINDOW_WIDTH}
              max={MAX_WINDOW_WIDTH}
              step="10"
              value={activeWindow.ww}
              disabled={controlsDisabled}
              onChange={(event) =>
                handleWLChange(activePane, Number(event.target.value), activeWindow.wl)
              }
            />
          </label>
          <label>
            <span className="control-label-row">
              <span>Window level (active pane)</span>
              <strong>{activeWindow.wl}</strong>
            </span>
            <input
              type="range"
              min={MIN_WINDOW_LEVEL}
              max={MAX_WINDOW_LEVEL}
              step="5"
              value={activeWindow.wl}
              disabled={controlsDisabled}
              onChange={(event) =>
                handleWLChange(activePane, activeWindow.ww, Number(event.target.value))
              }
            />
            <input
              className="number-input"
              type="number"
              min={MIN_WINDOW_LEVEL}
              max={MAX_WINDOW_LEVEL}
              step="5"
              value={activeWindow.wl}
              disabled={controlsDisabled}
              onChange={(event) =>
                handleWLChange(activePane, activeWindow.ww, Number(event.target.value))
              }
            />
          </label>
        </div>
      ) : null}

      <div className="viewer-presets">
        {WINDOW_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className="secondary-button small"
            disabled={controlsDisabled}
            onClick={() => setPreset(preset.width, preset.level)}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </section>
  );
}

export type { ViewerMeasurement, ViewerToolMode };
