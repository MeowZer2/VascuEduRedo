import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { isTauriDesktop, TAURI_DESKTOP_REQUIRED_MESSAGE } from '../lib/tauri';
import {
  discoverDicomFolder,
  loadDicomSeries,
  loadVolume,
  releaseVolume,
  type DicomDiscoveryResult,
  type DicomSeriesInfo,
  type VolumeInfo,
  type VolumePlane,
} from '../lib/volume';
import {
  addRecentDicomSeries,
  addRecentFile,
  basenameFromPath,
  loadRecentFiles,
  removeRecentFile,
  recentKey,
  type RecentVolumeEntry,
} from '../lib/recentFiles';
import {
  loadDisplayConvention,
  loadViewerLayout,
  loadViewerToolMode,
  saveDisplayConvention,
  saveViewerLayout,
  saveViewerToolMode,
} from '../lib/viewerSettings';
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
  type DisplayFlips,
  type DisplayPoint,
  type ImagePoint,
  type Measurement,
  type ViewerLayout,
  type ViewerMeasurement,
  type ViewerToolMode,
  NO_MANUAL_FLIPS,
  manualFlipsActive,
} from './viewerShared';
import type { CaseBookmark } from '../types';

type ViewerStatus = 'browser' | 'loading' | 'ready' | 'error';

type VolumeSource =
  | { kind: 'nrrd'; path: string }
  | { kind: 'dicom'; folderPath: string; seriesInstanceUid: string; label: string };

interface NrrdViewerProps {
  volumePath: string;
  description: string;
  /** Suggest a tool mode (e.g. 'distance' when a measurement question is active). */
  requestedTool?: ViewerToolMode;
  /** Called whenever the most recently completed measurement changes or is cleared. */
  onLatestMeasurementChange?: (measurement: ViewerMeasurement | null) => void;
  onViewerStateChange?: (state: ViewerBookmarkState | null) => void;
  jumpToBookmark?: CaseBookmark | null;
  activeBookmark?: CaseBookmark | null;
}

interface SyncFlags {
  slice: boolean;
  wl: boolean;
  zoom: boolean;
}

