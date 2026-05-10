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
  type DisplayConvention,
  type DisplayPoint,
  type ImagePoint,
  type Measurement,
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
    pendingPoints: [],
    selectedMeasurementId: null,
  };
}

/**
 * Pick the most recent distance measurement across all panes, or null if none.
 * The quiz integration only cares about distance — angle measurements are
 * intentionally ignored here so existing measurement questions keep working.
 */
function findLatestDistance(panes: PaneSnapshot[]): ViewerMeasurement | null {
  let best: { m: Measurement; createdAt: number } | null = null;
  for (const pane of panes) {
    for (const m of pane.measurements) {
      if (m.type !== 'distance') continue;
      if (!best || m.createdAt > best.createdAt) best = { m, createdAt: m.createdAt };
    }
  }
  if (!best) return null;
  const m = best.m as Measurement & { type: 'distance' };
  return {
    id: m.id,
    plane: m.plane,
    sliceIndex: m.sliceIndex,
    distanceMm: m.distanceMm,
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
  const [displayConvention, setDisplayConvention] = useState<DisplayConvention>('pacs');
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

  // Switching tools clears any in-progress points so we never mix points from
  // different tool flows.
  useEffect(() => {
    setPanes((current) => current.map((p) => ({ ...p, pendingPoints: [] })));
  }, [toolMode]);

  // Keyboard: Escape clears pending points; Delete/Backspace deletes the active
  // pane's selected measurement. Skip when a text input/textarea is focused so
  // we don't hijack rename inputs etc.
  useEffect(() => {
    function isEditableTarget(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      return target.isContentEditable;
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setPanes((current) => current.map((p) => ({ ...p, pendingPoints: [] })));
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (isEditableTarget(e.target)) return;
        setPanes((current) => {
          const pane = current[activePane];
          if (!pane || !pane.selectedMeasurementId) return current;
          const targetId = pane.selectedMeasurementId;
          return current.map((p, i) =>
            i === activePane
              ? {
                  ...p,
                  measurements: p.measurements.filter((m) => m.id !== targetId),
                  selectedMeasurementId: null,
                }
              : p,
          );
        });
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activePane]);

  // Whenever the panes' measurements change, recompute the latest distance for quiz.
  useEffect(() => {
    setLatestMeasurement(findLatestDistance(panes));
  }, [panes]);

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
      pendingPoints: [],
      selectedMeasurementId: null,
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
        if (i === paneIndex) {
          // Selected measurement is slice-specific — drop the selection when
          // the user scrolls away so the list / rename UI stays in sync.
          return { ...p, slice: safeSlice, selectedMeasurementId: null };
        }
        if (!sync.slice) return p;
        const projected = paneFromVoxel(nextCross, p.plane, volume.dims).slice;
        return {
          ...p,
          slice: sanitizeSliceIndex(projected, volume.planeSliceRanges[p.plane].count),
          selectedMeasurementId: null,
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
    const nextCross = voxelFromPane(
      previous,
      pane.plane,
      imagePoint.x,
      imagePoint.y,
      pane.slice,
      volume.dims,
    );
    setCrosshair(nextCross);
    if (sync.slice) {
      setPanes((current) =>
        current.map((p, i) => {
          if (i === paneIndex) return p;
          const projected = paneFromVoxel(nextCross, p.plane, volume.dims).slice;
          return {
            ...p,
            slice: sanitizeSliceIndex(projected, volume.planeSliceRanges[p.plane].count),
          };
        }),
      );
    }
  }

  function handlePendingPointsChange(paneIndex: number, points: ImagePoint[]) {
    updatePaneAt(paneIndex, (p) => ({ ...p, pendingPoints: points }));
  }

  function handleAddMeasurement(paneIndex: number, measurement: Measurement) {
    // Newly-added measurement becomes the pane's selection so the user can immediately
    // rename or delete it from the list panel.
    updatePaneAt(paneIndex, (p) => ({
      ...p,
      measurements: [...p.measurements, measurement],
      selectedMeasurementId: measurement.id,
    }));
    // latestMeasurement (distance-only, for quiz integration) is recomputed by the
    // panes-watching useEffect, so no manual call here.
  }

  function handleSelectMeasurement(paneIndex: number, id: string | null) {
    updatePaneAt(paneIndex, (p) => ({ ...p, selectedMeasurementId: id }));
  }

  function handleRenameSelected(paneIndex: number, label: string) {
    updatePaneAt(paneIndex, (p) => {
      if (!p.selectedMeasurementId) return p;
      return {
        ...p,
        measurements: p.measurements.map((m) =>
          m.id === p.selectedMeasurementId ? { ...m, label } : m,
        ),
      };
    });
  }

  function handleDeleteSelected(paneIndex: number) {
    updatePaneAt(paneIndex, (p) => {
      if (!p.selectedMeasurementId) return p;
      return {
        ...p,
        measurements: p.measurements.filter((m) => m.id !== p.selectedMeasurementId),
        selectedMeasurementId: null,
      };
    });
  }

  function handleClearMeasurements(paneIndex: number) {
    updatePaneAt(paneIndex, (p) => ({
      ...p,
      measurements: p.measurements.filter(
        (m) => m.plane !== p.plane || m.sliceIndex !== p.slice,
      ),
      pendingPoints: [],
      selectedMeasurementId: null,
    }));
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
        pendingPoints: [],
        selectedMeasurementId: null,
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
    const orientationTag =
      volume.orientation?.status === 'trusted'
        ? `RAS canonical (${volume.orientation.space ?? 'inferred'})`
        : 'orientation uncertain';
    return `${width} x ${height} x ${depth} voxels | ${sx.toFixed(2)} / ${sy.toFixed(2)} / ${sz.toFixed(
      2,
    )} mm | intensity ${volume.intensityMin} to ${volume.intensityMax} | ${orientationTag}`;
  }, [volume]);

  const orientationWarnings = volume?.orientation?.warnings ?? [];

  const activeWindow = panes[activePane] ?? null;
  const controlsDisabled = !volume || status !== 'ready' || panes.length === 0;

  return (
    <section className="viewer-card">
      <div className="viewer-header">
        <div>
          <h3>NRRD MPR Viewer</h3>
          <p>{description}</p>
          {metadata ? <p className="viewer-metadata">{metadata}</p> : null}
          {orientationWarnings.length > 0 ? (
            <ul className="viewer-orientation-warnings" aria-label="Orientation warnings">
              {orientationWarnings.map((warning, idx) => (
                <li key={idx}>{warning}</li>
              ))}
            </ul>
          ) : null}
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
          <button
            type="button"
            className={toolMode === 'angle' ? 'tool-tab active' : 'tool-tab'}
            disabled={controlsDisabled}
            onClick={() => setToolMode('angle')}
          >
            Angle
          </button>
        </div>
        <div className="sync-tabs" role="group" aria-label="Display convention">
          <button
            type="button"
            className={displayConvention === 'pacs' ? 'tool-tab active' : 'tool-tab'}
            disabled={controlsDisabled}
            onClick={() => setDisplayConvention('pacs')}
            title="PACS / radiology display convention (R on viewer's left)"
          >
            PACS
          </button>
          <button
            type="button"
            className={displayConvention === 'canonical' ? 'tool-tab active' : 'tool-tab'}
            disabled={controlsDisabled}
            onClick={() => setDisplayConvention('canonical')}
            title="Canonical RAS display (no viewer-side flips)"
          >
            Canonical
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
      {toolMode === 'angle' ? (
        <p className="viewer-instruction">
          Click point A, then the vertex, then point C. Angle is reported at the vertex.
        </p>
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
              displayConvention={displayConvention}
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
              onPendingPointsChange={(points) => handlePendingPointsChange(idx, points)}
              onAddMeasurement={(m) => handleAddMeasurement(idx, m)}
              onClearMeasurements={() => handleClearMeasurements(idx)}
              onSelectMeasurement={(id) => handleSelectMeasurement(idx, id)}
            />
          ))}
        </div>
      ) : null}

      {activeWindow ? (
        <MeasurementList
          pane={activeWindow}
          paneIndex={activePane}
          onSelect={handleSelectMeasurement}
          onRenameSelected={handleRenameSelected}
          onDeleteSelected={handleDeleteSelected}
        />
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

interface MeasurementListProps {
  pane: PaneSnapshot;
  paneIndex: number;
  onSelect: (paneIndex: number, id: string | null) => void;
  onRenameSelected: (paneIndex: number, label: string) => void;
  onDeleteSelected: (paneIndex: number) => void;
}

/**
 * Compact measurement list for the *active pane's current slice*. Lets the user
 * click an item to select it (highlights the SVG overlay), rename the selected
 * one, and delete it. Lives at the parent so a single panel reflects whichever
 * pane the user is currently driving.
 */
function MeasurementList({
  pane,
  paneIndex,
  onSelect,
  onRenameSelected,
  onDeleteSelected,
}: MeasurementListProps) {
  // pane.slice is always written back through sanitizeSliceIndex by the parent
  // handlers, so we can trust it as an integer in [0, count-1] here.
  const sliceIndex = pane.slice;
  const slicedMeasurements = pane.measurements.filter(
    (m) => m.plane === pane.plane && m.sliceIndex === sliceIndex,
  );
  const selected = slicedMeasurements.find((m) => m.id === pane.selectedMeasurementId) ?? null;

  return (
    <section className="measurement-list-card" aria-label="Measurements on the active slice">
      <header className="measurement-list-header">
        <h4>Measurements · pane {paneIndex + 1} · {pane.plane} {sliceIndex + 1}</h4>
        <div className="measurement-list-actions">
          <button
            type="button"
            className="secondary-button small"
            onClick={() => onDeleteSelected(paneIndex)}
            disabled={!selected}
          >
            Delete selected
          </button>
        </div>
      </header>

      {slicedMeasurements.length === 0 ? (
        <p className="muted small">No measurements on this slice yet.</p>
      ) : (
        <ul className="measurement-list">
          {slicedMeasurements.map((m) => {
            const isSelected = m.id === pane.selectedMeasurementId;
            const value =
              m.type === 'distance'
                ? `${m.distanceMm.toFixed(1)} mm`
                : `${m.angleDeg.toFixed(1)}°`;
            return (
              <li
                key={m.id}
                className={
                  isSelected ? 'measurement-list-row selected' : 'measurement-list-row'
                }
              >
                <button
                  type="button"
                  className="measurement-list-button"
                  onClick={() => onSelect(paneIndex, isSelected ? null : m.id)}
                >
                  <span className={`measurement-type-pill measurement-type-${m.type}`}>
                    {m.type === 'distance' ? 'Distance' : 'Angle'}
                  </span>
                  <strong>{value}</strong>
                  {m.label ? <span className="measurement-list-label">{m.label}</span> : null}
                </button>
                {isSelected ? (
                  <input
                    className="text-input small"
                    placeholder="Label (optional)"
                    value={m.label ?? ''}
                    onChange={(event) => onRenameSelected(paneIndex, event.target.value)}
                    aria-label="Rename selected measurement"
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export type { ViewerMeasurement, ViewerToolMode };
