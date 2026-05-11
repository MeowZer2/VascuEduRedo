import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { listDevices, type Device } from '../../lib/devices';
import { friendlyError, useUnsavedChangesGuard } from '../../lib/productionState';
import {
  ANATOMY_TEMPLATES,
  PATHOLOGY_OPTIONS,
  TREATMENT_MARKER_OPTIONS,
  VESSEL_PRESETS,
  assessDeviceFit,
  assessPlanReadiness,
  createAnatomyTemplateData,
  devicePlacementFromDevice,
  emptyVesselCompositionData,
  findEndpointSnap,
  getVesselComposition,
  getVesselPreset,
  layoutSegmentLabels,
  listVesselCompositions,
  makeSegmentFromPreset,
  makeTreatmentMarker,
  saveVesselComposition,
  snapNormalizedT,
  snapToGrid,
  treatmentMarkerLabel,
  validateVesselCompositionData,
  type AnatomyTemplate,
  type BifurcationNode,
  type ComposerPoint,
  type DeviceFitWarning,
  type DevicePlacement,
  type LabelLayoutEntry,
  type PathologyType,
  type PlanReadinessSummary,
  type PlanValidationIssue,
  type TreatmentMarker,
  type TreatmentMarkerType,
  type VascularPlanningEntity,
  type VesselCompositionData,
  type VesselCompositionRow,
  type VesselSegment,
} from '../../lib/vesselComposer';
import type { VascCase } from '../../types';

const WORKSPACE_WIDTH = 1000;
const WORKSPACE_HEIGHT = 620;
const GRID_SIZE = 20;
const HISTORY_LIMIT = 60;
const DRAFT_KEY = 'vascedu.composerDraft.v0.14';
const AUTOSAVE_DEBOUNCE_MS = 800;
const PROPERTY_HISTORY_DEBOUNCE_MS = 700;
const CLICK_DRAG_THRESHOLD = 4;

type ComposerTool = 'select' | 'segment' | 'bifurcation' | 'device' | 'marker';

interface VesselComposerPageProps {
  cases: VascCase[];
  initialCaseId: string | null;
  onOpenCase: (caseId: string) => void;
}

interface PlanState {
  segments: VesselSegment[];
  bifurcations: BifurcationNode[];
  devicePlacements: DevicePlacement[];
  treatmentMarkers: TreatmentMarker[];
  metadata: Record<string, unknown>;
}

interface DragState {
  id: string;
  startPointer: ComposerPoint;
  original: VascularPlanningEntity;
  moved: boolean;
  historyPushed: boolean;
}

interface SegmentProjection {
  segment: VesselSegment;
  point: ComposerPoint;
  t: number;
  distance: number;
}

interface DraftEnvelope {
  compositionId: string | null;
  compositionName: string;
  caseId: string;
  data: PlanState;
  savedAt: string;
}