export interface ViewerBookmarkState {
  plane: VolumePlane;
  sliceIndex: number;
  windowWidth: number;
  windowLevel: number;
  zoom: number;
  crosshairVoxel: [number, number, number] | null;
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
function describeErrorTitle(error: string | null): string {
  if (!error) return 'Unable to load imaging study';
  const lower = error.toLowerCase();
  if (lower.includes('not found') || lower.includes('no such file')) {
    return 'File not found';
  }
  if (lower.includes('unsupported')) {
    return 'Unsupported imaging format';
  }
  if (lower.includes('gzip')) {
    return 'Compressed payload could not be read';
  }
  if (lower.includes('orientation')) {
    return 'Bad orientation metadata';
  }
  if (lower.includes('invalid nrrd') || lower.includes('nrrd magic')) {
    return 'Malformed imaging file';
  }
  return 'Unable to load imaging study';
}

function sourceDisplayName(source: VolumeSource): string {
  return source.kind === 'dicom'
    ? source.label || basenameFromPath(source.folderPath) || 'DICOM series'
    : basenameFromPath(source.path) || '(sample)';
}

function describeDicomSeries(series: DicomSeriesInfo): string {
  return (
    series.seriesDescription ||
    [series.modality ?? 'DICOM', `${series.sliceCount} slices`].join(' ')
  );
}

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
  onViewerStateChange,
  jumpToBookmark,
  activeBookmark,
}: NrrdViewerProps) {
  const [volume, setVolume] = useState<VolumeInfo | null>(null);
  const [status, setStatus] = useState<ViewerStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [layout, setLayoutState] = useState<ViewerLayout>(() => loadViewerLayout());
  const [panes, setPanes] = useState<PaneSnapshot[]>([]);
  const [activePane, setActivePane] = useState(0);
  const [toolMode, setToolModeState] = useState<ViewerToolMode>(() => loadViewerToolMode());
  const [sync, setSync] = useState<SyncFlags>({ slice: true, wl: true, zoom: true });
  const [displayConvention, setDisplayConventionState] =
    useState<DisplayConvention>(() => loadDisplayConvention());
  const [manualFlips, setManualFlips] = useState<DisplayFlips>(NO_MANUAL_FLIPS);
  const [currentSource, setCurrentSource] = useState<VolumeSource>({ kind: 'nrrd', path: volumePath });
  const [recentFiles, setRecentFiles] = useState<RecentVolumeEntry[]>(() => loadRecentFiles());
  const [recentMenuOpen, setRecentMenuOpen] = useState(false);
  const [dicomDiscovery, setDicomDiscovery] = useState<DicomDiscoveryResult | null>(null);
  const [dicomImportStatus, setDicomImportStatus] = useState<'idle' | 'scanning' | 'error'>('idle');
  const [dicomImportError, setDicomImportError] = useState<string | null>(null);
  const [metaOpen, setMetaOpen] = useState(false);
  const [windowControlsOpen, setWindowControlsOpen] = useState(false);
  const [focusedPaneIndex, setFocusedPaneIndex] = useState<number | null>(null);

  // Whenever the case-supplied volumePath changes, snap back to it as the
  // active source. The user can still override via Advanced study import afterwards.
  useEffect(() => {
    setCurrentSource({ kind: 'nrrd', path: volumePath });
  }, [volumePath]);

  // Persist the display convention choice across app restarts.
  const setDisplayConvention = useCallback((next: DisplayConvention) => {
    setDisplayConventionState(next);
    saveDisplayConvention(next);
  }, []);
  const setToolMode = useCallback((next: ViewerToolMode) => {
    setToolModeState(next);
    saveViewerToolMode(next);
  }, []);
  const [crosshair, setCrosshair] = useState<CrosshairVoxel | null>(null);
  const [latestMeasurement, setLatestMeasurement] = useState<ViewerMeasurement | null>(null);
  const layoutRef = useRef<ViewerLayout>(layout);
  layoutRef.current = layout;

  const onLatestMeasurementChangeRef = useRef(onLatestMeasurementChange);
  onLatestMeasurementChangeRef.current = onLatestMeasurementChange;
  const onViewerStateChangeRef = useRef(onViewerStateChange);
  onViewerStateChangeRef.current = onViewerStateChange;

  // Load the volume whenever the selected source changes. Slice loading happens inside each pane.
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
    setManualFlips(NO_MANUAL_FLIPS);
    setFocusedPaneIndex(null);

    if (!isTauriDesktop()) {
      setStatus('browser');
      setError(TAURI_DESKTOP_REQUIRED_MESSAGE);
      return;
    }

    const load =
      currentSource.kind === 'dicom'
        ? loadDicomSeries(currentSource.folderPath, currentSource.seriesInstanceUid)
        : loadVolume(currentSource.path);

    load
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
  }, [currentSource]);

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

  useEffect(() => {
    const pane = panes[activePane];
    if (!volume || status !== 'ready' || !pane) {
      onViewerStateChangeRef.current?.(null);
      return;
    }
    onViewerStateChangeRef.current?.({
      plane: pane.plane,
      sliceIndex: pane.slice,
      windowWidth: pane.ww,
      windowLevel: pane.wl,
      zoom: pane.zoom,
      crosshairVoxel: crosshair ? [crosshair.x, crosshair.y, crosshair.z] : null,
    });
  }, [activePane, crosshair, panes, status, volume]);

  useEffect(() => {
    if (!jumpToBookmark || !volume || status !== 'ready') return;
    const plane = jumpToBookmark.plane;
    const safeSlice = sanitizeSliceIndex(
      jumpToBookmark.sliceIndex,
      volume.planeSliceRanges[plane].count,
    );
    setActivePane(0);
    setPanes((current) => {
      if (current.length === 0) return current;
      return current.map((pane, index) =>
        index === 0
          ? {
              ...pane,
              plane,
              slice: safeSlice,
              ww: jumpToBookmark.windowWidth,
              wl: jumpToBookmark.windowLevel,
              zoom: jumpToBookmark.zoom ?? pane.zoom,
              pendingPoints: [],
              selectedMeasurementId: null,
            }
          : pane,
      );
    });
    if (jumpToBookmark.crosshairVoxel) {
      const [x, y, z] = jumpToBookmark.crosshairVoxel;
      setCrosshair({
        x: clamp(Math.round(x), 0, volume.dims[0] - 1),
        y: clamp(Math.round(y), 0, volume.dims[1] - 1),
        z: clamp(Math.round(z), 0, volume.dims[2] - 1),
      });
    } else {
      setCrosshair((current) => {
        const previous =
          current ?? {
            x: midpoint(volume.dims[0]),
            y: midpoint(volume.dims[1]),
            z: midpoint(volume.dims[2]),
          };
        return voxelWithSlice(previous, plane, safeSlice);
      });
    }
  }, [jumpToBookmark?.id, status, volume]);

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
      if (isEditableTarget(e.target)) return;
      if (e.key === 'Escape') {
        // Escape priority: exit focus mode first so the user can step back
        // out of a maximized pane without losing in-progress points.
        if (focusedPaneIndex !== null) {
          setFocusedPaneIndex(null);
          return;
        }
        setPanes((current) => current.map((p) => ({ ...p, pendingPoints: [] })));
        return;
      }
      const active = panes[activePane];
      if ((e.key === 'ArrowUp' || e.key.toLowerCase() === 'k') && volume && active) {
        e.preventDefault();
        handleSliceChange(activePane, active.slice - 1);
        return;
      }
      if ((e.key === 'ArrowDown' || e.key.toLowerCase() === 'j') && volume && active) {
        e.preventDefault();
        handleSliceChange(activePane, active.slice + 1);
        return;
      }
      if (e.key === '1') {
        e.preventDefault();
        setLayout('1x1');
        return;
      }
      if (e.key === '2') {
        e.preventDefault();
        setLayout('1x2');
        return;
      }
      if (e.key === '3') {
        e.preventDefault();
        setLayout('1x3');
        return;
      }
      if (e.key === '4') {
        e.preventDefault();
        setLayout('2x2');
        return;
      }
      if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        setToolMode('scroll');
        return;
      }
      if (e.key.toLowerCase() === 'd') {
        e.preventDefault();
        setToolMode('distance');
        return;
      }
      if (e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setToolMode('angle');
        return;
      }
      if (e.key.toLowerCase() === 'w') {
        e.preventDefault();
        setWindowControlsOpen((open) => !open);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
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
  }, [activePane, focusedPaneIndex, panes, volume, setToolMode]);

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
      saveViewerLayout(next);
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
    saveViewerLayout(next);
    if (activePane >= targetCount) setActivePane(0);
    setFocusedPaneIndex(null);
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

  const orientationWarnings = volume?.orientation?.warnings ?? [];
  const orientationStatus = volume?.orientation?.status ?? null;
  const manualOverrideActive = manualFlipsActive(manualFlips);
  const orientationBadge: { label: string; tone: 'trusted' | 'uncertain' | 'manual' } | null =
    !volume
      ? null
      : manualOverrideActive
        ? { label: 'Manual override', tone: 'manual' }
        : orientationStatus === 'trusted'
          ? { label: 'Trusted metadata', tone: 'trusted' }
          : { label: 'Orientation uncertain', tone: 'uncertain' };
  const isShowingCaseVolume = currentSource.kind === 'nrrd' && currentSource.path === volumePath;
  const currentVolumeName = useMemo(
    () => sourceDisplayName(currentSource),
    [currentSource],
  );

  async function handleOpenLocalFile() {
    if (!isTauriDesktop()) {
      setError(TAURI_DESKTOP_REQUIRED_MESSAGE);
      return;
    }
    try {
      setRecentMenuOpen(false);
      const selected = await openDialog({
        multiple: false,
        title: 'Open scan',
        filters: [
          { name: 'Scan files', extensions: ['nrrd', 'nhdr'] },
          { name: 'All files', extensions: ['*'] },
        ],
      });
      if (typeof selected === 'string' && selected.length > 0) {
        setRecentFiles(addRecentFile(selected));
        setCurrentSource({ kind: 'nrrd', path: selected });
        setDicomDiscovery(null);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function handleOpenDicomFolder() {
    if (!isTauriDesktop()) {
      setError(TAURI_DESKTOP_REQUIRED_MESSAGE);
      return;
    }
    try {
      setRecentMenuOpen(false);
      setDicomImportStatus('idle');
      setDicomImportError(null);
      const selected = await openDialog({
        multiple: false,
        directory: true,
        title: 'Import study',
      });
      if (typeof selected !== 'string' || selected.length === 0) return;
      setDicomImportStatus('scanning');
      const discovery = await discoverDicomFolder(selected);
      setDicomDiscovery(discovery);
      setDicomImportStatus('idle');
      if (discovery.series.length === 0) {
        setDicomImportStatus('error');
        setDicomImportError('No compatible imaging series were found in the selected folder.');
      }
    } catch (caught) {
      setDicomImportStatus('error');
      setDicomImportError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  function handleSelectDicomSeries(series: DicomSeriesInfo) {
    if (series.unsupportedReason) {
      setDicomImportStatus('error');
      setDicomImportError(series.unsupportedReason);
      return;
    }
    const label = describeDicomSeries(series);
    setRecentFiles(addRecentDicomSeries(series.folderPath, series.seriesInstanceUid, label));
    setCurrentSource({
      kind: 'dicom',
      folderPath: series.folderPath,
      seriesInstanceUid: series.seriesInstanceUid,
      label,
    });
    setDicomImportStatus('idle');
    setDicomImportError(null);
  }

  function handleOpenRecent(entry: RecentVolumeEntry) {
    setRecentMenuOpen(false);
    if (entry.kind === 'dicom' && entry.seriesInstanceUid) {
      setRecentFiles(addRecentDicomSeries(entry.path, entry.seriesInstanceUid, entry.name));
      setCurrentSource({
        kind: 'dicom',
        folderPath: entry.path,
        seriesInstanceUid: entry.seriesInstanceUid,
        label: entry.name,
      });
      return;
    }
    setRecentFiles(addRecentFile(entry.path));
    setCurrentSource({ kind: 'nrrd', path: entry.path });
  }

  function handleRemoveRecent(entry: RecentVolumeEntry) {
    setRecentFiles(removeRecentFile(recentKey(entry)));
  }

  function handleUseCaseVolume() {
    if (!isShowingCaseVolume) {
      setCurrentSource({ kind: 'nrrd', path: volumePath });
      setDicomDiscovery(null);
    }
  }

  function toggleManualFlip(axis: 'x' | 'y') {
    setManualFlips((current) => ({
      flipX: axis === 'x' ? !current.flipX : current.flipX,
      flipY: axis === 'y' ? !current.flipY : current.flipY,
    }));
  }

  function resetDisplayOrientation() {
    setManualFlips(NO_MANUAL_FLIPS);
  }

  const activeWindow = panes[activePane] ?? null;
  const controlsDisabled = !volume || status !== 'ready' || panes.length === 0;
  const activeSliceMeasurements =
    activeWindow?.measurements.filter(
      (m) => m.plane === activeWindow.plane && m.sliceIndex === activeWindow.slice,
    ) ?? [];

  return (
    <section className={`viewer-card${focusedPaneIndex !== null ? ' viewer-card-focused' : ''}`}>
      <div className="viewer-header">
        <div>
          <h3>Scan viewer</h3>
          <p>{description}</p>
          <p className="viewer-source-line viewer-advanced-source-line">
            <span className="viewer-source-label">Study:</span>
            <strong>{currentVolumeName}</strong>
            {!isShowingCaseVolume ? (
              <button
                type="button"
                className="link-button small"
                onClick={handleUseCaseVolume}
                title="Return to the study that came with this case"
              >
                Use case study
              </button>
            ) : null}
          </p>
          {orientationWarnings.length > 0 && metaOpen ? (
            <ul className="viewer-orientation-warnings" aria-label="Orientation warnings">
              {orientationWarnings.map((warning, idx) => (
                <li key={idx}>{warning}</li>
              ))}
            </ul>
          ) : null}
          {activeBookmark ? (
            <div className="viewer-bookmark-note" aria-live="polite">
              <strong>{activeBookmark.title}</strong>
              {activeBookmark.note ? <span>{activeBookmark.note}</span> : null}
            </div>
          ) : null}
        </div>
        <div className="viewer-header-meta">
          {orientationBadge && orientationBadge.tone !== 'trusted' ? (
            <span
              className={`orientation-badge orientation-badge-${orientationBadge.tone}`}
              title={
                orientationBadge.tone === 'manual'
                  ? 'Manual fallback flips are active. Use Reset orientation to revert to the metadata-derived view.'
                  : orientationBadge.tone === 'uncertain'
                    ? 'Orientation metadata was missing or could not be canonicalized — labels are best-effort.'
                    : 'Display orientation is ready.'
              }
            >
              {orientationBadge.label}
            </span>
          ) : null}
          <span className="pill">{layout.toUpperCase()}</span>
        </div>
      </div>
      <div className="viewer-source-row viewer-secondary-chrome">
        <button
          type="button"
          className="secondary-button small"
          onClick={handleOpenLocalFile}
          disabled={!isTauriDesktop()}
          title={
            isTauriDesktop()
              ? 'Open a local scan file'
              : 'Native file picker requires the desktop build'
          }
        >
          Open scan
        </button>
        <button
          type="button"
          className="secondary-button small"
          onClick={handleOpenDicomFolder}
          disabled={!isTauriDesktop() || dicomImportStatus === 'scanning'}
          title={
            isTauriDesktop()
              ? 'Import a CT DICOM series from a local folder'
              : 'Native folder picker requires the desktop build'
          }
        >
          {dicomImportStatus === 'scanning' ? 'Scanning...' : 'Import study'}
        </button>
        <div className="recent-menu">
          <button
            type="button"
            className="secondary-button small"
            onClick={() => setRecentMenuOpen((open) => !open)}
            disabled={recentFiles.length === 0}
            aria-haspopup="listbox"
            aria-expanded={recentMenuOpen}
          >
            Recent ▾
          </button>
          {recentMenuOpen && recentFiles.length > 0 ? (
            <ul className="recent-menu-list" role="listbox">
              {recentFiles.map((entry) => (
                <li key={recentKey(entry)} className="recent-menu-row">
                  <button
                    type="button"
                    className="recent-menu-button"
                    onClick={() => handleOpenRecent(entry)}
                    title={entry.path}
                  >
                    <strong>{entry.name}</strong>
                    <span className="muted small">Study file · {entry.path}</span>
                  </button>
                  <button
                    type="button"
                    className="recent-menu-remove"
                    onClick={() => handleRemoveRecent(entry)}
                    aria-label={`Remove ${entry.name} from recent list`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <button
          type="button"
          className="secondary-button small"
          onClick={() => setMetaOpen((open) => !open)}
          aria-expanded={metaOpen}
        >
          {metaOpen ? 'Hide details' : 'Show details'}
        </button>
      </div>

      {dicomImportError ? (
        <div className="viewer-state-inline viewer-state-error">
          <strong>Study import issue</strong>
          <span>{dicomImportError}</span>
        </div>
      ) : null}

      {dicomDiscovery ? (
        <section className="dicom-series-panel" aria-label="Available imaging series">
          <header className="dicom-series-header">
            <div>
              <h4>Available studies</h4>
              <p className="muted small">
                {dicomDiscovery.series.length} series found
              </p>
            </div>
            <button
              type="button"
              className="secondary-button small"
              onClick={() => {
                setDicomDiscovery(null);
                setDicomImportError(null);
                setDicomImportStatus('idle');
              }}
            >
              Close
            </button>
          </header>
          {dicomDiscovery.warnings.length > 0 ? (
            <ul className="viewer-orientation-warnings" aria-label="DICOM discovery warnings">
              {dicomDiscovery.warnings.map((warning, idx) => (
                <li key={idx}>{warning}</li>
              ))}
            </ul>
          ) : null}
          <div className="dicom-series-list">
            {dicomDiscovery.series.map((series) => (
              <button
                key={series.seriesInstanceUid}
                type="button"
                className={
                  series.unsupportedReason
                    ? 'dicom-series-row unsupported'
                    : 'dicom-series-row'
                }
                onClick={() => handleSelectDicomSeries(series)}
              >
                <span>
                  <strong>{describeDicomSeries(series)}</strong>
                  <span className="muted small">
                    {series.studyDescription ? `${series.studyDescription} · ` : ''}
                    {series.modality ?? 'Unknown modality'} · {series.sliceCount} slice(s)
                  </span>
                  {series.seriesFolderPath ? (
                    <span className="muted small mono">{series.seriesFolderPath}</span>
                  ) : null}
                  {series.unsupportedReason ? (
                    <span className="dicom-series-warning">{series.unsupportedReason}</span>
                  ) : null}
                </span>
                <span className="pill">{series.modality === 'CT' ? 'Open CT' : 'Unsupported'}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <div className="viewer-tool-row viewer-tool-row-primary">
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
        <div className="viewer-presets viewer-presets-inline" role="group" aria-label="Window presets">
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
        <details className="viewer-advanced-tools">
          <summary>Advanced</summary>
          <div className="sync-tabs" role="group" aria-label="Display orientation">
          <button
            type="button"
            className={manualFlips.flipX ? 'tool-tab active' : 'tool-tab'}
            disabled={controlsDisabled}
            onClick={() => toggleManualFlip('x')}
            title="Mirror the displayed image horizontally"
          >
            Mirror H
          </button>
          <button
            type="button"
            className={manualFlips.flipY ? 'tool-tab active' : 'tool-tab'}
            disabled={controlsDisabled}
            onClick={() => toggleManualFlip('y')}
            title="Mirror the displayed image vertically"
          >
            Mirror V
          </button>
          <button
            type="button"
            className="tool-tab"
            disabled={controlsDisabled || !manualOverrideActive}
            onClick={resetDisplayOrientation}
            title="Return to the default display orientation"
          >
            Reset orientation
          </button>
          </div>
          <button
            type="button"
            className="secondary-button small"
            disabled={!volume}
            onClick={() => setMetaOpen((open) => !open)}
          >
            {metaOpen ? 'Hide study details' : 'Study details'}
          </button>
          <button
            type="button"
            className="secondary-button small"
            disabled={!activeWindow}
            onClick={() => setWindowControlsOpen((open) => !open)}
          >
            {windowControlsOpen ? 'Hide fine tuning' : 'Fine tune contrast'}
          </button>
          <div className="sync-tabs" role="group" aria-label="Display orientation preset">
            <button
              type="button"
              className={displayConvention === 'pacs' ? 'tool-tab active' : 'tool-tab'}
              disabled={controlsDisabled}
              onClick={() => setDisplayConvention('pacs')}
              title="Default radiology display"
            >
              Default view
            </button>
            <button
              type="button"
              className={displayConvention === 'canonical' ? 'tool-tab active' : 'tool-tab'}
              disabled={controlsDisabled}
              onClick={() => setDisplayConvention('canonical')}
              title="Coordinate display for troubleshooting"
            >
              Coordinate view
            </button>
          </div>
          <div className="viewer-source-row">
            <button type="button" className="secondary-button small" onClick={handleOpenLocalFile} disabled={!isTauriDesktop()}>
              Open scan
            </button>
            <button
              type="button"
              className="secondary-button small"
              onClick={handleOpenDicomFolder}
              disabled={!isTauriDesktop() || dicomImportStatus === 'scanning'}
            >
              {dicomImportStatus === 'scanning' ? 'Importing...' : 'Import study'}
            </button>
            <div className="recent-menu">
              <button
                type="button"
                className="secondary-button small"
                onClick={() => setRecentMenuOpen((open) => !open)}
                disabled={recentFiles.length === 0}
                aria-haspopup="listbox"
                aria-expanded={recentMenuOpen}
              >
                Recent
              </button>
              {recentMenuOpen && recentFiles.length > 0 ? (
                <ul className="recent-menu-list" role="listbox">
                  {recentFiles.map((entry) => (
                    <li key={recentKey(entry)} className="recent-menu-row">
                      <button
                        type="button"
                        className="recent-menu-button"
                        onClick={() => handleOpenRecent(entry)}
                        title={entry.path}
                      >
                        <strong>{entry.name}</strong>
                        <span className="muted small">{entry.path}</span>
                      </button>
                      <button
                        type="button"
                        className="recent-menu-remove"
                        onClick={() => handleRemoveRecent(entry)}
                        aria-label={`Remove ${entry.name} from recent list`}
                      >
                        x
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            {!isShowingCaseVolume ? (
              <button type="button" className="secondary-button small" onClick={handleUseCaseVolume}>
                Restore case study
              </button>
            ) : null}
          </div>
          <div className="sync-tabs" role="group" aria-label="Linked view settings">
            <button
              type="button"
              className={sync.slice ? 'tool-tab active' : 'tool-tab'}
              disabled={controlsDisabled}
              onClick={() => setSync((s) => ({ ...s, slice: !s.slice }))}
            >
              Link slices
            </button>
            <button
              type="button"
              className={sync.wl ? 'tool-tab active' : 'tool-tab'}
              disabled={controlsDisabled}
              onClick={() => setSync((s) => ({ ...s, wl: !s.wl }))}
            >
              Link contrast
            </button>
            <button
              type="button"
              className={sync.zoom ? 'tool-tab active' : 'tool-tab'}
              disabled={controlsDisabled}
              onClick={() => setSync((s) => ({ ...s, zoom: !s.zoom }))}
            >
              Link zoom
            </button>
          </div>
          <div className="zoom-tools" aria-label="Zoom controls">
            <button
              type="button"
              className="tool-tab"
              disabled={controlsDisabled}
              onClick={() => zoomActiveBy(1 / ZOOM_STEP)}
            >
              -
            </button>
            <span>{activeWindow ? `${Math.round(activeWindow.zoom * 100)}%` : '-'}</span>
            <button
              type="button"
              className="tool-tab"
              disabled={controlsDisabled}
              onClick={() => zoomActiveBy(ZOOM_STEP)}
            >
              +
            </button>
          </div>
        </details>
        <div className="sync-tabs" role="group" aria-label="Sync toggles">
          <button
            type="button"
            className={sync.slice ? 'tool-tab active' : 'tool-tab'}
            disabled={controlsDisabled}
            onClick={() => setSync((s) => ({ ...s, slice: !s.slice }))}
          >
            Slice
          </button>
          <button
            type="button"
            className={sync.wl ? 'tool-tab active' : 'tool-tab'}
            disabled={controlsDisabled}
            onClick={() => setSync((s) => ({ ...s, wl: !s.wl }))}
          >
            W/L
          </button>
          <button
            type="button"
            className={sync.zoom ? 'tool-tab active' : 'tool-tab'}
            disabled={controlsDisabled}
            onClick={() => setSync((s) => ({ ...s, zoom: !s.zoom }))}
          >
            Zoom
          </button>
        </div>
        <div className="zoom-tools" aria-label="Zoom controls">
          <button
            type="button"
            className="tool-tab"
            disabled={controlsDisabled}
            onClick={() => zoomActiveBy(1 / ZOOM_STEP)}
          >
            -
          </button>
          <span>{activeWindow ? `${Math.round(activeWindow.zoom * 100)}%` : '—'}</span>
          <button
            type="button"
            className="tool-tab"
            disabled={controlsDisabled}
            onClick={() => zoomActiveBy(ZOOM_STEP)}
          >
            +
          </button>
        </div>
        <button
          type="button"
          className="secondary-button small"
          disabled={controlsDisabled}
          onClick={resetAllViews}
        >
          Reset
        </button>
        <button
          type="button"
          className="secondary-button small"
          disabled={controlsDisabled}
          onClick={() => setFocusedPaneIndex((current) => (current === activePane ? null : activePane))}
        >
          {focusedPaneIndex !== null ? 'Exit focus' : 'Focus'}
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

      {metaOpen && volume ? (
        <dl className="viewer-metadata-panel" aria-label="Study details">
          <div>
            <dt>File</dt>
            <dd title={volume.sourcePath}>{currentVolumeName}</dd>
          </div>
          <div>
            <dt>Dimensions</dt>
            <dd>
              {volume.dims[0]} × {volume.dims[1]} × {volume.dims[2]}
            </dd>
          </div>
          <div>
            <dt>Spacing (mm)</dt>
            <dd>
              {volume.spacing[0].toFixed(3)} × {volume.spacing[1].toFixed(3)} × {volume.spacing[2].toFixed(3)}
            </dd>
          </div>
          <div>
            <dt>Encoding</dt>
            <dd>
              {volume.encoding} · {volume.voxelType}
            </dd>
          </div>
          <div>
            <dt>Intensity range</dt>
            <dd>
              {volume.intensityMin} … {volume.intensityMax}
            </dd>
          </div>
          <div>
            <dt>Display mode</dt>
            <dd>{displayConvention === 'pacs' ? 'Default view' : 'Coordinate view'}</dd>
          </div>
          <div>
            <dt>Orientation</dt>
            <dd>
              {orientationStatus === 'trusted' ? 'Ready' : 'Needs review'}
              {manualOverrideActive ? ' · manual adjustment active' : ''}
            </dd>
          </div>
          {orientationWarnings.length > 0 ? (
            <div className="viewer-metadata-warnings">
              <dt>Warnings</dt>
              <dd>
                <ul>
                  {orientationWarnings.map((w, idx) => (
                    <li key={idx}>{w}</li>
                  ))}
                </ul>
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {status === 'loading' ? (
        <div className="viewer-state viewer-state-info viewer-state-loading" role="status" aria-live="polite">
          <span className="viewer-loading-spinner" aria-hidden="true" />
          <strong>Loading {currentVolumeName || 'volume'}…</strong>
          <span>Preparing the imaging workspace.</span>
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
          <strong>{describeErrorTitle(error)}</strong>
          <span>{error}</span>
          <span className="muted small">
            Source: {currentVolumeName}
          </span>
          <div className="viewer-state-actions">
            {!isShowingCaseVolume ? (
              <button type="button" className="secondary-button small" onClick={handleUseCaseVolume}>
                Use case volume
              </button>
            ) : null}
            <button
              type="button"
              className="secondary-button small"
              onClick={handleOpenLocalFile}
              disabled={!isTauriDesktop()}
            >
              Open another study
            </button>
          </div>
        </div>
      ) : null}

      {volume && status === 'ready' && panes.length > 0 ? (
        <div
          className={`viewer-grid layout-${
            focusedPaneIndex !== null ? '1x1' : layout
          }${focusedPaneIndex !== null ? ' viewer-grid-focused' : ''}`}
        >
          {panes.map((pane, idx) => {
            if (focusedPaneIndex !== null && idx !== focusedPaneIndex) return null;
            return (
              <ViewportPane
                key={pane.id}
                volume={volume}
                pane={pane}
                index={idx}
                toolMode={toolMode}
                displayConvention={displayConvention}
                manualFlips={manualFlips}
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
                onPaneDoubleClick={() =>
                  setFocusedPaneIndex((current) => (current === idx ? null : idx))
                }
                onPlaneChange={(plane) => handlePlaneChange(idx, plane)}
                onSliceChange={(slice) => handleSliceChange(idx, slice)}
                onZoomChange={(zoom) => handleZoomChange(idx, zoom)}
                onPanChange={(pan) => handlePanChange(idx, pan)}
                onWLChange={(ww, wl) => handleWLChange(idx, ww, wl)}
                onCrosshairFromPane={(point) => handleCrosshairFromPane(idx, point)}
                onPendingPointsChange={(points) => handlePendingPointsChange(idx, points)}
                onAddMeasurement={(m) => handleAddMeasurement(idx, m)}
                onClearMeasurements={() => handleClearMeasurements(idx)}
                onSelectMeasurement={(id) => handleSelectMeasurement(idx, id)}
              />
            );
          })}
          {focusedPaneIndex !== null ? (
            <button
              type="button"
              className="focus-exit-button"
              onClick={() => setFocusedPaneIndex(null)}
              title="Exit focus mode (Esc)"
            >
              ⤢ Exit focus
            </button>
          ) : null}
        </div>
      ) : null}

      {activeWindow && activeSliceMeasurements.length > 0 && focusedPaneIndex === null ? (
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
            ? `Ready. Active view ${activePane + 1}: ${activeWindow.plane} ${activeWindow.slice + 1}/${getSliceCount(volume, activeWindow.plane)}.`
            : null}
          {status === 'loading' ? 'Preparing imaging workspace.' : null}
          {status === 'browser' ? TAURI_DESKTOP_REQUIRED_MESSAGE : null}
          {status === 'error' ? 'The viewer stopped before displaying the image.' : null}
        </span>
      </div>

      {activeWindow && windowControlsOpen && focusedPaneIndex === null ? (
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

      {focusedPaneIndex === null ? (
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
      ) : null}
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
