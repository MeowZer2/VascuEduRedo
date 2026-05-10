import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { listDevices, type Device } from '../../lib/devices';
import {
  ANATOMY_TEMPLATES,
  PATHOLOGY_OPTIONS,
  TREATMENT_MARKER_OPTIONS,
  VESSEL_PRESETS,
  assessDeviceFit,
  createAnatomyTemplateData,
  devicePlacementFromDevice,
  emptyVesselCompositionData,
  getVesselComposition,
  getVesselPreset,
  listVesselCompositions,
  makeSegmentFromPreset,
  makeTreatmentMarker,
  saveVesselComposition,
  treatmentMarkerLabel,
  validateVesselCompositionData,
  type AnatomyTemplate,
  type BifurcationNode,
  type ComposerPoint,
  type DeviceFitWarning,
  type DevicePlacement,
  type PathologyType,
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

type ComposerTool = 'select' | 'segment' | 'bifurcation' | 'device' | 'marker';

interface VesselComposerPageProps {
  cases: VascCase[];
  initialCaseId: string | null;
  onOpenCase: (caseId: string) => void;
}

interface DragState {
  id: string;
  startPointer: ComposerPoint;
  original: VascularPlanningEntity;
}

interface SegmentProjection {
  segment: VesselSegment;
  point: ComposerPoint;
  t: number;
  distance: number;
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
    return devices.filter((device) => {
      return (
        device.name.toLowerCase().includes(needle) ||
        device.manufacturer.toLowerCase().includes(needle) ||
        device.category.toLowerCase().includes(needle)
      );
    });
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

  useEffect(() => {
    let cancelled = false;
    void listDevices().then((rows) => {
      if (cancelled) return;
      setDevices(rows);
      setSelectedDeviceId((current) => current || rows[0]?.id || '');
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
        const linked = initialCaseId
          ? rows.find((row) => row.caseId === initialCaseId)
          : rows[0] ?? null;
        if (linked) {
          applyComposition(linked);
          setStatus(initialCaseId ? 'Loaded linked vessel plan.' : null);
        } else {
          startNewComposition(initialCaseId ?? '');
        }
      } catch (e) {
        if (!cancelled) setError(messageFromError(e));
      }
    }
    void boot();
    return () => {
      cancelled = true;
    };
    // The initial case is the navigation payload. Case list changes should not reload an open draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCaseId]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest('input, textarea, select')) return;
      if (!selectedId) return;
      event.preventDefault();
      deleteSelected();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, selectedObject]);

  useEffect(() => {
    return () => setComposerDragSelectionSuppressed(false);
  }, []);

  useEffect(() => {
    if (tool !== 'segment') setPendingSegmentStart(null);
  }, [tool]);

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
      // Best-effort cleanup; selection suppression is still restored below.
    }
  }

  function applyComposition(row: VesselCompositionRow) {
    setCompositionId(row.id);
    setCompositionName(row.name);
    setCaseId(row.caseId ?? '');
    setSegments(row.data.segments);
    setBifurcations(row.data.bifurcations);
    setDevicePlacements(row.data.devicePlacements);
    setTreatmentMarkers(row.data.treatmentMarkers);
    setCompositionMetadata(row.data.metadata ?? {});
    setPendingSegmentStart(null);
    setSelectedId(null);
    setLoadId(row.id);
    setError(null);
  }

  function startNewComposition(nextCaseId = caseId) {
    const targetCase = cases.find((item) => item.id === nextCaseId);
    setCompositionId(null);
    setCompositionName(targetCase ? `${targetCase.title} vessel plan` : 'Untitled vessel plan');
    setCaseId(nextCaseId);
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
  }

  async function refreshSavedRows(): Promise<VesselCompositionRow[]> {
    const rows = await listVesselCompositions();
    setSavedRows(rows);
    return rows;
  }

  async function handleSave() {
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

  function handleCanvasPointerDown(event: ReactPointerEvent<SVGRectElement>) {
    event.preventDefault();
    const point = svgPoint(event);
    if (tool === 'segment') {
      handleSegmentCanvasClick(point);
      return;
    }
    if (tool === 'bifurcation') {
      addBifurcationAt(point);
      return;
    }
    if (tool === 'device') {
      setStatus('Select a vessel segment for device placement.');
      setError(null);
      return;
    }
    if (tool === 'marker') {
      setStatus('Select a vessel segment for treatment marker placement.');
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
      handleSegmentCanvasClick(point);
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
    setDrag({ id, startPointer: point, original });
  }

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if (!drag) return;
    event.preventDefault();
    const point = svgPoint(event);
    const dx = point.x - drag.startPointer.x;
    const dy = point.y - drag.startPointer.y;
    if (drag.original.type === 'segment') {
      setSegments((current) =>
        current.map((segment) =>
          segment.id === drag.id ? moveSegment(drag.original as VesselSegment, dx, dy) : segment,
        ),
      );
    } else if (drag.original.type === 'bifurcation') {
      setBifurcations((current) =>
        current.map((node) =>
          node.id === drag.id ? moveBifurcation(drag.original as BifurcationNode, dx, dy) : node,
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
    const template = createAnatomyTemplateData(templateId, makeId);
    const templateInfo = ANATOMY_TEMPLATES.find((item) => item.id === templateId);
    setCompositionId(null);
    setSegments(template.segments);
    setBifurcations(template.bifurcations);
    setDevicePlacements(template.devicePlacements);
    setTreatmentMarkers(template.treatmentMarkers);
    setCompositionMetadata(template.metadata);
    setPendingSegmentStart(null);
    setSelectedId(template.segments[0]?.id ?? null);
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
      setStatus('Segment start set. Click the end point to define direction and length.');
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
    const id = makeId('bifurcation');
    const nearest = nearestSegmentProjection(point, segments);
    const parent = nearest && nearest.distance < 120 ? nearest.segment : null;
    const node: BifurcationNode = {
      id,
      type: 'bifurcation',
      label: parent ? `${parent.label} bifurcation` : `Bifurcation ${bifurcations.length + 1}`,
      position: {
        x: clamp(point.x, 40, WORKSPACE_WIDTH - 40),
        y: clamp(point.y, 40, WORKSPACE_HEIGHT - 40),
      },
      parentSegmentId: parent?.id ?? null,
      childSegmentIds: [],
    };
    setBifurcations((current) => [...current, node]);
    setSelectedId(id);
    setTool('select');
    setStatus('Bifurcation relationship added.');
    setError(null);
  }

  function addDevicePlacement(segment: VesselSegment, point: ComposerPoint) {
    if (!selectedDevice) {
      setError('Choose a catalog device before placing it on a vessel segment.');
      setStatus(null);
      return;
    }
    const projection = projectPointToSegment(point, segment);
    const placement = devicePlacementFromDevice(
      makeId('device'),
      selectedDevice,
      segment.id,
      projection.t,
    );
    setDevicePlacements((current) => [...current, placement]);
    setSelectedId(placement.id);
    setTool('select');
    setStatus(`Placed ${selectedDevice.name} on ${segment.label}.`);
    setError(null);
  }

  function addTreatmentMarker(segment: VesselSegment, point: ComposerPoint) {
    const projection = projectPointToSegment(point, segment);
    const marker = makeTreatmentMarker(makeId('marker'), markerType, segment.id, projection.t);
    setTreatmentMarkers((current) => [...current, marker]);
    setSelectedId(marker.id);
    setTool('select');
    setStatus(`${marker.label} added to ${segment.label}.`);
    setError(null);
  }

  function deleteSelected() {
    if (!selectedObject) return;
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

  function duplicateSelectedSegment() {
    if (!selectedObject || selectedObject.type !== 'segment') return;
    const source = selectedObject;
    const id = makeId('segment');
    const duplicate: VesselSegment = {
      ...source,
      id,
      label: `${source.label} copy`,
      start: translatePoint(source.start, 28, 28),
      end: translatePoint(source.end, 28, 28),
      metadata: source.metadata ? { ...source.metadata } : undefined,
    };
    setSegments((current) => [...current, duplicate]);
    setSelectedId(id);
    setTool('select');
    setPendingSegmentStart(null);
    setStatus(`${source.label} duplicated.`);
    setError(null);
  }

  function patchSegment(id: string, patch: Partial<VesselSegment>) {
    setSegments((current) =>
      current.map((segment) => {
        if (segment.id !== id) return segment;
        const next = { ...segment, ...patch };
        if (patch.lengthMm !== undefined && patch.start === undefined && patch.end === undefined) {
          return resizeSegmentToLength(next, patch.lengthMm);
        }
        return next;
      }),
    );
  }

  function patchBifurcation(id: string, patch: Partial<BifurcationNode>) {
    setBifurcations((current) =>
      current.map((node) => (node.id === id ? { ...node, ...patch } : node)),
    );
  }

  function patchDevicePlacement(id: string, patch: Partial<DevicePlacement>) {
    setDevicePlacements((current) =>
      current.map((placement) => (placement.id === id ? { ...placement, ...patch } : placement)),
    );
  }

  function patchTreatmentMarker(id: string, patch: Partial<TreatmentMarker>) {
    setTreatmentMarkers((current) =>
      current.map((marker) => (marker.id === id ? { ...marker, ...patch } : marker)),
    );
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

  const toolButtons: Array<{ id: ComposerTool; label: string; disabled?: boolean }> = [
    { id: 'select', label: 'Select' },
    { id: 'segment', label: 'Add Segment' },
    { id: 'bifurcation', label: 'Add Bifurcation' },
    {
      id: 'device',
      label: 'Add Device',
      disabled: devices.length === 0 || segments.length === 0,
    },
    {
      id: 'marker',
      label: 'Add Marker',
      disabled: segments.length === 0,
    },
  ];

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
            New
          </button>
        </div>
      </header>

      <section className="composer-toolbar" aria-label="Vessel composer tools">
        <div className="tool-tabs">
          {toolButtons.map((item) => (
            <button
              key={item.id}
              type="button"
              className={tool === item.id ? 'tool-tab active' : 'tool-tab'}
              onClick={() => setTool(item.id)}
              disabled={item.disabled}
            >
              {item.label}
            </button>
          ))}
        </div>
        <select
          className="text-input small composer-template-select"
          value={templateId}
          onChange={(event) => setTemplateId(event.target.value as AnatomyTemplate['id'])}
          title="Anatomy template"
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
          Apply Template
        </button>
        <select
          className="text-input small composer-preset-select"
          value={segmentPresetId}
          onChange={(event) => setSegmentPresetId(event.target.value)}
          title="Segment preset"
        >
          {VESSEL_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
        </select>
        <select
          className="text-input small composer-marker-select"
          value={markerType}
          onChange={(event) => setMarkerType(event.target.value as TreatmentMarkerType)}
          title="Treatment marker"
        >
          {TREATMENT_MARKER_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="secondary-button small"
          onClick={duplicateSelectedSegment}
          disabled={!selectedObject || selectedObject.type !== 'segment' || busy}
        >
          Duplicate Segment
        </button>
        <button
          type="button"
          className="secondary-button small"
          onClick={deleteSelected}
          disabled={!selectedId || busy}
        >
          Delete Selected
        </button>
        <button type="button" className="primary-button" onClick={() => void handleSave()} disabled={busy}>
          Save
        </button>
        <select
          className="text-input small composer-load-select"
          value={loadId}
          onChange={(event) => setLoadId(event.target.value)}
          disabled={savedRows.length === 0 || busy}
        >
          <option value="">Saved plans</option>
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
      </section>

      {(status || error) && (
        <div className={error ? 'admin-banner error' : 'admin-banner success'} role="status">
          {error ?? status}
        </div>
      )}

      <section className="composer-layout">
        <aside className="composer-side-panel">
          <section>
            <h3>Composition</h3>
            <label className="field-label">
              <span>Name</span>
              <input
                className="text-input"
                value={compositionName}
                onChange={(event) => setCompositionName(event.target.value)}
              />
            </label>
            <label className="field-label">
              <span>Linked case</span>
              <select
                className="text-input"
                value={caseId}
                onChange={(event) => setCaseId(event.target.value)}
              >
                <option value="">No case link</option>
                {cases.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
          </section>

          <section>
            <h3>Catalog device</h3>
            <input
              className="text-input"
              type="search"
              placeholder="Filter devices"
              value={deviceSearch}
              onChange={(event) => setDeviceSearch(event.target.value)}
            />
            <label className="field-label">
              <span>Device</span>
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
            </label>
            {selectedDevice && (
              <p className="muted small">
                {selectedDevice.manufacturer} / {selectedDevice.category}
              </p>
            )}
          </section>

          <PlanSummaryPanel
            linkedCaseTitle={selectedCase?.title ?? null}
            segments={segments}
            devicePlacements={devicePlacements}
            treatmentMarkers={treatmentMarkers}
            fitWarnings={fitWarnings}
            notes={typeof compositionMetadata.notes === 'string' ? compositionMetadata.notes : ''}
            onNotesChange={(notes) =>
              setCompositionMetadata((current) => ({ ...current, notes }))
            }
          />

          <PlanHealth issues={validationIssues} />

          <section>
            <h3>Properties</h3>
            {selectedObject ? (
              <PropertyEditor
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
              <p className="muted small">No vessel object selected.</p>
            )}
          </section>
        </aside>

        <div className="composer-canvas-panel">
          <header className="composer-canvas-header">
            <div>
              <strong>{compositionName || 'Untitled vessel plan'}</strong>
              <span>{selectedCase ? selectedCase.title : 'Unlinked composition'}</span>
            </div>
            <span className="pill">
              {segments.length} segment{segments.length === 1 ? '' : 's'} / {devicePlacements.length} device
              {devicePlacements.length === 1 ? '' : 's'}
            </span>
          </header>

          <svg
            ref={svgRef}
            className="vessel-composer-svg"
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
                onPointerDown={handleSegmentPointerDown}
              />
            ))}

            {bifurcations.map((node) => (
              <BifurcationSvg
                key={node.id}
                node={node}
                selected={selectedId === node.id}
                onPointerDown={handleObjectPointerDown}
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
                  onPointerDown={handleObjectPointerDown}
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
                  onPointerDown={handleObjectPointerDown}
                />
              );
            })}
          </svg>
        </div>
      </section>
    </div>
  );
}

function PlanSummaryPanel({
  linkedCaseTitle,
  segments,
  devicePlacements,
  treatmentMarkers,
  fitWarnings,
  notes,
  onNotesChange,
}: {
  linkedCaseTitle: string | null;
  segments: VesselSegment[];
  devicePlacements: DevicePlacement[];
  treatmentMarkers: TreatmentMarker[];
  fitWarnings: DeviceFitWarning[];
  notes: string;
  onNotesChange: (notes: string) => void;
}) {
  const pathologicSegments = segments.filter(
    (segment) => segment.pathologyType !== 'normal' || segment.targetForIntervention,
  );
  const landingSummary = segments.filter(
    (segment) => segment.pathologyType !== 'normal' || segment.targetForIntervention,
  );

  return (
    <section>
      <h3>Plan summary</h3>
      <div className="composer-summary-card">
        <p className="muted small">
          <strong>Case:</strong> {linkedCaseTitle ?? 'Unlinked'}
        </p>
        <SummaryBlock title="Pathology">
          {pathologicSegments.length === 0 ? (
            <span className="muted small">No pathology marked.</span>
          ) : (
            pathologicSegments.map((segment) => (
              <span key={segment.id}>
                {segment.label}: {prettyPathology(segment)}
              </span>
            ))
          )}
        </SummaryBlock>
        <SummaryBlock title="Devices">
          {devicePlacements.length === 0 ? (
            <span className="muted small">No devices placed.</span>
          ) : (
            devicePlacements.map((placement) => <span key={placement.id}>{placement.label}</span>)
          )}
        </SummaryBlock>
        <SummaryBlock title="Landing zones">
          {landingSummary.length === 0 ? (
            <span className="muted small">No intervention target selected.</span>
          ) : (
            landingSummary.map((segment) => (
              <span key={segment.id}>{segment.label}: {landingZoneSummary(segment, treatmentMarkers)}</span>
            ))
          )}
        </SummaryBlock>
        {fitWarnings.length > 0 && (
          <SummaryBlock title="Fit warnings">
            {fitWarnings.slice(0, 4).map((warning, index) => (
              <span key={`${warning.placementId}-${index}`}>{warning.message}</span>
            ))}
          </SummaryBlock>
        )}
        <label className="field-label">
          <span>Procedure notes</span>
          <textarea
            className="text-input textarea compact"
            value={notes}
            onChange={(event) => onNotesChange(event.target.value)}
          />
        </label>
      </div>
    </section>
  );
}

function SummaryBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="composer-summary-block">
      <strong>{title}</strong>
      <div>{children}</div>
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
      <div className="composer-selection-card">
        <span className="measurement-type-pill">vessel segment</span>
        <label className="field-label">
          <span>Label</span>
          <input
            className="text-input"
            value={selected.label}
            onChange={(event) => onPatchSegment(selected.id, { label: event.target.value })}
          />
        </label>
        <label className="field-label">
          <span>Preset</span>
          <select
            className="text-input"
            value={getVesselPreset(selected.vesselType).id}
            onChange={(event) => onSegmentPresetChange(selected, event.target.value)}
          >
            {VESSEL_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field-label">
          <span>Vessel type/name</span>
          <input
            className="text-input"
            value={selected.vesselType}
            onChange={(event) => onPatchSegment(selected.id, { vesselType: event.target.value })}
          />
        </label>
        <div className="composer-field-grid">
          <NumberField
            label="Prox diameter mm"
            value={selected.proximalDiameterMm}
            onChange={(value) => {
              if (value !== '') onPatchSegment(selected.id, { proximalDiameterMm: value });
            }}
          />
          <NumberField
            label="Distal diameter mm"
            value={selected.distalDiameterMm}
            onChange={(value) => {
              if (value !== '') onPatchSegment(selected.id, { distalDiameterMm: value });
            }}
          />
        </div>
        <NumberField
          label="Length mm"
          value={selected.lengthMm}
          onChange={(value) => {
            if (value !== '') onPatchSegment(selected.id, { lengthMm: value });
          }}
        />
        <label className="field-label">
          <span>Pathology</span>
          <select
            className="text-input"
            value={selected.pathologyType}
            onChange={(event) =>
              onPatchSegment(selected.id, { pathologyType: event.target.value as PathologyType })
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
          value={selected.severityPercent ?? ''}
          allowBlank
          onChange={(value) => onPatchSegment(selected.id, { severityPercent: value === '' ? null : value })}
        />
        <div className="composer-checkbox-grid">
          <label>
            <input
              type="checkbox"
              checked={selected.treated}
              onChange={(event) => onPatchSegment(selected.id, { treated: event.target.checked })}
            />
            <span>Treated</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={selected.targetForIntervention}
              onChange={(event) =>
                onPatchSegment(selected.id, { targetForIntervention: event.target.checked })
              }
            />
            <span>Target</span>
          </label>
        </div>
        <label className="field-label">
          <span>Notes</span>
          <textarea
            className="text-input textarea compact"
            value={selected.notes ?? ''}
            onChange={(event) => onPatchSegment(selected.id, { notes: event.target.value || undefined })}
          />
        </label>
      </div>
    );
  }

  if (selected.type === 'devicePlacement') {
    const deviceOptions = devices.length > 0 ? devices : allDevices;
    return (
      <div className="composer-selection-card">
        <span className="measurement-type-pill">device placement</span>
        <label className="field-label">
          <span>Linked device</span>
          <select
            className="text-input"
            value={selected.deviceId}
            onChange={(event) => onPlacementDeviceChange(selected, event.target.value)}
          >
            {deviceOptions.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field-label">
          <span>Label</span>
          <input
            className="text-input"
            value={selected.label}
            onChange={(event) => onPatchDevicePlacement(selected.id, { label: event.target.value })}
          />
        </label>
        <label className="field-label">
          <span>Attached segment</span>
          <select
            className="text-input"
            value={selected.segmentId}
            onChange={(event) => onPatchDevicePlacement(selected.id, { segmentId: event.target.value })}
          >
            {segments.map((segment) => (
              <option key={segment.id} value={segment.id}>
                {segment.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field-label">
          <span>Position along segment</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={selected.t}
            onChange={(event) => onPatchDevicePlacement(selected.id, { t: Number(event.target.value) })}
          />
        </label>
        <NumberField
          label="Normalized position"
          value={selected.t}
          step={0.01}
          min={0}
          max={1}
          onChange={(value) => {
            if (value !== '') onPatchDevicePlacement(selected.id, { t: clamp(value, 0, 1) });
          }}
        />
        <p className="muted small">
          {selected.deviceName}
          {selected.deviceManufacturer ? ` / ${selected.deviceManufacturer}` : ''}
          {selected.deviceCategory ? ` / ${selected.deviceCategory}` : ''}
        </p>
        <FitWarningList warnings={fitWarnings.filter((warning) => warning.placementId === selected.id)} />
        <label className="field-label">
          <span>Notes</span>
          <textarea
            className="text-input textarea compact"
            value={selected.notes ?? ''}
            onChange={(event) => onPatchDevicePlacement(selected.id, { notes: event.target.value || undefined })}
          />
        </label>
      </div>
    );
  }

  if (selected.type === 'treatmentMarker') {
    return (
      <div className="composer-selection-card">
        <span className="measurement-type-pill">treatment marker</span>
        <label className="field-label">
          <span>Marker type</span>
          <select
            className="text-input"
            value={selected.markerType}
            onChange={(event) => {
              const nextType = event.target.value as TreatmentMarkerType;
              onPatchTreatmentMarker(selected.id, {
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
        <label className="field-label">
          <span>Attached segment</span>
          <select
            className="text-input"
            value={selected.segmentId}
            onChange={(event) => onPatchTreatmentMarker(selected.id, { segmentId: event.target.value })}
          >
            {segments.map((segment) => (
              <option key={segment.id} value={segment.id}>
                {segment.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field-label">
          <span>Position along segment</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={selected.t}
            onChange={(event) =>
              onPatchTreatmentMarker(selected.id, { t: Number(event.target.value) })
            }
          />
        </label>
        <NumberField
          label="Normalized position"
          value={selected.t}
          step={0.01}
          min={0}
          max={1}
          onChange={(value) => {
            if (value !== '') onPatchTreatmentMarker(selected.id, { t: clamp(value, 0, 1) });
          }}
        />
        <label className="field-label">
          <span>Notes</span>
          <textarea
            className="text-input textarea compact"
            value={selected.notes ?? ''}
            onChange={(event) =>
              onPatchTreatmentMarker(selected.id, { notes: event.target.value || undefined })
            }
          />
        </label>
      </div>
    );
  }

  return (
    <div className="composer-selection-card">
      <span className="measurement-type-pill">bifurcation</span>
      <label className="field-label">
        <span>Label</span>
        <input
          className="text-input"
          value={selected.label}
          onChange={(event) => onPatchBifurcation(selected.id, { label: event.target.value })}
        />
      </label>
      <label className="field-label">
        <span>Parent segment</span>
        <select
          className="text-input"
          value={selected.parentSegmentId ?? ''}
          onChange={(event) =>
            onPatchBifurcation(selected.id, {
              parentSegmentId: event.target.value || null,
              childSegmentIds: selected.childSegmentIds.filter((id) => id !== event.target.value),
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
          {segments.map((segment) => (
            <label key={segment.id} className="composer-relation-row">
              <input
                type="checkbox"
                checked={selected.childSegmentIds.includes(segment.id)}
                disabled={selected.parentSegmentId === segment.id}
                onChange={() => onToggleBifurcationChild(selected, segment.id)}
              />
              <span>{segment.label}</span>
            </label>
          ))}
        </div>
      </div>
      <label className="field-label">
        <span>Notes</span>
        <textarea
          className="text-input textarea compact"
          value={selected.notes ?? ''}
          onChange={(event) => onPatchBifurcation(selected.id, { notes: event.target.value || undefined })}
        />
      </label>
    </div>
  );
}

function PlanHealth({ issues }: { issues: PlanValidationIssue[] }) {
  if (issues.length === 0) {
    return (
      <section>
        <h3>Plan health</h3>
        <p className="muted small">No validation issues.</p>
      </section>
    );
  }
  return (
    <section>
      <h3>Plan health</h3>
      <ul className="composer-health-list">
        {issues.slice(0, 6).map((issue) => (
          <li key={`${issue.field}-${issue.message}`} className={issue.severity}>
            <strong>{issue.severity}</strong>
            <span>{issue.message}</span>
          </li>
        ))}
      </ul>
    </section>
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
  onPointerDown,
}: {
  segment: VesselSegment;
  selected: boolean;
  onPointerDown: (event: ReactPointerEvent<SVGGElement>, segment: VesselSegment) => void;
}) {
  const labelPoint = segmentLabelPoint(segment);
  const preset = getVesselPreset(segment.vesselType);
  const avgDiameter = (segment.proximalDiameterMm + segment.distalDiameterMm) / 2;
  const strokeWidth = clamp(5 + avgDiameter / 2.6, 7, 18);
  return (
    <g
      className={selected ? 'composer-object selected' : 'composer-object'}
      onPointerDown={(event) => onPointerDown(event, segment)}
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
      <line
        className="composer-centerline"
        x1={segment.start.x}
        y1={segment.start.y}
        x2={segment.end.x}
        y2={segment.end.y}
      />
      <circle className="composer-endpoint" cx={segment.start.x} cy={segment.start.y} r="5" />
      <circle className="composer-endpoint" cx={segment.end.x} cy={segment.end.y} r="5" />
      <text
        className="composer-label"
        x={labelPoint.x}
        y={labelPoint.y}
        textAnchor={labelPoint.anchor}
      >
        {segment.label}
      </text>
      <text
        className="composer-sub-label"
        x={labelPoint.x}
        y={labelPoint.y + 16}
        textAnchor={labelPoint.anchor}
      >
        {segment.proximalDiameterMm} / {segment.distalDiameterMm} mm - {segment.lengthMm} mm
      </text>
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
  onPointerDown,
}: {
  node: BifurcationNode;
  selected: boolean;
  onPointerDown: (event: ReactPointerEvent<SVGGElement>, id: string) => void;
}) {
  return (
    <g
      className={selected ? 'composer-object selected' : 'composer-object'}
      onPointerDown={(event) => onPointerDown(event, node.id)}
    >
      <circle className="composer-node-hit" cx={node.position.x} cy={node.position.y} r="24" />
      <circle className="composer-node" cx={node.position.x} cy={node.position.y} r="12" />
      <text className="composer-label" x={node.position.x} y={node.position.y - 22} textAnchor="middle">
        {node.label}
      </text>
      <text className="composer-sub-label" x={node.position.x} y={node.position.y + 32} textAnchor="middle">
        {node.childSegmentIds.length} child branch{node.childSegmentIds.length === 1 ? '' : 'es'}
      </text>
    </g>
  );
}

function DevicePlacementSvg({
  placement,
  point,
  selected,
  onPointerDown,
}: {
  placement: DevicePlacement;
  point: ComposerPoint;
  selected: boolean;
  onPointerDown: (event: ReactPointerEvent<SVGGElement>, id: string) => void;
}) {
  return (
    <g
      className={selected ? 'composer-marker selected' : 'composer-marker'}
      transform={`translate(${point.x} ${point.y})`}
      onPointerDown={(event) => onPointerDown(event, placement.id)}
    >
      <circle r="12" />
      <path d="M -5 0 L 0 -6 L 5 0 L 0 6 Z" />
      <text x="17" y="5">
        {placement.label || placement.deviceName}
      </text>
    </g>
  );
}

function TreatmentMarkerSvg({
  marker,
  point,
  selected,
  onPointerDown,
}: {
  marker: TreatmentMarker;
  point: ComposerPoint;
  selected: boolean;
  onPointerDown: (event: ReactPointerEvent<SVGGElement>, id: string) => void;
}) {
  return (
    <g
      className={selected ? 'composer-treatment-marker selected' : 'composer-treatment-marker'}
      transform={`translate(${point.x} ${point.y})`}
      onPointerDown={(event) => onPointerDown(event, marker.id)}
    >
      <line x1="0" y1="-15" x2="0" y2="15" />
      <circle r="6" />
      <text x="12" y="-10">
        {treatmentMarkerLabel(marker.markerType)}
      </text>
    </g>
  );
}

function moveSegment(original: VesselSegment, dx: number, dy: number): VesselSegment {
  return {
    ...original,
    start: translatePoint(original.start, dx, dy),
    end: translatePoint(original.end, dx, dy),
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

function moveBifurcation(original: BifurcationNode, dx: number, dy: number): BifurcationNode {
  return {
    ...original,
    position: translatePoint(original.position, dx, dy),
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
    t: projection.t,
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
    t: projection.t,
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

function midpoint(a: ComposerPoint, b: ComposerPoint): ComposerPoint {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

function segmentLabelPoint(segment: VesselSegment): ComposerPoint & { anchor: 'start' | 'middle' | 'end' } {
  const mid = midpoint(segment.start, segment.end);
  const dx = segment.end.x - segment.start.x;
  const dy = segment.end.y - segment.start.y;
  const length = Math.hypot(dx, dy) || 1;
  const isMostlyVertical = Math.abs(dy) > Math.abs(dx) * 1.4;
  const isMostlyHorizontal = Math.abs(dx) > Math.abs(dy) * 1.4;

  if (isMostlyVertical) {
    return {
      x: clamp(mid.x + 34, 24, WORKSPACE_WIDTH - 24),
      y: clamp(mid.y - 6, 24, WORKSPACE_HEIGHT - 24),
      anchor: 'start',
    };
  }
  if (isMostlyHorizontal) {
    return {
      x: clamp(mid.x, 24, WORKSPACE_WIDTH - 24),
      y: clamp(mid.y - 22, 24, WORKSPACE_HEIGHT - 24),
      anchor: 'middle',
    };
  }

  const normalX = (-dy / length) * 22;
  const normalY = (dx / length) * 22;
  return {
    x: clamp(mid.x + normalX, 24, WORKSPACE_WIDTH - 24),
    y: clamp(mid.y + normalY, 24, WORKSPACE_HEIGHT - 24),
    anchor: normalX >= 0 ? 'start' : 'end',
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
  if (hasProximal && hasDistal) return 'proximal and distal present';
  if (hasProximal) return 'missing distal';
  if (hasDistal) return 'missing proximal';
  return 'missing proximal and distal';
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