export function VesselComposerPage({
  cases,
  initialCaseId,
  onOpenCase,
}: VesselComposerPageProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [tool, setTool] = useState<ComposerTool>('select');
  const [segments, setSegments] = useState<VesselSegment[]>([]);
  const [bifurcations, setBifurcations] = useState<BifurcationNode[]>([]);
  const [devicePlacements, setDevicePlacements] = useState<DevicePlacement[]>([]);
  const [treatmentMarkers, setTreatmentMarkers] = useState<TreatmentMarker[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [compositionId, setCompositionId] = useState<string | null>(null);
  const [compositionName, setCompositionName] = useState('Untitled vessel plan');
  const [caseId, setCaseId] = useState<string>(initialCaseId ?? '');
  const [savedRows, setSavedRows] = useState<VesselCompositionRow[]>([]);
  const [loadId, setLoadId] = useState('');
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [deviceSearch, setDeviceSearch] = useState('');
  const [segmentPresetId, setSegmentPresetId] = useState(VESSEL_PRESETS[0].id);
  const [markerType, setMarkerType] = useState<TreatmentMarkerType>('lesionStart');
  const [templateId, setTemplateId] = useState<AnatomyTemplate['id']>(ANATOMY_TEMPLATES[0].id);
  const [pendingSegmentStart, setPendingSegmentStart] = useState<ComposerPoint | null>(null);
  const [compositionMetadata, setCompositionMetadata] = useState<Record<string, unknown>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [shiftDown, setShiftDown] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);

  const stateRef = useRef<PlanState>({
    segments: [],
    bifurcations: [],
    devicePlacements: [],
    treatmentMarkers: [],
    metadata: {},
  });
  const undoStackRef = useRef<PlanState[]>([]);
  const redoStackRef = useRef<PlanState[]>([]);
  const pendingPropertySnapshotRef = useRef<PlanState | null>(null);
  const propertyTimerRef = useRef<number | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const ignoreNextDirtyRef = useRef(false);
  const initializedRef = useRef(false);

  const selectedObject = useMemo(
    () =>
      segments.find((segment) => segment.id === selectedId) ??
      bifurcations.find((node) => node.id === selectedId) ??
      devicePlacements.find((placement) => placement.id === selectedId) ??
      treatmentMarkers.find((marker) => marker.id === selectedId) ??
      null,
    [bifurcations, devicePlacements, segments, selectedId, treatmentMarkers],
  );
  const selectedCase = useMemo(
    () => cases.find((item) => item.id === caseId) ?? null,
    [cases, caseId],
  );
  const selectedDevice = useMemo(
    () => devices.find((device) => device.id === selectedDeviceId) ?? null,
    [devices, selectedDeviceId],
  );
  const filteredDevices = useMemo(() => {
    const needle = deviceSearch.trim().toLowerCase();
    if (!needle) return devices;
    return devices.filter(
      (device) =>
        device.name.toLowerCase().includes(needle) ||
        device.manufacturer.toLowerCase().includes(needle) ||
        device.category.toLowerCase().includes(needle),
    );
  }, [devices, deviceSearch]);
  const currentData = useMemo<VesselCompositionData>(
    () => ({
      ...emptyVesselCompositionData(),
      metadata: compositionMetadata,
      segments,
      bifurcations,
      devicePlacements,
      treatmentMarkers,
      viewport: { width: WORKSPACE_WIDTH, height: WORKSPACE_HEIGHT },
    }),
    [bifurcations, compositionMetadata, devicePlacements, segments, treatmentMarkers],
  );
  const deviceIds = useMemo(() => new Set(devices.map((device) => device.id)), [devices]);
  const validationIssues = useMemo(
    () => validateVesselCompositionData(currentData, deviceIds),
    [currentData, deviceIds],
  );
  const fitWarnings = useMemo(
    () => buildFitWarnings(devicePlacements, segments, devices),
    [devicePlacements, devices, segments],
  );
  const readiness = useMemo(
    () => assessPlanReadiness(currentData, validationIssues, fitWarnings),
    [currentData, fitWarnings, validationIssues],
  );
  const labelLayout = useMemo(
    () => layoutSegmentLabels(segments, { width: WORKSPACE_WIDTH, height: WORKSPACE_HEIGHT }),
    [segments],
  );
  const canUndo = undoStackRef.current.length > 0;
  const canRedo = redoStackRef.current.length > 0;

  useUnsavedChangesGuard(
    'vessel-composer',
    isDirty,
    'You have unsaved vessel plan changes. Discard them and continue?',
  );

  useEffect(() => {
    stateRef.current = {
      segments,
      bifurcations,
      devicePlacements,
      treatmentMarkers,
      metadata: compositionMetadata,
    };
  }, [segments, bifurcations, devicePlacements, treatmentMarkers, compositionMetadata]);

  useEffect(() => {
    if (ignoreNextDirtyRef.current) {
      ignoreNextDirtyRef.current = false;
      return;
    }
    if (!initializedRef.current) return;
    setIsDirty(true);
  }, [segments, bifurcations, devicePlacements, treatmentMarkers, compositionMetadata]);

  useEffect(() => {
    if (!initializedRef.current) return;
    if (!isDirty) return;
    if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = window.setTimeout(() => {
      try {
        const draft: DraftEnvelope = {
          compositionId,
          compositionName,
          caseId,
          data: stateRef.current,
          savedAt: new Date().toISOString(),
        };
        window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      } catch {
        // localStorage may be unavailable; silently skip.
      }
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
    };
  }, [
    caseId,
    compositionId,
    compositionName,
    isDirty,
    segments,
    bifurcations,
    devicePlacements,
    treatmentMarkers,
    compositionMetadata,
  ]);

  useEffect(() => {
    let cancelled = false;
    void listDevices()
      .then((rows) => {
        if (cancelled) return;
        setDevices(rows);
        setSelectedDeviceId((current) => current || rows[0]?.id || '');
      })
      .catch((e) => {
        if (!cancelled) setError(`Device catalog could not be loaded. ${friendlyError(e, 'Device placement will be unavailable until the catalog loads.')}`);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (filteredDevices.length === 0) return;
    if (!filteredDevices.find((device) => device.id === selectedDeviceId)) {
      setSelectedDeviceId(filteredDevices[0].id);
    }
  }, [filteredDevices, selectedDeviceId]);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      try {
        const rows = await listVesselCompositions();
        if (cancelled) return;
        setSavedRows(rows);
        const draft = readDraft();
        const linked = initialCaseId
          ? rows.find((row) => row.caseId === initialCaseId)
          : rows[0] ?? null;

        if (
          draft &&
          (!initialCaseId || draft.caseId === initialCaseId) &&
          window.confirm(
            `Restore unsaved vessel plan draft "${draft.compositionName}"\nfrom ${new Date(draft.savedAt).toLocaleString()}?`,
          )
        ) {
          applyDraft(draft);
          setStatus('Restored unsaved draft.');
        } else if (linked) {
          applyComposition(linked);
          if (initialCaseId) setStatus('Loaded linked vessel plan.');
        } else {
          startNewComposition(initialCaseId ?? '');
        }
      } catch (e) {
        if (!cancelled) setError(messageFromError(e));
      } finally {
        initializedRef.current = true;
      }
    }
    void boot();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCaseId]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const inField = !!target?.closest('input, textarea, select');
      if (event.key === 'Shift') setShiftDown(true);

      if (!inField) {
        if (event.key === 'Escape') {
          event.preventDefault();
          setSelectedId(null);
          setTool('select');
          setPendingSegmentStart(null);
          setDrag(null);
          setStatus(null);
          setError(null);
          return;
        }
        if (event.key.toLowerCase() === 'd' && !event.metaKey && !event.ctrlKey) {
          if (!selectedId) return;
          event.preventDefault();
          duplicateSelected();
          return;
        }
        if (event.key === 'Delete' || event.key === 'Backspace') {
          if (!selectedId) return;
          event.preventDefault();
          deleteSelected();
          return;
        }
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        if (event.shiftKey) {
          event.preventDefault();
          handleRedo();
        } else {
          event.preventDefault();
          handleUndo();
        }
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        handleRedo();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && !inField) {
        event.preventDefault();
        void handleSave();
      }
    }
    function handleKeyUp(event: KeyboardEvent) {
      if (event.key === 'Shift') setShiftDown(false);
    }
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, selectedObject, segments, bifurcations, devicePlacements, treatmentMarkers, isDirty, compositionId, compositionName, caseId]);

  useEffect(() => {
    return () => setComposerDragSelectionSuppressed(false);
  }, []);

  useEffect(() => {
    if (tool !== 'segment') setPendingSegmentStart(null);
  }, [tool]);

  function snapshotState(): PlanState {
    return {
      segments: stateRef.current.segments.slice(),
      bifurcations: stateRef.current.bifurcations.slice(),
      devicePlacements: stateRef.current.devicePlacements.slice(),
      treatmentMarkers: stateRef.current.treatmentMarkers.slice(),
      metadata: { ...stateRef.current.metadata },
    };
  }

  function applyState(state: PlanState) {
    ignoreNextDirtyRef.current = true;
    setSegments(state.segments);
    setBifurcations(state.bifurcations);
    setDevicePlacements(state.devicePlacements);
    setTreatmentMarkers(state.treatmentMarkers);
    setCompositionMetadata(state.metadata);
  }

  const flushPendingPropertyHistory = useCallback(() => {
    if (propertyTimerRef.current) {
      window.clearTimeout(propertyTimerRef.current);
      propertyTimerRef.current = null;
    }
    if (pendingPropertySnapshotRef.current) {
      pushSnapshot(pendingPropertySnapshotRef.current);
      pendingPropertySnapshotRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pushSnapshot(snapshot: PlanState) {
    undoStackRef.current.push(snapshot);
    if (undoStackRef.current.length > HISTORY_LIMIT) {
      undoStackRef.current = undoStackRef.current.slice(-HISTORY_LIMIT);
    }
    redoStackRef.current = [];
    setHistoryVersion((v) => v + 1);
  }

  function commitNow() {
    flushPendingPropertyHistory();
    pushSnapshot(snapshotState());
  }

  function commitPropertyChange() {
    if (!pendingPropertySnapshotRef.current) {
      pendingPropertySnapshotRef.current = snapshotState();
    }
    if (propertyTimerRef.current) window.clearTimeout(propertyTimerRef.current);
    propertyTimerRef.current = window.setTimeout(() => {
      if (pendingPropertySnapshotRef.current) {
        pushSnapshot(pendingPropertySnapshotRef.current);
        pendingPropertySnapshotRef.current = null;
      }
      propertyTimerRef.current = null;
    }, PROPERTY_HISTORY_DEBOUNCE_MS);
  }

  function handleUndo() {
    flushPendingPropertyHistory();
    const snapshot = undoStackRef.current.pop();
    if (!snapshot) return;
    redoStackRef.current.push(snapshotState());
    applyState(snapshot);
    setSelectedId(null);
    setDrag(null);
    setHistoryVersion((v) => v + 1);
    setStatus('Undo');
    setError(null);
  }

  function handleRedo() {
    flushPendingPropertyHistory();
    const snapshot = redoStackRef.current.pop();
    if (!snapshot) return;
    undoStackRef.current.push(snapshotState());
    applyState(snapshot);
    setSelectedId(null);
    setDrag(null);
    setHistoryVersion((v) => v + 1);
    setStatus('Redo');
    setError(null);
  }

  function clearHistory() {
    undoStackRef.current = [];
    redoStackRef.current = [];
    pendingPropertySnapshotRef.current = null;
    if (propertyTimerRef.current) {
      window.clearTimeout(propertyTimerRef.current);
      propertyTimerRef.current = null;
    }
    setHistoryVersion((v) => v + 1);
  }

  function captureComposerPointer(event: ReactPointerEvent<SVGElement>) {
    try {
      svgRef.current?.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can fail if the browser has already released the pointer.
    }
  }

  function releaseComposerPointer(event: ReactPointerEvent<SVGSVGElement>) {
    try {
      if (svgRef.current?.hasPointerCapture(event.pointerId)) {
        svgRef.current.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Best-effort cleanup.
    }
  }

  function readDraft(): DraftEnvelope | null {
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as DraftEnvelope;
      if (!parsed?.data || !Array.isArray(parsed.data.segments)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function discardDraft() {
    try {
      window.localStorage.removeItem(DRAFT_KEY);
    } catch {
      // ignore
    }
  }

  function applyDraft(draft: DraftEnvelope) {
    setCompositionId(draft.compositionId);
    setCompositionName(draft.compositionName);
    setCaseId(draft.caseId);
    ignoreNextDirtyRef.current = true;
    setSegments(draft.data.segments);
    setBifurcations(draft.data.bifurcations);
    setDevicePlacements(draft.data.devicePlacements);
    setTreatmentMarkers(draft.data.treatmentMarkers);
    setCompositionMetadata(draft.data.metadata ?? {});
    setSelectedId(null);
    setPendingSegmentStart(null);
    setLoadId(draft.compositionId ?? '');
    setError(null);
    setIsDirty(true);
    clearHistory();
  }

  function applyComposition(row: VesselCompositionRow) {
    setCompositionId(row.id);
    setCompositionName(row.name);
    setCaseId(row.caseId ?? '');
    ignoreNextDirtyRef.current = true;
    setSegments(row.data.segments);
    setBifurcations(row.data.bifurcations);
    setDevicePlacements(row.data.devicePlacements);
    setTreatmentMarkers(row.data.treatmentMarkers);
    setCompositionMetadata(row.data.metadata ?? {});
    setPendingSegmentStart(null);
    setSelectedId(null);
    setLoadId(row.id);
    setError(null);
    setIsDirty(false);
    clearHistory();
    discardDraft();
  }

  function startNewComposition(nextCaseId = caseId) {
    if (isDirty && initializedRef.current) {
      const ok = window.confirm('Discard unsaved changes and start a new vessel plan?');
      if (!ok) return;
    }
    const targetCase = cases.find((item) => item.id === nextCaseId);
    setCompositionId(null);
    setCompositionName(targetCase ? `${targetCase.title} vessel plan` : 'Untitled vessel plan');
    setCaseId(nextCaseId);
    ignoreNextDirtyRef.current = true;
    setSegments([]);
    setBifurcations([]);
    setDevicePlacements([]);
    setTreatmentMarkers([]);
    setPendingSegmentStart(null);
    setCompositionMetadata({});
    setSelectedId(null);
    setLoadId('');
    setTool('select');
    setError(null);
    setStatus('New vascular plan ready.');
    setIsDirty(false);
    clearHistory();
    discardDraft();
  }

  async function refreshSavedRows(): Promise<VesselCompositionRow[]> {
    const rows = await listVesselCompositions();
    setSavedRows(rows);
    return rows;
  }

  async function handleSave() {
    flushPendingPropertyHistory();
    const issues = validateVesselCompositionData(currentData, deviceIds);
    const blocking = issues.filter((issue) => issue.severity === 'error');
    if (blocking.length > 0) {
      setError(`Fix before saving: ${blocking.map((issue) => issue.message).join(' ')}`);
      setStatus(null);
      return;
    }

    setBusy(true);
    try {
      const saved = await saveVesselComposition({
        id: compositionId,
        caseId: caseId || null,
        name: compositionName,
        data: currentData,
      });
      applyComposition(saved);
      await refreshSavedRows();
      const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
      setStatus(
        warningCount > 0
          ? `Saved "${saved.name}" with ${warningCount} planning warning${warningCount === 1 ? '' : 's'}.`
          : `Saved "${saved.name}".`,
      );
      setError(null);
    } catch (e) {
      setError(`Save failed: ${messageFromError(e)}`);
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  async function handleLoad() {
    if (!loadId) return;
    if (isDirty) {
      const ok = window.confirm('Discard unsaved changes and load the selected plan?');
      if (!ok) return;
    }
    setBusy(true);
    try {
      const row = await getVesselComposition(loadId);
      if (!row) {
        setError('Selected vessel plan was not found.');
        return;
      }
      applyComposition(row);
      setStatus(`Loaded "${row.name}".`);
      setError(null);
    } catch (e) {
      setError(`Load failed: ${messageFromError(e)}`);
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  function maybeSnapPoint(point: ComposerPoint, opts?: { excludeSegmentId?: string | null }): ComposerPoint {
    const endpoint = findEndpointSnap(point, segments, opts?.excludeSegmentId ?? null, 14);
    if (endpoint) return endpoint;
    if (shiftDown) {
      return {
        x: clamp(snapToGrid(point.x, GRID_SIZE), 0, WORKSPACE_WIDTH),
        y: clamp(snapToGrid(point.y, GRID_SIZE), 0, WORKSPACE_HEIGHT),
      };
    }
    return point;
  }

  function handleCanvasPointerDown(event: ReactPointerEvent<SVGRectElement>) {
    event.preventDefault();
    const rawPoint = svgPoint(event);
    if (tool === 'segment') {
      handleSegmentCanvasClick(maybeSnapPoint(rawPoint));
      return;
    }
    if (tool === 'bifurcation') {
      addBifurcationAt(maybeSnapPoint(rawPoint));
      return;
    }
    if (tool === 'device') {
      setStatus('Click a vessel segment to place the selected device.');
      setError(null);
      return;
    }
    if (tool === 'marker') {
      setStatus('Click a vessel segment to place a treatment marker.');
      setError(null);
      return;
    }
    setSelectedId(null);
  }

  function handleSegmentPointerDown(
    event: ReactPointerEvent<SVGGElement>,
    segment: VesselSegment,
  ) {
    event.preventDefault();
    event.stopPropagation();
    captureComposerPointer(event);
    const point = svgPoint(event);
    if (tool === 'segment') {
      handleSegmentCanvasClick(maybeSnapPoint(point));
      return;
    }
    if (tool === 'device') {
      addDevicePlacement(segment, point);
      return;
    }
    if (tool === 'marker') {
      addTreatmentMarker(segment, point);
      return;
    }
    beginDrag(segment.id, point);
  }

  function handleObjectPointerDown(event: ReactPointerEvent<SVGGElement>, id: string) {
    event.preventDefault();
    event.stopPropagation();
    captureComposerPointer(event);
    beginDrag(id, svgPoint(event));
  }

  function beginDrag(id: string, point: ComposerPoint) {
    const original = findPlanningEntity(id, segments, bifurcations, devicePlacements, treatmentMarkers);
    if (!original) return;
    setComposerDragSelectionSuppressed(true);
    setSelectedId(id);
    setDrag({ id, startPointer: point, original, moved: false, historyPushed: false });
  }

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if (!drag) return;
    event.preventDefault();
    const point = svgPoint(event);
    const dx = point.x - drag.startPointer.x;
    const dy = point.y - drag.startPointer.y;
    if (!drag.moved && Math.hypot(dx, dy) < CLICK_DRAG_THRESHOLD) return;
    if (!drag.historyPushed) {
      commitNow();
      setDrag({ ...drag, moved: true, historyPushed: true });
    } else if (!drag.moved) {
      setDrag({ ...drag, moved: true });
    }

    if (drag.original.type === 'segment') {
      setSegments((current) =>
        current.map((segment) =>
          segment.id === drag.id ? moveSegment(drag.original as VesselSegment, dx, dy, shiftDown) : segment,
        ),
      );
    } else if (drag.original.type === 'bifurcation') {
      setBifurcations((current) =>
        current.map((node) =>
          node.id === drag.id ? moveBifurcation(drag.original as BifurcationNode, dx, dy, shiftDown) : node,
        ),
      );
    } else if (drag.original.type === 'devicePlacement') {
      const moved = moveDevicePlacement(drag.original as DevicePlacement, dx, dy, segments);
      setDevicePlacements((current) =>
        current.map((placement) => (placement.id === drag.id ? moved : placement)),
      );
    } else {
      const moved = moveTreatmentMarker(drag.original as TreatmentMarker, dx, dy, segments);
      setTreatmentMarkers((current) =>
        current.map((marker) => (marker.id === drag.id ? moved : marker)),
      );
    }
  }

  function handlePointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    if (drag) {
      event.preventDefault();
    }
    releaseComposerPointer(event);
    setComposerDragSelectionSuppressed(false);
    setDrag(null);
  }

  function applyTemplate() {
    const hasExistingPlan =
      segments.length > 0 || bifurcations.length > 0 || devicePlacements.length > 0 || treatmentMarkers.length > 0;
    if (hasExistingPlan && !window.confirm('Replace the current vessel plan with this anatomy template?')) {
      return;
    }
    commitNow();
    const template = createAnatomyTemplateData(templateId, makeId);
    const adjusted = relayoutTemplateBranches(template);
    const templateInfo = ANATOMY_TEMPLATES.find((item) => item.id === templateId);
    setCompositionId(null);
    setSegments(adjusted.segments);
    setBifurcations(adjusted.bifurcations);
    setDevicePlacements(adjusted.devicePlacements);
    setTreatmentMarkers(adjusted.treatmentMarkers);
    setCompositionMetadata(adjusted.metadata);
    setPendingSegmentStart(null);
    setSelectedId(adjusted.segments[0]?.id ?? null);
    setLoadId('');
    setTool('select');
    if (!compositionName.trim() || compositionName === 'Untitled vessel plan') {
      setCompositionName(
        selectedCase
          ? `${selectedCase.title} vessel plan`
          : `${templateInfo?.label ?? 'Template'} vessel plan`,
      );
    }
    setStatus(`${templateInfo?.label ?? 'Anatomy'} template applied.`);
    setError(null);
  }

  function handleSegmentCanvasClick(point: ComposerPoint) {
    if (!pendingSegmentStart) {
      setPendingSegmentStart(point);
      setSelectedId(null);
      setStatus('Segment start set. Click the end point. Hold Shift to snap to grid.');
      setError(null);
      return;
    }
    addSegmentBetween(pendingSegmentStart, point);
  }

  function addSegmentBetween(start: ComposerPoint, end: ComposerPoint) {
    if (distance(start, end) < 8) {
      setStatus('Choose an end point farther from the start point.');
      setError(null);
      return;
    }
    commitNow();
    const preset = VESSEL_PRESETS.find((item) => item.id === segmentPresetId) ?? VESSEL_PRESETS[0];
    const id = makeId('segment');
    const segment = makeSegmentFromPreset(
      preset.id,
      id,
      start,
      end,
      segments.filter((item) => item.vesselType === preset.vesselType).length + 1,
    );
    segment.lengthMm = Number(distance(start, end).toFixed(1));
    setSegments((current) => [...current, segment]);
    setSelectedId(id);
    setPendingSegmentStart(null);
    setTool('select');
    setStatus(`${segment.label} added.`);
    setError(null);
  }

  function addBifurcationAt(point: ComposerPoint) {
    commitNow();
    const id = makeId('bifurcation');
    const nearest = nearestSegmentProjection(point, segments);
    const parent = nearest && nearest.distance < 60 ? nearest.segment : null;
    const snappedPoint = parent ? nearest!.point : point;
    const node: BifurcationNode = {
      id,
      type: 'bifurcation',
      label: parent ? `${parent.label} bifurcation` : `Bifurcation ${bifurcations.length + 1}`,
      position: {
        x: clamp(snappedPoint.x, 40, WORKSPACE_WIDTH - 40),
        y: clamp(snappedPoint.y, 40, WORKSPACE_HEIGHT - 40),
      },
      parentSegmentId: parent?.id ?? null,
      childSegmentIds: [],
    };
    setBifurcations((current) => [...current, node]);
    setSelectedId(id);
    setTool('select');
    setStatus(parent ? `Bifurcation snapped to ${parent.label}.` : 'Bifurcation added.');
    setError(null);
  }

  function addDevicePlacement(segment: VesselSegment, point: ComposerPoint) {
    if (!selectedDevice) {
      setError('Choose a catalog device before placing it on a vessel segment.');
      setStatus(null);
      return;
    }
    commitNow();
    const projection = projectPointToSegment(point, segment);
    const snappedT = snapNormalizedT(projection.t);
    const placement = devicePlacementFromDevice(
      makeId('device'),
      selectedDevice,
      segment.id,
      snappedT,
    );
    setDevicePlacements((current) => [...current, placement]);
    setSelectedId(placement.id);
    setTool('select');
    setStatus(`Placed ${selectedDevice.name} on ${segment.label}.`);
    setError(null);
  }

  function addTreatmentMarker(segment: VesselSegment, point: ComposerPoint) {
    commitNow();
    const projection = projectPointToSegment(point, segment);
    const snappedT = snapNormalizedT(projection.t);
    const marker = makeTreatmentMarker(makeId('marker'), markerType, segment.id, snappedT);
    setTreatmentMarkers((current) => [...current, marker]);
    setSelectedId(marker.id);
    setTool('select');
    setStatus(`${marker.label} added to ${segment.label}.`);
    setError(null);
  }

  function deleteSelected() {
    if (!selectedObject) return;
    commitNow();
    if (selectedObject.type === 'segment') {
      setSegments((current) => current.filter((segment) => segment.id !== selectedObject.id));
      setDevicePlacements((current) =>
        current.filter((placement) => placement.segmentId !== selectedObject.id),
      );
      setTreatmentMarkers((current) =>
        current.filter((marker) => marker.segmentId !== selectedObject.id),
      );
      setBifurcations((current) =>
        current.map((node) => ({
          ...node,
          parentSegmentId: node.parentSegmentId === selectedObject.id ? null : node.parentSegmentId,
          childSegmentIds: node.childSegmentIds.filter((id) => id !== selectedObject.id),
        })),
      );
    } else if (selectedObject.type === 'bifurcation') {
      setBifurcations((current) => current.filter((node) => node.id !== selectedObject.id));
    } else if (selectedObject.type === 'devicePlacement') {
      setDevicePlacements((current) =>
        current.filter((placement) => placement.id !== selectedObject.id),
      );
    } else {
      setTreatmentMarkers((current) => current.filter((marker) => marker.id !== selectedObject.id));
    }
    setSelectedId(null);
    setDrag(null);
    setStatus('Selection deleted.');
    setError(null);
  }

  function duplicateSelected() {
    if (!selectedObject) return;
    commitNow();
    const offset = 28;
    if (selectedObject.type === 'segment') {
      const source = selectedObject;
      const id = makeId('segment');
      setSegments((current) => [
        ...current,
        {
          ...source,
          id,
          label: `${source.label} copy`,
          start: translatePoint(source.start, offset, offset),
          end: translatePoint(source.end, offset, offset),
          metadata: source.metadata ? { ...source.metadata } : undefined,
        },
      ]);
      setSelectedId(id);
    } else if (selectedObject.type === 'devicePlacement') {
      const source = selectedObject;
      const id = makeId('device');
      setDevicePlacements((current) => [
        ...current,
        {
          ...source,
          id,
          label: `${source.label} copy`,
          t: clamp(source.t + 0.06, 0, 1),
          metadata: source.metadata ? { ...source.metadata } : undefined,
        },
      ]);
      setSelectedId(id);
    } else if (selectedObject.type === 'treatmentMarker') {
      const source = selectedObject;
      const id = makeId('marker');
      setTreatmentMarkers((current) => [
        ...current,
        {
          ...source,
          id,
          label: `${source.label} copy`,
          t: clamp(source.t + 0.06, 0, 1),
          metadata: source.metadata ? { ...source.metadata } : undefined,
        },
      ]);
      setSelectedId(id);
    } else {
      const source = selectedObject;
      const id = makeId('bifurcation');
      setBifurcations((current) => [
        ...current,
        {
          ...source,
          id,
          label: `${source.label} copy`,
          position: translatePoint(source.position, offset, offset),
          metadata: source.metadata ? { ...source.metadata } : undefined,
        },
      ]);
      setSelectedId(id);
    }
    setTool('select');
    setPendingSegmentStart(null);
    setStatus(`${selectedObject.label} duplicated.`);
    setError(null);
  }

  function patchSegment(id: string, patch: Partial<VesselSegment>) {
    commitPropertyChange();
    setSegments((current) =>
      current.map((segment) => {
        if (segment.id !== id) return segment;
        const next = { ...segment, ...patch };
        if (patch.lengthMm !== undefined && patch.start === undefined && patch.end === undefined) {
          return resizeSegmentToLength(next, patch.lengthMm);
        }
        if (patch.start !== undefined || patch.end !== undefined) {
          return { ...next, lengthMm: Number(distance(next.start, next.end).toFixed(1)) };
        }
        return next;
      }),
    );
  }

  function patchBifurcation(id: string, patch: Partial<BifurcationNode>) {
    commitPropertyChange();
    setBifurcations((current) =>
      current.map((node) => (node.id === id ? { ...node, ...patch } : node)),
    );
  }

  function patchDevicePlacement(id: string, patch: Partial<DevicePlacement>) {
    commitPropertyChange();
    setDevicePlacements((current) =>
      current.map((placement) => (placement.id === id ? { ...placement, ...patch } : placement)),
    );
  }

  function patchTreatmentMarker(id: string, patch: Partial<TreatmentMarker>) {
    commitPropertyChange();
    setTreatmentMarkers((current) =>
      current.map((marker) => (marker.id === id ? { ...marker, ...patch } : marker)),
    );
  }

  function patchMetadata(patch: Record<string, unknown>) {
    commitPropertyChange();
    setCompositionMetadata((current) => ({ ...current, ...patch }));
  }

  function handleSegmentPresetChange(segment: VesselSegment, vesselType: string) {
    const preset = getVesselPreset(vesselType);
    patchSegment(segment.id, {
      vesselType: preset.vesselType,
      metadata: {
        ...(segment.metadata ?? {}),
        presetId: preset.id,
        strokeClass: preset.strokeClass,
      },
    });
  }

  function handlePlacementDeviceChange(placement: DevicePlacement, deviceId: string) {
    const device = devices.find((item) => item.id === deviceId);
    if (!device) return;
    patchDevicePlacement(placement.id, {
      deviceId: device.id,
      deviceName: device.name,
      deviceManufacturer: device.manufacturer,
      deviceCategory: device.category,
      label: placement.label || shortDeviceLabel(device),
      metadata: {
        ...(placement.metadata ?? {}),
        shortLabel: shortDeviceLabel(device),
      },
    });
  }

  function toggleBifurcationChild(node: BifurcationNode, segmentId: string) {
    const hasChild = node.childSegmentIds.includes(segmentId);
    patchBifurcation(node.id, {
      childSegmentIds: hasChild
        ? node.childSegmentIds.filter((id) => id !== segmentId)
        : [...node.childSegmentIds, segmentId],
    });
  }

  function svgPoint(event: ReactPointerEvent<SVGElement>): ComposerPoint {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * WORKSPACE_WIDTH;
    const y = ((event.clientY - rect.top) / rect.height) * WORKSPACE_HEIGHT;
    return {
      x: clamp(x, 0, WORKSPACE_WIDTH),
      y: clamp(y, 0, WORKSPACE_HEIGHT),
    };
  }

  const totalEntities = segments.length + bifurcations.length + devicePlacements.length + treatmentMarkers.length;

  return (
    <div className="page-stack composer-page">
      <header className="page-header split-header">
        <div>
          <p className="eyebrow">Vessel composer</p>
          <h2>Vascular procedural plan</h2>
          <p>Structured vessel anatomy, branch relationships, and catalog-backed device placement.</p>
        </div>
        <div className="row-actions">
          {selectedCase && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => onOpenCase(selectedCase.id)}
            >
              Open case
            </button>
          )}
          <button
            type="button"
            className="secondary-button"
            onClick={() => startNewComposition(caseId)}
            disabled={busy}
          >
            New plan
          </button>
        </div>
      </header>

      <section className="composer-toolbar" aria-label="Vessel composer tools">
        <div className="composer-toolbar-row">
          <div className="composer-tool-group" role="group" aria-label="Drawing tools">
            <ToolButton tool={tool} value="select" label="Select" onSelect={setTool} title="Select / move (Esc to clear)" />
            <ToolButton tool={tool} value="segment" label="Segment" onSelect={setTool} title="Add a vessel segment" />
            <ToolButton tool={tool} value="bifurcation" label="Branch" onSelect={setTool} title="Add a bifurcation" />
            <ToolButton
              tool={tool}
              value="device"
              label="Device"
              onSelect={setTool}
              title="Place a catalog device on a segment"
              disabled={devices.length === 0 || segments.length === 0}
            />
            <ToolButton
              tool={tool}
              value="marker"
              label="Marker"
              onSelect={setTool}
              title="Place a treatment marker"
              disabled={segments.length === 0}
            />
          </div>

          <div className="composer-tool-group" role="group" aria-label="Edit actions">
            <button
              type="button"
              className="secondary-button small"
              onClick={duplicateSelected}
              disabled={!selectedObject || busy}
              title="Duplicate selection (D)"
            >
              Duplicate
            </button>
            <button
              type="button"
              className="secondary-button small"
              onClick={deleteSelected}
              disabled={!selectedId || busy}
              title="Delete selection (Del)"
            >
              Delete
            </button>
            <button
              type="button"
              className="secondary-button small"
              onClick={handleUndo}
              disabled={!canUndo || busy}
              title="Undo (Ctrl+Z)"
            >
              Undo
            </button>
            <button
              type="button"
              className="secondary-button small"
              onClick={handleRedo}
              disabled={!canRedo || busy}
              title="Redo (Ctrl+Shift+Z)"
            >
              Redo
            </button>
          </div>

          <div className="composer-toolbar-spacer" />

          <div className="composer-tool-group" role="group" aria-label="File actions">
            {isDirty && (
              <span className="composer-dirty-pill" title="Unsaved changes - autosaved as draft">
                Unsaved
              </span>
            )}
            <button
              type="button"
              className="primary-button"
              onClick={() => void handleSave()}
              disabled={busy}
              title="Save (Ctrl+S)"
            >
              Save
            </button>
            <button
              type="button"
              className={moreOpen ? 'secondary-button small active' : 'secondary-button small'}
              onClick={() => setMoreOpen((v) => !v)}
              aria-expanded={moreOpen}
              aria-controls="composer-secondary-toolbar"
            >
              {moreOpen ? 'Less' : 'More'}
            </button>
          </div>
        </div>

        {moreOpen && (
          <div className="composer-toolbar-row composer-toolbar-secondary" id="composer-secondary-toolbar">
            <div className="composer-tool-group">
              <label className="composer-mini-label" htmlFor="composer-template-select">Template</label>
              <select
                id="composer-template-select"
                className="text-input small composer-template-select"
                value={templateId}
                onChange={(event) => setTemplateId(event.target.value as AnatomyTemplate['id'])}
              >
                {ANATOMY_TEMPLATES.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="secondary-button small"
                onClick={applyTemplate}
                disabled={busy}
              >
                Apply
              </button>
            </div>

            <div className="composer-tool-group">
              <label className="composer-mini-label" htmlFor="composer-preset-select">Segment preset</label>
              <select
                id="composer-preset-select"
                className="text-input small composer-preset-select"
                value={segmentPresetId}
                onChange={(event) => setSegmentPresetId(event.target.value)}
              >
                {VESSEL_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="composer-tool-group">
              <label className="composer-mini-label" htmlFor="composer-marker-select">Marker type</label>
              <select
                id="composer-marker-select"
                className="text-input small composer-marker-select"
                value={markerType}
                onChange={(event) => setMarkerType(event.target.value as TreatmentMarkerType)}
              >
                {TREATMENT_MARKER_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="composer-tool-group">
              <label className="composer-mini-label" htmlFor="composer-load-select">Saved plans</label>
              <select
                id="composer-load-select"
                className="text-input small composer-load-select"
                value={loadId}
                onChange={(event) => setLoadId(event.target.value)}
                disabled={savedRows.length === 0 || busy}
              >
                <option value="">Choose a plan</option>
                {savedRows.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="secondary-button small"
                onClick={() => void handleLoad()}
                disabled={!loadId || busy}
              >
                Load
              </button>
            </div>
          </div>
        )}
      </section>

      {(status || error) && (
        <div className={error ? 'admin-banner error' : 'admin-banner success'} role="status">
          {error ?? status}
        </div>
      )}

      <section className="composer-layout">
        <aside className="composer-side-panel">
          <PlanReadinessPanel
            readiness={readiness}
            issues={validationIssues}
            fitWarnings={fitWarnings}
          />

          <PlanSummaryPanel
            compositionName={compositionName}
            onNameChange={setCompositionName}
            caseId={caseId}
            onCaseChange={setCaseId}
            cases={cases}
            linkedCaseTitle={selectedCase?.title ?? null}
            segments={segments}
            devicePlacements={devicePlacements}
            treatmentMarkers={treatmentMarkers}
            readiness={readiness}
            notes={typeof compositionMetadata.notes === 'string' ? compositionMetadata.notes : ''}
            onNotesChange={(notes) => patchMetadata({ notes })}
          />

          <section className="composer-properties-section">
            <h3>Properties</h3>
            {selectedObject ? (
              <PropertyEditor
                key={selectedObject.id}
                selected={selectedObject}
                segments={segments}
                devices={filteredDevices}
                allDevices={devices}
                fitWarnings={fitWarnings}
                onPatchSegment={patchSegment}
                onPatchBifurcation={patchBifurcation}
                onPatchDevicePlacement={patchDevicePlacement}
                onPatchTreatmentMarker={patchTreatmentMarker}
                onSegmentPresetChange={handleSegmentPresetChange}
                onPlacementDeviceChange={handlePlacementDeviceChange}
                onToggleBifurcationChild={toggleBifurcationChild}
              />
            ) : (
              <div className="composer-empty-properties">
                <p className="muted small">Select an object on the canvas to edit its properties.</p>
                <p className="muted small">
                  Tips: hold <kbd>Shift</kbd> to snap to grid · press <kbd>Esc</kbd> to cancel an add-tool ·
                  <kbd>Ctrl+Z</kbd> to undo.
                </p>
              </div>
            )}
          </section>

          {selectedDevice && (
            <section className="composer-catalog-section">
              <h3>Catalog device</h3>
              <input
                className="text-input"
                type="search"
                placeholder="Filter devices"
                value={deviceSearch}
                onChange={(event) => setDeviceSearch(event.target.value)}
              />
              <select
                className="text-input"
                value={selectedDeviceId}
                onChange={(event) => setSelectedDeviceId(event.target.value)}
                disabled={filteredDevices.length === 0}
              >
                {filteredDevices.length === 0 ? (
                  <option value="">No devices available</option>
                ) : (
                  filteredDevices.map((device) => (
                    <option key={device.id} value={device.id}>
                      {device.name}
                    </option>
                  ))
                )}
              </select>
              <p className="muted small">
                {selectedDevice.manufacturer} / {selectedDevice.category}
              </p>
            </section>
          )}
        </aside>

        <div className="composer-canvas-panel">
          <header className="composer-canvas-header">
            <div>
              <strong>{compositionName || 'Untitled vessel plan'}</strong>
              <span>{selectedCase ? selectedCase.title : 'Unlinked composition'}</span>
            </div>
            <div className="composer-canvas-stats">
              <span className="pill">{segments.length} seg</span>
              <span className="pill">{devicePlacements.length} dev</span>
              <span className="pill">{treatmentMarkers.length} mkr</span>
              <span className={`pill readiness-${readiness.status}`}>{readinessLabel(readiness.status)}</span>
            </div>
          </header>

          <svg
            ref={svgRef}
            className={`vessel-composer-svg tool-${tool}`}
            viewBox={`0 0 ${WORKSPACE_WIDTH} ${WORKSPACE_HEIGHT}`}
            role="img"
            aria-label="Vessel composer canvas"
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            <defs>
              <pattern id="composer-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" className="composer-grid-line" />
              </pattern>
            </defs>
            <rect
              className="composer-bg"
              width={WORKSPACE_WIDTH}
              height={WORKSPACE_HEIGHT}
              onPointerDown={handleCanvasPointerDown}
            />

            {totalEntities === 0 && pendingSegmentStart === null && (
              <g className="composer-empty-hint" pointerEvents="none">
                <text x={WORKSPACE_WIDTH / 2} y={WORKSPACE_HEIGHT / 2 - 10} textAnchor="middle">
                  Click "Segment" to draw a vessel
                </text>
                <text x={WORKSPACE_WIDTH / 2} y={WORKSPACE_HEIGHT / 2 + 18} textAnchor="middle" className="composer-empty-hint-sub">
                  or open "More" and apply an anatomy template
                </text>
              </g>
            )}

            {pendingSegmentStart && (
              <g className="composer-pending-segment">
                <circle cx={pendingSegmentStart.x} cy={pendingSegmentStart.y} r="7" />
                <text x={pendingSegmentStart.x + 12} y={pendingSegmentStart.y - 12}>
                  start
                </text>
              </g>
            )}

            {bifurcations.map((node) => (
              <BifurcationLinks key={`links-${node.id}`} node={node} segments={segments} />
            ))}

            {segments.map((segment) => (
              <SegmentSvg
                key={segment.id}
                segment={segment}
                selected={selectedId === segment.id}
                hovered={hoveredId === segment.id && tool === 'select'}
                layout={labelLayout.get(segment.id) ?? null}
                onPointerDown={handleSegmentPointerDown}
                onHoverChange={setHoveredId}
              />
            ))}

            {bifurcations.map((node) => (
              <BifurcationSvg
                key={node.id}
                node={node}
                selected={selectedId === node.id}
                hovered={hoveredId === node.id && tool === 'select'}
                onPointerDown={handleObjectPointerDown}
                onHoverChange={setHoveredId}
              />
            ))}

            {treatmentMarkers.map((marker) => {
              const segment = segments.find((item) => item.id === marker.segmentId);
              if (!segment) return null;
              const point = interpolateSegment(segment, marker.t);
              return (
                <TreatmentMarkerSvg
                  key={marker.id}
                  marker={marker}
                  point={point}
                  selected={selectedId === marker.id}
                  hovered={hoveredId === marker.id && tool === 'select'}
                  onPointerDown={handleObjectPointerDown}
                  onHoverChange={setHoveredId}
                />
              );
            })}

            {devicePlacements.map((placement) => {
              const segment = segments.find((item) => item.id === placement.segmentId);
              if (!segment) return null;
              const point = interpolateSegment(segment, placement.t);
              return (
                <DevicePlacementSvg
                  key={placement.id}
                  placement={placement}
                  point={point}
                  selected={selectedId === placement.id}
                  hovered={hoveredId === placement.id && tool === 'select'}
                  onPointerDown={handleObjectPointerDown}
                  onHoverChange={setHoveredId}
                />
              );
            })}
          </svg>
          <footer className="composer-canvas-footer">
            <span className="muted small">
              {tool === 'segment' && pendingSegmentStart && 'Click the end point. Hold Shift for grid snap.'}
              {tool === 'segment' && !pendingSegmentStart && 'Click the start point. Hold Shift for grid snap.'}
              {tool === 'bifurcation' && 'Click near a vessel to add a bifurcation.'}
              {tool === 'device' && 'Click a vessel segment to place the selected device.'}
              {tool === 'marker' && 'Click a vessel segment to add a treatment marker.'}
              {tool === 'select' && (selectedObject ? `${selectedObject.label} selected` : 'Click an object to select it. Esc clears.')}
            </span>
            <span className="muted small">
              History {undoStackRef.current.length}/{redoStackRef.current.length}
              {historyVersion >= 0 ? '' : ''}
            </span>
          </footer>
        </div>
      </section>
    </div>
  );
}

function ToolButton({
  tool,
  value,
  label,
  onSelect,
  title,
  disabled,
}: {
  tool: ComposerTool;
  value: ComposerTool;
  label: string;
  onSelect: (next: ComposerTool) => void;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={tool === value ? 'tool-tab active' : 'tool-tab'}
      onClick={() => onSelect(value)}
      disabled={disabled}
      title={title}
    >
      {label}
    </button>
  );
}

function readinessLabel(status: PlanReadinessSummary['status']): string {
  switch (status) {
    case 'ready':
      return 'Ready';
    case 'warnings':
      return 'Warnings';
    case 'blocked':
      return 'Blocked';
    case 'empty':
    default:
      return 'Empty';
  }
}

function PlanReadinessPanel({
  readiness,
  issues,
  fitWarnings,
}: {
  readiness: PlanReadinessSummary;
  issues: PlanValidationIssue[];
  fitWarnings: DeviceFitWarning[];
}) {
  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');
  const fitWarn = fitWarnings.filter((w) => w.severity === 'warning');
  const fitInfo = fitWarnings.filter((w) => w.severity === 'info');
  return (
    <section className="composer-readiness-panel">
      <header className="composer-readiness-header">
        <h3>Plan readiness</h3>
        <span className={`composer-readiness-pill readiness-${readiness.status}`}>
          {readinessLabel(readiness.status)}
        </span>
      </header>
      <p className="composer-readiness-headline">{readiness.headline}</p>
      <div className="composer-readiness-stats">
        <ReadinessStat label="Segments" value={readiness.segmentCount} />
        <ReadinessStat label="Branches" value={readiness.bifurcationCount} />
        <ReadinessStat label="Devices" value={readiness.deviceCount} />
        <ReadinessStat label="Markers" value={readiness.markerCount} />
        <ReadinessStat label="Targets" value={readiness.interventionTargets} />
        <ReadinessStat
          label="Fit warn"
          value={readiness.unresolvedFitWarnings}
          accent={readiness.unresolvedFitWarnings > 0 ? 'warning' : undefined}
        />
      </div>
      {errors.length > 0 && (
        <ReadinessGroup title={`Blocking (${errors.length})`} severity="error">
          {errors.slice(0, 5).map((issue) => (
            <li key={issue.field}>{issue.message}</li>
          ))}
          {errors.length > 5 && <li className="muted small">{errors.length - 5} more…</li>}
        </ReadinessGroup>
      )}
      {warnings.length > 0 && (
        <ReadinessGroup title={`Warnings (${warnings.length})`} severity="warning">
          {warnings.slice(0, 5).map((issue) => (
            <li key={issue.field}>{issue.message}</li>
          ))}
          {warnings.length > 5 && <li className="muted small">{warnings.length - 5} more…</li>}
        </ReadinessGroup>
      )}
      {fitWarn.length > 0 && (
        <ReadinessGroup title={`Device fit (${fitWarn.length})`} severity="warning">
          {fitWarn.slice(0, 4).map((warning, index) => (
            <li key={`${warning.placementId}-${index}`}>{warning.message}</li>
          ))}
        </ReadinessGroup>
      )}
      {fitInfo.length > 0 && (
        <ReadinessGroup title={`Info (${fitInfo.length})`} severity="info">
          {fitInfo.slice(0, 3).map((warning, index) => (
            <li key={`${warning.placementId}-${index}`}>{warning.message}</li>
          ))}
        </ReadinessGroup>
      )}
      {readiness.status === 'ready' && (
        <p className="muted small">Plan validates clean. Save to keep changes.</p>
      )}
    </section>
  );
}

function ReadinessStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: 'warning';
}) {
  return (
    <div className={`composer-readiness-stat${accent ? ` ${accent}` : ''}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function ReadinessGroup({
  title,
  severity,
  children,
}: {
  title: string;
  severity: 'error' | 'warning' | 'info';
  children: ReactNode;
}) {
  return (
    <div className={`composer-readiness-group ${severity}`}>
      <strong>{title}</strong>
      <ul>{children}</ul>
    </div>
  );
}

function PlanSummaryPanel({
  compositionName,
  onNameChange,
  caseId,
  onCaseChange,
  cases,
  linkedCaseTitle,
  segments,
  devicePlacements,
  treatmentMarkers,
  readiness,
  notes,
  onNotesChange,
}: {
  compositionName: string;
  onNameChange: (value: string) => void;
  caseId: string;
  onCaseChange: (value: string) => void;
  cases: VascCase[];
  linkedCaseTitle: string | null;
  segments: VesselSegment[];
  devicePlacements: DevicePlacement[];
  treatmentMarkers: TreatmentMarker[];
  readiness: PlanReadinessSummary;
  notes: string;
  onNotesChange: (notes: string) => void;
}) {
  const interventionTargets = segments.filter(
    (segment) => segment.targetForIntervention || segment.pathologyType !== 'normal',
  );
  const pathologySummary = interventionTargets
    .map((segment) => `${segment.label} (${prettyPathology(segment)})`)
    .slice(0, 3);
  const noteWords = notes.trim().split(/\s+/).filter(Boolean);
  const noteSummary = noteWords.slice(0, 24).join(' ');

  return (
    <section className="composer-summary-panel">
      <h3>Plan summary</h3>
      <div className="composer-summary-card">
        <label className="field-label">
          <span>Plan name</span>
          <input
            className="text-input"
            value={compositionName}
            onChange={(event) => onNameChange(event.target.value)}
          />
        </label>
        <label className="field-label">
          <span>Linked case</span>
          <select
            className="text-input"
            value={caseId}
            onChange={(event) => onCaseChange(event.target.value)}
          >
            <option value="">No case link</option>
            {cases.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <SummaryRow label="Case">{linkedCaseTitle ?? 'Unlinked plan'}</SummaryRow>
        <SummaryRow label="Pathology">
          {pathologySummary.length === 0 ? 'No pathology marked' : pathologySummary.join(' · ')}
          {interventionTargets.length > 3 ? ` · +${interventionTargets.length - 3} more` : ''}
        </SummaryRow>
        <SummaryRow label="Targets">
          {interventionTargets.length === 0
            ? 'None'
            : interventionTargets
                .slice(0, 3)
                .map((segment) => `${segment.label}: ${landingZoneSummary(segment, treatmentMarkers)}`)
                .join(' · ')}
        </SummaryRow>
        <SummaryRow label="Devices">
          {devicePlacements.length === 0
            ? 'No devices placed'
            : devicePlacements
                .slice(0, 3)
                .map((placement) => placement.label || placement.deviceName)
                .join(' · ') + (devicePlacements.length > 3 ? ` · +${devicePlacements.length - 3} more` : '')}
        </SummaryRow>
        <SummaryRow label="Status">
          {readiness.errorCount > 0
            ? `${readiness.errorCount} blocking issue(s)`
            : readiness.warningCount > 0
              ? `${readiness.warningCount} warning(s)`
              : segments.length === 0
                ? 'Empty plan'
                : 'Ready'}
        </SummaryRow>
        {noteSummary && (
          <SummaryRow label="Notes">
            {noteSummary}
            {noteWords.length > 24 ? '…' : ''}
          </SummaryRow>
        )}
        <label className="field-label">
          <span>Procedural notes</span>
          <textarea
            className="text-input textarea compact"
            value={notes}
            onChange={(event) => onNotesChange(event.target.value)}
            placeholder="Approach, sequence, contingencies…"
          />
        </label>
      </div>
    </section>
  );
}

function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="composer-summary-row">
      <span className="composer-summary-row-label">{label}</span>
      <span className="composer-summary-row-value">{children}</span>
    </div>
  );
}

function FitWarningList({ warnings }: { warnings: DeviceFitWarning[] }) {
  if (warnings.length === 0) {
    return <p className="muted small">Fit check: no obvious sizing warning.</p>;
  }
  return (
    <ul className="composer-fit-list">
      {warnings.map((warning, index) => (
        <li key={`${warning.placementId}-${index}`} className={warning.severity}>
          {warning.message}
        </li>
      ))}
    </ul>
  );
}

function PropertyEditor({
  selected,
  segments,
  devices,
  allDevices,
  fitWarnings,
  onPatchSegment,
  onPatchBifurcation,
  onPatchDevicePlacement,
  onPatchTreatmentMarker,
  onSegmentPresetChange,
  onPlacementDeviceChange,
  onToggleBifurcationChild,
}: {
  selected: VascularPlanningEntity;
  segments: VesselSegment[];
  devices: Device[];
  allDevices: Device[];
  fitWarnings: DeviceFitWarning[];
  onPatchSegment: (id: string, patch: Partial<VesselSegment>) => void;
  onPatchBifurcation: (id: string, patch: Partial<BifurcationNode>) => void;
  onPatchDevicePlacement: (id: string, patch: Partial<DevicePlacement>) => void;
  onPatchTreatmentMarker: (id: string, patch: Partial<TreatmentMarker>) => void;
  onSegmentPresetChange: (segment: VesselSegment, vesselType: string) => void;
  onPlacementDeviceChange: (placement: DevicePlacement, deviceId: string) => void;
  onToggleBifurcationChild: (node: BifurcationNode, segmentId: string) => void;
}) {
  if (selected.type === 'segment') {
    return (
      <SegmentPropertyEditor
        segment={selected}
        onPatch={onPatchSegment}
        onPresetChange={onSegmentPresetChange}
      />
    );
  }
  if (selected.type === 'devicePlacement') {
    return (
      <DevicePlacementPropertyEditor
        placement={selected}
        segments={segments}
        devices={devices}
        allDevices={allDevices}
        fitWarnings={fitWarnings}
        onPatch={onPatchDevicePlacement}
        onDeviceChange={onPlacementDeviceChange}
      />
    );
  }
  if (selected.type === 'treatmentMarker') {
    return (
      <TreatmentMarkerPropertyEditor
        marker={selected}
        segments={segments}
        onPatch={onPatchTreatmentMarker}
      />
    );
  }
  return (
    <BifurcationPropertyEditor
      node={selected}
      segments={segments}
      onPatch={onPatchBifurcation}
      onToggleChild={onToggleBifurcationChild}
    />
  );
}

function PropertyGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="composer-property-group">
      <h4>{title}</h4>
      <div className="composer-property-group-body">{children}</div>
    </div>
  );
}

function SegmentPropertyEditor({
  segment,
  onPatch,
  onPresetChange,
}: {
  segment: VesselSegment;
  onPatch: (id: string, patch: Partial<VesselSegment>) => void;
  onPresetChange: (segment: VesselSegment, vesselType: string) => void;
}) {
  const angleDeg = segmentAngleDeg(segment);
  return (
    <div className="composer-selection-card">
      <span className="composer-selection-pill segment">vessel segment</span>

      <PropertyGroup title="Identity">
        <label className="field-label">
          <span>Label</span>
          <input
            className="text-input"
            value={segment.label}
            onChange={(event) => onPatch(segment.id, { label: event.target.value })}
          />
        </label>
        <label className="field-label">
          <span>Preset</span>
          <select
            className="text-input"
            value={getVesselPreset(segment.vesselType).id}
            onChange={(event) => onPresetChange(segment, event.target.value)}
          >
            {VESSEL_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field-label">
          <span>Vessel type / name</span>
          <input
            className="text-input"
            value={segment.vesselType}
            onChange={(event) => onPatch(segment.id, { vesselType: event.target.value })}
          />
        </label>
      </PropertyGroup>

      <PropertyGroup title="Geometry">
        <div className="composer-field-grid">
          <NumberField
            label="Prox Ø mm"
            value={segment.proximalDiameterMm}
            onChange={(value) => {
              if (value !== '') onPatch(segment.id, { proximalDiameterMm: value });
            }}
          />
          <NumberField
            label="Distal Ø mm"
            value={segment.distalDiameterMm}
            onChange={(value) => {
              if (value !== '') onPatch(segment.id, { distalDiameterMm: value });
            }}
          />
        </div>
        <div className="composer-field-grid">
          <NumberField
            label="Length mm"
            value={segment.lengthMm}
            onChange={(value) => {
              if (value !== '') onPatch(segment.id, { lengthMm: value });
            }}
          />
          <NumberField
            label="Angle °"
            value={angleDeg}
            onChange={(value) => {
              if (value !== '') onPatch(segment.id, rotateSegmentToAngle(segment, value));
            }}
          />
        </div>
        <details className="composer-property-details">
          <summary>Endpoint coordinates</summary>
          <div className="composer-field-grid">
            <NumberField
              label="Start X"
              value={Number(segment.start.x.toFixed(1))}
              step={0.5}
              onChange={(value) => {
                if (value !== '') onPatch(segment.id, { start: { ...segment.start, x: value } });
              }}
            />
            <NumberField
              label="Start Y"
              value={Number(segment.start.y.toFixed(1))}
              step={0.5}
              onChange={(value) => {
                if (value !== '') onPatch(segment.id, { start: { ...segment.start, y: value } });
              }}
            />
          </div>
          <div className="composer-field-grid">
            <NumberField
              label="End X"
              value={Number(segment.end.x.toFixed(1))}
              step={0.5}
              onChange={(value) => {
                if (value !== '') onPatch(segment.id, { end: { ...segment.end, x: value } });
              }}
            />
            <NumberField
              label="End Y"
              value={Number(segment.end.y.toFixed(1))}
              step={0.5}
              onChange={(value) => {
                if (value !== '') onPatch(segment.id, { end: { ...segment.end, y: value } });
              }}
            />
          </div>
        </details>
      </PropertyGroup>

      <PropertyGroup title="Pathology">
        <label className="field-label">
          <span>Type</span>
          <select
            className="text-input"
            value={segment.pathologyType}
            onChange={(event) =>
              onPatch(segment.id, { pathologyType: event.target.value as PathologyType })
            }
          >
            {PATHOLOGY_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <NumberField
          label="Severity %"
          value={segment.severityPercent ?? ''}
          allowBlank
          onChange={(value) => onPatch(segment.id, { severityPercent: value === '' ? null : value })}
        />
        <div className="composer-checkbox-grid">
          <label>
            <input
              type="checkbox"
              checked={segment.targetForIntervention}
              onChange={(event) =>
                onPatch(segment.id, { targetForIntervention: event.target.checked })
              }
            />
            <span>Intervention target</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={segment.treated}
              onChange={(event) => onPatch(segment.id, { treated: event.target.checked })}
            />
            <span>Treated</span>
          </label>
        </div>
      </PropertyGroup>

      <PropertyGroup title="Notes">
        <textarea
          className="text-input textarea compact"
          value={segment.notes ?? ''}
          onChange={(event) => onPatch(segment.id, { notes: event.target.value || undefined })}
          placeholder="Anatomical notes, calcification, tortuosity…"
        />
      </PropertyGroup>
    </div>
  );
}

function DevicePlacementPropertyEditor({
  placement,
  segments,
  devices,
  allDevices,
  fitWarnings,
  onPatch,
  onDeviceChange,
}: {
  placement: DevicePlacement;
  segments: VesselSegment[];
  devices: Device[];
  allDevices: Device[];
  fitWarnings: DeviceFitWarning[];
  onPatch: (id: string, patch: Partial<DevicePlacement>) => void;
  onDeviceChange: (placement: DevicePlacement, deviceId: string) => void;
}) {
  const deviceOptions = devices.length > 0 ? devices : allDevices;
  const placementWarnings = fitWarnings.filter((warning) => warning.placementId === placement.id);
  return (
    <div className="composer-selection-card">
      <span className="composer-selection-pill device">device placement</span>

      <PropertyGroup title="Device">
        <label className="field-label">
          <span>Catalog device</span>
          <select
            className="text-input"
            value={placement.deviceId}
            onChange={(event) => onDeviceChange(placement, event.target.value)}
          >
            {deviceOptions.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field-label">
          <span>Placement label</span>
          <input
            className="text-input"
            value={placement.label}
            onChange={(event) => onPatch(placement.id, { label: event.target.value })}
          />
        </label>
        <p className="muted small">
          {placement.deviceName}
          {placement.deviceManufacturer ? ` / ${placement.deviceManufacturer}` : ''}
          {placement.deviceCategory ? ` / ${placement.deviceCategory}` : ''}
        </p>
      </PropertyGroup>

      <PropertyGroup title="Position">
        <label className="field-label">
          <span>Attached segment</span>
          <select
            className="text-input"
            value={placement.segmentId}
            onChange={(event) => onPatch(placement.id, { segmentId: event.target.value })}
          >
            {segments.map((segment) => (
              <option key={segment.id} value={segment.id}>
                {segment.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field-label">
          <span>Position along segment ({Math.round(placement.t * 100)}%)</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={placement.t}
            onChange={(event) => onPatch(placement.id, { t: Number(event.target.value) })}
          />
        </label>
      </PropertyGroup>

      <PropertyGroup title="Fit check">
        <FitWarningList warnings={placementWarnings} />
      </PropertyGroup>

      <PropertyGroup title="Notes">
        <textarea
          className="text-input textarea compact"
          value={placement.notes ?? ''}
          onChange={(event) => onPatch(placement.id, { notes: event.target.value || undefined })}
          placeholder="Sizing rationale, deployment plan…"
        />
      </PropertyGroup>
    </div>
  );
}

function TreatmentMarkerPropertyEditor({
  marker,
  segments,
  onPatch,
}: {
  marker: TreatmentMarker;
  segments: VesselSegment[];
  onPatch: (id: string, patch: Partial<TreatmentMarker>) => void;
}) {
  return (
    <div className="composer-selection-card">
      <span className="composer-selection-pill marker">treatment marker</span>

      <PropertyGroup title="Marker">
        <label className="field-label">
          <span>Type</span>
          <select
            className="text-input"
            value={marker.markerType}
            onChange={(event) => {
              const nextType = event.target.value as TreatmentMarkerType;
              onPatch(marker.id, {
                markerType: nextType,
                label: treatmentMarkerLabel(nextType),
              });
            }}
          >
            {TREATMENT_MARKER_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </PropertyGroup>

      <PropertyGroup title="Position">
        <label className="field-label">
          <span>Attached segment</span>
          <select
            className="text-input"
            value={marker.segmentId}
            onChange={(event) => onPatch(marker.id, { segmentId: event.target.value })}
          >
            {segments.map((segment) => (
              <option key={segment.id} value={segment.id}>
                {segment.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field-label">
          <span>Position along segment ({Math.round(marker.t * 100)}%)</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={marker.t}
            onChange={(event) => onPatch(marker.id, { t: Number(event.target.value) })}
          />
        </label>
      </PropertyGroup>

      <PropertyGroup title="Notes">
        <textarea
          className="text-input textarea compact"
          value={marker.notes ?? ''}
          onChange={(event) => onPatch(marker.id, { notes: event.target.value || undefined })}
          placeholder="Anatomic landmark, fluoroscopy reference…"
        />
      </PropertyGroup>
    </div>
  );
}

function BifurcationPropertyEditor({
  node,
  segments,
  onPatch,
  onToggleChild,
}: {
  node: BifurcationNode;
  segments: VesselSegment[];
  onPatch: (id: string, patch: Partial<BifurcationNode>) => void;
  onToggleChild: (node: BifurcationNode, segmentId: string) => void;
}) {
  return (
    <div className="composer-selection-card">
      <span className="composer-selection-pill bifurcation">bifurcation</span>

      <PropertyGroup title="Identity">
        <label className="field-label">
          <span>Label</span>
          <input
            className="text-input"
            value={node.label}
            onChange={(event) => onPatch(node.id, { label: event.target.value })}
          />
        </label>
      </PropertyGroup>

      <PropertyGroup title="Branches">
        <label className="field-label">
          <span>Parent segment</span>
          <select
            className="text-input"
            value={node.parentSegmentId ?? ''}
            onChange={(event) =>
              onPatch(node.id, {
                parentSegmentId: event.target.value || null,
                childSegmentIds: node.childSegmentIds.filter((id) => id !== event.target.value),
              })
            }
          >
            <option value="">No parent</option>
            {segments.map((segment) => (
              <option key={segment.id} value={segment.id}>
                {segment.label}
              </option>
            ))}
          </select>
        </label>
        <div className="field-label">
          <span>Child branches</span>
          <div className="composer-relation-list">
            {segments.length === 0 ? (
              <span className="muted small">Add segments to attach branches.</span>
            ) : (
              segments.map((segment) => (
                <label key={segment.id} className="composer-relation-row">
                  <input
                    type="checkbox"
                    checked={node.childSegmentIds.includes(segment.id)}
                    disabled={node.parentSegmentId === segment.id}
                    onChange={() => onToggleChild(node, segment.id)}
                  />
                  <span>{segment.label}</span>
                </label>
              ))
            )}
          </div>
        </div>
      </PropertyGroup>

      <PropertyGroup title="Notes">
        <textarea
          className="text-input textarea compact"
          value={node.notes ?? ''}
          onChange={(event) => onPatch(node.id, { notes: event.target.value || undefined })}
          placeholder="Origin, angulation, calcium burden…"
        />
      </PropertyGroup>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  allowBlank = false,
  step = 1,
  min,
  max,
}: {
  label: string;
  value: number | '';
  onChange: (value: number | '') => void;
  allowBlank?: boolean;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <label className="field-label">
      <span>{label}</span>
      <input
        type="number"
        className="text-input"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(event) => {
          if (allowBlank && event.target.value === '') {
            onChange('');
            return;
          }
          onChange(Number(event.target.value));
        }}
      />
    </label>
  );
}

function SegmentSvg({
  segment,
  selected,
  hovered,
  layout,
  onPointerDown,
  onHoverChange,
}: {
  segment: VesselSegment;
  selected: boolean;
  hovered: boolean;
  layout: LabelLayoutEntry | null;
  onPointerDown: (event: ReactPointerEvent<SVGGElement>, segment: VesselSegment) => void;
  onHoverChange: (id: string | null) => void;
}) {
  const preset = getVesselPreset(segment.vesselType);
  const avgDiameter = (segment.proximalDiameterMm + segment.distalDiameterMm) / 2;
  const strokeWidth = clamp(5 + avgDiameter / 2.6, 7, 18);
  const primary = layout?.primary;
  const secondary = layout?.secondary;
  const className = [
    'composer-object',
    selected ? 'selected' : '',
    hovered ? 'hovered' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <g
      className={className}
      onPointerDown={(event) => onPointerDown(event, segment)}
      onPointerEnter={() => onHoverChange(segment.id)}
      onPointerLeave={() => onHoverChange(null)}
    >
      <line
        className="composer-hit-line"
        x1={segment.start.x}
        y1={segment.start.y}
        x2={segment.end.x}
        y2={segment.end.y}
      />
      <line
        className={`composer-vessel-line vessel-${preset.strokeClass} pathology-${segment.pathologyType}${segment.targetForIntervention ? ' intervention-target' : ''}${segment.treated ? ' treated' : ''}`}
        x1={segment.start.x}
        y1={segment.start.y}
        x2={segment.end.x}
        y2={segment.end.y}
        strokeWidth={strokeWidth}
      />
      {segment.pathologyType === 'stenosis' && primary ? (
        <circle className="composer-pathology-glyph stenosis" cx={primary.x} cy={primary.y - 2} r="9" />
      ) : null}
      {segment.pathologyType === 'occlusion' && primary ? (
        <line
          className="composer-pathology-glyph occlusion"
          x1={primary.x - 11}
          y1={primary.y - 11}
          x2={primary.x + 11}
          y2={primary.y + 11}
        />
      ) : null}
      <line
        className="composer-centerline"
        x1={segment.start.x}
        y1={segment.start.y}
        x2={segment.end.x}
        y2={segment.end.y}
      />
      <circle className="composer-endpoint" cx={segment.start.x} cy={segment.start.y} r="5" />
      <circle className="composer-endpoint" cx={segment.end.x} cy={segment.end.y} r="5" />
      {primary && (
        <text
          className="composer-label"
          x={primary.x}
          y={primary.y}
          textAnchor={primary.anchor}
        >
          {segment.label}
        </text>
      )}
      {secondary && (
        <text
          className="composer-sub-label"
          x={secondary.x}
          y={secondary.y}
          textAnchor={secondary.anchor}
        >
          {segment.proximalDiameterMm}/{segment.distalDiameterMm} mm · {segment.lengthMm} mm
        </text>
      )}
    </g>
  );
}

function BifurcationLinks({
  node,
  segments,
}: {
  node: BifurcationNode;
  segments: VesselSegment[];
}) {
  const linkedIds = [
    ...(node.parentSegmentId ? [node.parentSegmentId] : []),
    ...node.childSegmentIds,
  ];
  return (
    <g className="composer-bifurcation-links">
      {linkedIds.map((segmentId) => {
        const segment = segments.find((item) => item.id === segmentId);
        if (!segment) return null;
        const target = projectPointToSegment(node.position, segment).point;
        return (
          <line
            key={`${node.id}-${segmentId}`}
            x1={node.position.x}
            y1={node.position.y}
            x2={target.x}
            y2={target.y}
          />
        );
      })}
    </g>
  );
}

function BifurcationSvg({
  node,
  selected,
  hovered,
  onPointerDown,
  onHoverChange,
}: {
  node: BifurcationNode;
  selected: boolean;
  hovered: boolean;
  onPointerDown: (event: ReactPointerEvent<SVGGElement>, id: string) => void;
  onHoverChange: (id: string | null) => void;
}) {
  const className = [
    'composer-object',
    selected ? 'selected' : '',
    hovered ? 'hovered' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <g
      className={className}
      onPointerDown={(event) => onPointerDown(event, node.id)}
      onPointerEnter={() => onHoverChange(node.id)}
      onPointerLeave={() => onHoverChange(null)}
    >
      <circle className="composer-node-hit" cx={node.position.x} cy={node.position.y} r="22" />
      <circle className="composer-node" cx={node.position.x} cy={node.position.y} r="11" />
      <text className="composer-label" x={node.position.x} y={node.position.y - 20} textAnchor="middle">
        {node.label}
      </text>
    </g>
  );
}

function DevicePlacementSvg({
  placement,
  point,
  selected,
  hovered,
  onPointerDown,
  onHoverChange,
}: {
  placement: DevicePlacement;
  point: ComposerPoint;
  selected: boolean;
  hovered: boolean;
  onPointerDown: (event: ReactPointerEvent<SVGGElement>, id: string) => void;
  onHoverChange: (id: string | null) => void;
}) {
  const className = [
    'composer-marker',
    selected ? 'selected' : '',
    hovered ? 'hovered' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <g
      className={className}
      transform={`translate(${point.x} ${point.y})`}
      onPointerDown={(event) => onPointerDown(event, placement.id)}
      onPointerEnter={() => onHoverChange(placement.id)}
      onPointerLeave={() => onHoverChange(null)}
    >
      <circle r="11" />
      <path d="M -5 0 L 0 -6 L 5 0 L 0 6 Z" />
      <text x="16" y="5">
        {placement.label || placement.deviceName}
      </text>
    </g>
  );
}

function TreatmentMarkerSvg({
  marker,
  point,
  selected,
  hovered,
  onPointerDown,
  onHoverChange,
}: {
  marker: TreatmentMarker;
  point: ComposerPoint;
  selected: boolean;
  hovered: boolean;
  onPointerDown: (event: ReactPointerEvent<SVGGElement>, id: string) => void;
  onHoverChange: (id: string | null) => void;
}) {
  const className = [
    'composer-treatment-marker',
    `marker-${marker.markerType}`,
    selected ? 'selected' : '',
    hovered ? 'hovered' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <g
      className={className}
      transform={`translate(${point.x} ${point.y})`}
      onPointerDown={(event) => onPointerDown(event, marker.id)}
      onPointerEnter={() => onHoverChange(marker.id)}
      onPointerLeave={() => onHoverChange(null)}
    >
      <line x1="0" y1="-15" x2="0" y2="15" />
      <circle r="6" />
      <text x="12" y="-10">
        {treatmentMarkerLabel(marker.markerType)}
      </text>
    </g>
  );
}

function moveSegment(
  original: VesselSegment,
  dx: number,
  dy: number,
  snap: boolean,
): VesselSegment {
  const newStart = translatePoint(original.start, dx, dy);
  const newEnd = translatePoint(original.end, dx, dy);
  if (snap) {
    const snappedStart: ComposerPoint = {
      x: clamp(snapToGrid(newStart.x, GRID_SIZE), 0, WORKSPACE_WIDTH),
      y: clamp(snapToGrid(newStart.y, GRID_SIZE), 0, WORKSPACE_HEIGHT),
    };
    const offsetX = snappedStart.x - newStart.x;
    const offsetY = snappedStart.y - newStart.y;
    return {
      ...original,
      start: snappedStart,
      end: translatePoint(newEnd, offsetX, offsetY),
    };
  }
  return {
    ...original,
    start: newStart,
    end: newEnd,
  };
}

function resizeSegmentToLength(segment: VesselSegment, lengthMm: number): VesselSegment {
  if (!Number.isFinite(lengthMm) || lengthMm <= 0) return segment;
  const dx = segment.end.x - segment.start.x;
  const dy = segment.end.y - segment.start.y;
  const currentLength = Math.hypot(dx, dy);
  const unit =
    currentLength > 0.001
      ? { x: dx / currentLength, y: dy / currentLength }
      : { x: 0, y: 1 };
  return {
    ...segment,
    lengthMm,
    end: {
      x: segment.start.x + unit.x * lengthMm,
      y: segment.start.y + unit.y * lengthMm,
    },
  };
}

function segmentAngleDeg(segment: VesselSegment): number {
  const radians = Math.atan2(segment.end.y - segment.start.y, segment.end.x - segment.start.x);
  const degrees = (radians * 180) / Math.PI;
  return Number(degrees.toFixed(1));
}

function rotateSegmentToAngle(segment: VesselSegment, angleDeg: number): Partial<VesselSegment> {
  if (!Number.isFinite(angleDeg)) return {};
  const radians = (angleDeg * Math.PI) / 180;
  const length = segment.lengthMm > 0 ? segment.lengthMm : distance(segment.start, segment.end);
  return {
    end: {
      x: segment.start.x + Math.cos(radians) * length,
      y: segment.start.y + Math.sin(radians) * length,
    },
    lengthMm: Number(length.toFixed(1)),
  };
}

function moveBifurcation(
  original: BifurcationNode,
  dx: number,
  dy: number,
  snap: boolean,
): BifurcationNode {
  const moved = translatePoint(original.position, dx, dy);
  return {
    ...original,
    position: snap
      ? {
          x: clamp(snapToGrid(moved.x, GRID_SIZE), 0, WORKSPACE_WIDTH),
          y: clamp(snapToGrid(moved.y, GRID_SIZE), 0, WORKSPACE_HEIGHT),
        }
      : moved,
  };
}

function moveDevicePlacement(
  original: DevicePlacement,
  dx: number,
  dy: number,
  segments: VesselSegment[],
): DevicePlacement {
  const segment = segments.find((item) => item.id === original.segmentId);
  const currentPoint = segment ? interpolateSegment(segment, original.t) : { x: 0, y: 0 };
  const desired = translatePoint(currentPoint, dx, dy);
  const projection = nearestSegmentProjection(desired, segments);
  if (!projection) return original;
  return {
    ...original,
    segmentId: projection.segment.id,
    t: snapNormalizedT(projection.t, 0.025),
  };
}

function moveTreatmentMarker(
  original: TreatmentMarker,
  dx: number,
  dy: number,
  segments: VesselSegment[],
): TreatmentMarker {
  const segment = segments.find((item) => item.id === original.segmentId);
  const currentPoint = segment ? interpolateSegment(segment, original.t) : { x: 0, y: 0 };
  const desired = translatePoint(currentPoint, dx, dy);
  const projection = nearestSegmentProjection(desired, segments);
  if (!projection) return original;
  return {
    ...original,
    segmentId: projection.segment.id,
    t: snapNormalizedT(projection.t, 0.025),
  };
}

function findPlanningEntity(
  id: string,
  segments: VesselSegment[],
  bifurcations: BifurcationNode[],
  placements: DevicePlacement[],
  markers: TreatmentMarker[],
): VascularPlanningEntity | null {
  return (
    segments.find((segment) => segment.id === id) ??
    bifurcations.find((node) => node.id === id) ??
    placements.find((placement) => placement.id === id) ??
    markers.find((marker) => marker.id === id) ??
    null
  );
}

function translatePoint(point: ComposerPoint, dx: number, dy: number): ComposerPoint {
  return {
    x: clamp(point.x + dx, 0, WORKSPACE_WIDTH),
    y: clamp(point.y + dy, 0, WORKSPACE_HEIGHT),
  };
}

function projectPointToSegment(point: ComposerPoint, segment: VesselSegment): SegmentProjection {
  const dx = segment.end.x - segment.start.x;
  const dy = segment.end.y - segment.start.y;
  const lengthSquared = dx * dx + dy * dy;
  const rawT = lengthSquared === 0
    ? 0
    : ((point.x - segment.start.x) * dx + (point.y - segment.start.y) * dy) / lengthSquared;
  const t = clamp(rawT, 0, 1);
  const projected = interpolateSegment(segment, t);
  return {
    segment,
    point: projected,
    t,
    distance: distance(point, projected),
  };
}

function nearestSegmentProjection(
  point: ComposerPoint,
  segments: VesselSegment[],
): SegmentProjection | null {
  let best: SegmentProjection | null = null;
  for (const segment of segments) {
    const projection = projectPointToSegment(point, segment);
    if (!best || projection.distance < best.distance) best = projection;
  }
  return best;
}

function interpolateSegment(segment: VesselSegment, t: number): ComposerPoint {
  return {
    x: segment.start.x + (segment.end.x - segment.start.x) * t,
    y: segment.start.y + (segment.end.y - segment.start.y) * t,
  };
}

function buildFitWarnings(
  placements: DevicePlacement[],
  segments: VesselSegment[],
  devices: Device[],
): DeviceFitWarning[] {
  return placements.flatMap((placement) =>
    assessDeviceFit(
      placement,
      segments.find((segment) => segment.id === placement.segmentId),
      devices.find((device) => device.id === placement.deviceId),
    ),
  );
}

function prettyPathology(segment: VesselSegment): string {
  const bits: string[] = [segment.pathologyType];
  if (segment.severityPercent !== undefined && segment.severityPercent !== null) {
    bits.push(`${segment.severityPercent}%`);
  }
  if (segment.targetForIntervention) bits.push('target');
  if (segment.treated) bits.push('treated');
  return bits.join(' / ');
}

function landingZoneSummary(segment: VesselSegment, markers: TreatmentMarker[]): string {
  const segmentMarkers = markers.filter((marker) => marker.segmentId === segment.id);
  const hasProximal = segmentMarkers.some((marker) => marker.markerType === 'proximalLandingZone');
  const hasDistal = segmentMarkers.some((marker) => marker.markerType === 'distalLandingZone');
  if (hasProximal && hasDistal) return 'landing zones complete';
  if (hasProximal) return 'distal LZ missing';
  if (hasDistal) return 'proximal LZ missing';
  return 'landing zones missing';
}

function distance(a: ComposerPoint, b: ComposerPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function shortDeviceLabel(device: Device): string {
  if (device.name.length <= 24) return device.name;
  const words = device.name.split(/\s+/).filter(Boolean);
  return words.slice(0, 3).join(' ') || device.name.slice(0, 24);
}

function makeId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function setComposerDragSelectionSuppressed(active: boolean) {
  if (typeof document === 'undefined') return;
  document.body.classList.toggle('composer-dragging', active);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function relayoutTemplateBranches(
  template: Pick<
    VesselCompositionData,
    'metadata' | 'segments' | 'bifurcations' | 'devicePlacements' | 'treatmentMarkers'
  >,
): Pick<
  VesselCompositionData,
  'metadata' | 'segments' | 'bifurcations' | 'devicePlacements' | 'treatmentMarkers'
> {
  const updatedSegments = template.segments.map((segment) => ({ ...segment }));

  for (const bifurcation of template.bifurcations) {
    const children = bifurcation.childSegmentIds
      .map((id) => updatedSegments.find((segment) => segment.id === id))
      .filter((segment): segment is VesselSegment => Boolean(segment));
    if (children.length < 2) continue;

    const center = bifurcation.position;
    children.sort((a, b) => {
      const angleA = Math.atan2(a.end.y - center.y, a.end.x - center.x);
      const angleB = Math.atan2(b.end.y - center.y, b.end.x - center.x);
      return angleA - angleB;
    });

    const minSpacing = 0.32;
    for (let i = 1; i < children.length; i++) {
      const prev = children[i - 1];
      const curr = children[i];
      const angleA = Math.atan2(prev.end.y - center.y, prev.end.x - center.x);
      const angleB = Math.atan2(curr.end.y - center.y, curr.end.x - center.x);
      const delta = angleB - angleA;
      if (Math.abs(delta) < minSpacing) {
        const additional = minSpacing - Math.abs(delta);
        const sign = delta >= 0 ? 1 : -1;
        const length = Math.hypot(curr.end.x - center.x, curr.end.y - center.y) || 1;
        const newAngle = angleB + sign * additional;
        curr.end = {
          x: clamp(center.x + Math.cos(newAngle) * length, 24, WORKSPACE_WIDTH - 24),
          y: clamp(center.y + Math.sin(newAngle) * length, 24, WORKSPACE_HEIGHT - 24),
        };
        curr.start = { x: center.x, y: center.y };
      }
    }
  }

  return { ...template, segments: updatedSegments };
}
