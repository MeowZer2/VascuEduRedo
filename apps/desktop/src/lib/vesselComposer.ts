import type { Device } from './devices';
import { readJson, writeJson } from './storage';
import { isTauriDesktop, safeInvoke } from './tauri';

export interface ComposerPoint {
  x: number;
  y: number;
}

export interface VesselPreset {
  id: string;
  label: string;
  vesselType: string;
  proximalDiameterMm: number;
  distalDiameterMm: number;
  lengthMm: number;
  strokeClass: string;
}

export type PathologyType =
  | 'normal'
  | 'stenosis'
  | 'occlusion'
  | 'aneurysm'
  | 'dissection'
  | 'thrombus';

export type TreatmentMarkerType =
  | 'proximalLandingZone'
  | 'distalLandingZone'
  | 'lesionStart'
  | 'lesionEnd'
  | 'sealZone'
  | 'targetLesion'
  | 'branchAtRisk';

export interface AnatomyTemplate {
  id: 'aortoiliac' | 'fem-pop' | 'mesenteric-renal';
  label: string;
  description: string;
}

export interface ComposerBounds {
  width: number;
  height: number;
  padding?: number;
}

export const VESSEL_PRESETS: VesselPreset[] = [
  { id: 'aorta', label: 'Aorta', vesselType: 'aorta', proximalDiameterMm: 24, distalDiameterMm: 22, lengthMm: 120, strokeClass: 'aorta' },
  { id: 'common-iliac', label: 'Common iliac', vesselType: 'common iliac', proximalDiameterMm: 12, distalDiameterMm: 10, lengthMm: 70, strokeClass: 'iliac' },
  { id: 'external-iliac', label: 'External iliac', vesselType: 'external iliac', proximalDiameterMm: 9, distalDiameterMm: 8, lengthMm: 95, strokeClass: 'iliac' },
  { id: 'internal-iliac', label: 'Internal iliac', vesselType: 'internal iliac', proximalDiameterMm: 7, distalDiameterMm: 6, lengthMm: 55, strokeClass: 'branch' },
  { id: 'common-femoral', label: 'Common femoral', vesselType: 'common femoral', proximalDiameterMm: 8, distalDiameterMm: 7, lengthMm: 45, strokeClass: 'femoral' },
  { id: 'superficial-femoral', label: 'Superficial femoral', vesselType: 'superficial femoral', proximalDiameterMm: 6, distalDiameterMm: 5, lengthMm: 220, strokeClass: 'femoral' },
  { id: 'popliteal', label: 'Popliteal', vesselType: 'popliteal', proximalDiameterMm: 5, distalDiameterMm: 4.5, lengthMm: 90, strokeClass: 'femoral' },
  { id: 'renal-artery', label: 'Renal artery', vesselType: 'renal artery', proximalDiameterMm: 6, distalDiameterMm: 5, lengthMm: 45, strokeClass: 'branch' },
  { id: 'sma', label: 'SMA', vesselType: 'SMA', proximalDiameterMm: 7, distalDiameterMm: 5, lengthMm: 70, strokeClass: 'branch' },
  { id: 'other', label: 'Other vessel', vesselType: 'other', proximalDiameterMm: 6, distalDiameterMm: 6, lengthMm: 80, strokeClass: 'other' },
];

export const ANATOMY_TEMPLATES: AnatomyTemplate[] = [
  {
    id: 'aortoiliac',
    label: 'Aortoiliac',
    description: 'Vertical infrarenal aorta with iliac bifurcation and internal/external branches.',
  },
  {
    id: 'fem-pop',
    label: 'Femoral / popliteal',
    description: 'Common femoral inflow, profunda branch, SFA continuation, and popliteal outflow.',
  },
  {
    id: 'mesenteric-renal',
    label: 'Mesenteric / renal',
    description: 'Vertical aorta with celiac, SMA, and renal branches at sensible levels.',
  },
];

export const PATHOLOGY_OPTIONS: Array<{ id: PathologyType; label: string }> = [
  { id: 'normal', label: 'Normal' },
  { id: 'stenosis', label: 'Stenosis' },
  { id: 'occlusion', label: 'Occlusion' },
  { id: 'aneurysm', label: 'Aneurysm' },
  { id: 'dissection', label: 'Dissection' },
  { id: 'thrombus', label: 'Thrombus' },
];

export const TREATMENT_MARKER_OPTIONS: Array<{ id: TreatmentMarkerType; label: string }> = [
  { id: 'proximalLandingZone', label: 'Proximal landing zone' },
  { id: 'distalLandingZone', label: 'Distal landing zone' },
  { id: 'lesionStart', label: 'Lesion start' },
  { id: 'lesionEnd', label: 'Lesion end' },
  { id: 'sealZone', label: 'Seal zone' },
  { id: 'targetLesion', label: 'Target lesion' },
  { id: 'branchAtRisk', label: 'Branch at risk' },
];

export interface VesselSegment {
  id: string;
  type: 'segment';
  label: string;
  vesselType: string;
  start: ComposerPoint;
  end: ComposerPoint;
  proximalDiameterMm: number;
  distalDiameterMm: number;
  lengthMm: number;
  pathologyType: PathologyType;
  severityPercent?: number | null;
  treated: boolean;
  targetForIntervention: boolean;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export interface BifurcationNode {
  id: string;
  type: 'bifurcation';
  label: string;
  position: ComposerPoint;
  parentSegmentId: string | null;
  childSegmentIds: string[];
  notes?: string;
  metadata?: Record<string, unknown>;
}

export interface DevicePlacement {
  id: string;
  type: 'devicePlacement';
  label: string;
  segmentId: string;
  t: number;
  deviceId: string;
  deviceName: string;
  deviceManufacturer?: string;
  deviceCategory?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export interface TreatmentMarker {
  id: string;
  type: 'treatmentMarker';
  markerType: TreatmentMarkerType;
  label: string;
  segmentId: string;
  t: number;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export type ProceduralObjectType =
  | 'guidewire'
  | 'catheter'
  | 'sheath'
  | 'balloon'
  | 'stent'
  | 'stentGraft';

export type ProceduralObjectState = 'positioned' | 'undeployed' | 'deployed';

export interface ProceduralObject {
  id: string;
  type: 'proceduralObject';
  objectType: ProceduralObjectType;
  label: string;
  segmentId: string;
  t: number;
  lengthMm: number;
  state: ProceduralObjectState;
  snapshot: 'pre' | 'positioned' | 'post';
  notes?: string;
  metadata?: Record<string, unknown>;
}

export interface DeviceFitWarning {
  severity: 'info' | 'warning';
  placementId: string;
  message: string;
}

export type VascularPlanningEntity =
  | VesselSegment
  | BifurcationNode
  | DevicePlacement
  | TreatmentMarker
  | ProceduralObject;

export interface VesselCompositionMetadata {
  notes?: string;
  [key: string]: unknown;
}

export interface VesselCompositionData {
  version: '0.14';
  schema: 'vascular-plan';
  metadata: VesselCompositionMetadata;
  segments: VesselSegment[];
  bifurcations: BifurcationNode[];
  devicePlacements: DevicePlacement[];
  treatmentMarkers: TreatmentMarker[];
  proceduralObjects: ProceduralObject[];
  viewport: {
    width: number;
    height: number;
  };
}

export interface VesselCompositionRow {
  id: string;
  caseId: string | null;
  name: string;
  data: VesselCompositionData;
  updatedAt: string;
}

export interface VesselCompositionInput {
  id?: string | null;
  caseId?: string | null;
  name: string;
  data: VesselCompositionData;
}

export interface PlanValidationIssue {
  severity: 'error' | 'warning';
  field: string;
  message: string;
}

export interface PlanReadinessSummary {
  status: 'ready' | 'warnings' | 'blocked' | 'empty';
  errorCount: number;
  warningCount: number;
  infoCount: number;
  segmentCount: number;
  deviceCount: number;
  markerCount: number;
  bifurcationCount: number;
  interventionTargets: number;
  unresolvedFitWarnings: number;
  hasNotes: boolean;
  headline: string;
}

export interface LabelLayoutEntry {
  segmentId: string;
  primary: ComposerPoint & { anchor: 'start' | 'middle' | 'end' };
  secondary: (ComposerPoint & { anchor: 'start' | 'middle' | 'end' }) | null;
}

interface VesselCompositionWire {
  id: string;
  caseId: string | null;
  name: string;
  data: unknown;
  updatedAt: string;
}

const LOCAL_KEY = 'vascedu.vesselCompositions.v0.13';

export function emptyVesselCompositionData(): VesselCompositionData {
  return {
    version: '0.14',
    schema: 'vascular-plan',
    metadata: {},
    segments: [],
    bifurcations: [],
    devicePlacements: [],
    treatmentMarkers: [],
    proceduralObjects: [],
    viewport: {
      width: 1000,
      height: 620,
    },
  };
}

export function getVesselPreset(vesselType: string): VesselPreset {
  const normalized = vesselType.trim().toLowerCase();
  return (
    VESSEL_PRESETS.find((preset) => preset.vesselType.toLowerCase() === normalized) ??
    VESSEL_PRESETS.find((preset) => preset.id === normalized) ??
    VESSEL_PRESETS[VESSEL_PRESETS.length - 1]
  );
}

export function makeSegmentFromPreset(
  presetId: string,
  id: string,
  start: ComposerPoint,
  end: ComposerPoint,
  ordinal: number,
): VesselSegment {
  const preset = VESSEL_PRESETS.find((item) => item.id === presetId) ?? getVesselPreset(presetId);
  return {
    id,
    type: 'segment',
    label: `${preset.label} ${ordinal}`,
    vesselType: preset.vesselType,
    start,
    end,
    proximalDiameterMm: preset.proximalDiameterMm,
    distalDiameterMm: preset.distalDiameterMm,
    lengthMm: preset.lengthMm,
    pathologyType: 'normal',
    treated: false,
    targetForIntervention: false,
    metadata: {
      presetId: preset.id,
      strokeClass: preset.strokeClass,
    },
  };
}

export function defaultSegmentEndpoints(
  presetId: string,
  center: ComposerPoint,
  bounds: ComposerBounds,
): { start: ComposerPoint; end: ComposerPoint } {
  const preset = VESSEL_PRESETS.find((item) => item.id === presetId) ?? getVesselPreset(presetId);
  const half = clamp(preset.lengthMm * 0.55, 48, 125);
  const pad = bounds.padding ?? 40;
  const clampPoint = (point: ComposerPoint): ComposerPoint => ({
    x: clamp(point.x, pad, bounds.width - pad),
    y: clamp(point.y, pad, bounds.height - pad),
  });

  switch (preset.id) {
    case 'aorta':
    case 'common-femoral':
    case 'superficial-femoral':
    case 'popliteal':
      return {
        start: clampPoint({ x: center.x, y: center.y - half }),
        end: clampPoint({ x: center.x, y: center.y + half }),
      };
    case 'common-iliac':
    case 'external-iliac':
      return {
        start: clampPoint({ x: center.x - half * 0.72, y: center.y - half * 0.55 }),
        end: clampPoint({ x: center.x + half * 0.72, y: center.y + half * 0.55 }),
      };
    case 'internal-iliac':
      return {
        start: clampPoint({ x: center.x + half * 0.7, y: center.y - half * 0.3 }),
        end: clampPoint({ x: center.x - half * 0.7, y: center.y + half * 0.3 }),
      };
    case 'renal-artery':
    case 'sma':
      return {
        start: clampPoint({ x: center.x - half, y: center.y }),
        end: clampPoint({ x: center.x + half, y: center.y }),
      };
    default:
      return {
        start: clampPoint({ x: center.x - half * 0.85, y: center.y - half * 0.25 }),
        end: clampPoint({ x: center.x + half * 0.85, y: center.y + half * 0.25 }),
      };
  }
}

export function makeOrientedSegmentFromPreset(
  presetId: string,
  id: string,
  center: ComposerPoint,
  ordinal: number,
  bounds: ComposerBounds,
): VesselSegment {
  const endpoints = defaultSegmentEndpoints(presetId, center, bounds);
  return makeSegmentFromPreset(presetId, id, endpoints.start, endpoints.end, ordinal);
}

export function createAnatomyTemplateData(
  templateId: AnatomyTemplate['id'],
  idFactory: (prefix: string) => string,
): Pick<VesselCompositionData, 'metadata' | 'segments' | 'bifurcations' | 'devicePlacements' | 'treatmentMarkers' | 'proceduralObjects'> {
  if (templateId === 'fem-pop') return createFemPopTemplate(idFactory);
  if (templateId === 'mesenteric-renal') return createMesentericRenalTemplate(idFactory);
  return createAortoiliacTemplate(idFactory);
}

export function normalizeVesselCompositionData(data: unknown): VesselCompositionData {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return emptyVesselCompositionData();
  }

  const raw = data as Record<string, unknown>;
  const viewport = objectRecord(raw.viewport) ?? {};
  const migrated = migrateOldObjects(raw.objects);
  const segments = Array.isArray(raw.segments)
    ? raw.segments.map(normalizeSegment).filter(isSegment)
    : migrated.segments;
  const segmentIds = new Set(segments.map((segment) => segment.id));
  const bifurcations = Array.isArray(raw.bifurcations)
    ? raw.bifurcations.map((value) => normalizeBifurcation(value, segmentIds)).filter(isBifurcation)
    : migrated.bifurcations.map((value) => normalizeBifurcation(value, segmentIds)).filter(isBifurcation);
  const devicePlacements = Array.isArray(raw.devicePlacements)
    ? raw.devicePlacements.map((value) => normalizeDevicePlacement(value, segmentIds)).filter(isDevicePlacement)
    : migrated.devicePlacements.map((value) => normalizeDevicePlacement(value, segmentIds)).filter(isDevicePlacement);
  const treatmentMarkers = Array.isArray(raw.treatmentMarkers)
    ? raw.treatmentMarkers.map((value) => normalizeTreatmentMarker(value, segmentIds)).filter(isTreatmentMarker)
    : [];
  const proceduralObjects = Array.isArray(raw.proceduralObjects)
    ? raw.proceduralObjects.map((value) => normalizeProceduralObject(value, segmentIds)).filter(isProceduralObject)
    : [];

  return {
    version: '0.14',
    schema: 'vascular-plan',
    metadata: objectRecord(raw.metadata) ? { ...(raw.metadata as Record<string, unknown>) } : {},
    segments,
    bifurcations,
    devicePlacements,
    treatmentMarkers,
    proceduralObjects,
    viewport: {
      width: finiteNumber(viewport.width, 1000),
      height: finiteNumber(viewport.height, 620),
    },
  };
}

export function validateVesselCompositionData(
  data: VesselCompositionData,
  deviceIds?: Set<string>,
): PlanValidationIssue[] {
  const issues: PlanValidationIssue[] = [];
  const segmentIds = new Set(data.segments.map((segment) => segment.id));

  for (const segment of data.segments) {
    if (!segment.label.trim()) {
      issues.push(error(`segments.${segment.id}.label`, 'Segment label is required.'));
    }
    if (!segment.vesselType.trim()) {
      issues.push(error(`segments.${segment.id}.vesselType`, 'Vessel type is required.'));
    }
    if (!isSensibleDiameter(segment.proximalDiameterMm)) {
      issues.push(error(`segments.${segment.id}.proximalDiameterMm`, 'Proximal diameter must be between 1 and 80 mm.'));
    }
    if (!isSensibleDiameter(segment.distalDiameterMm)) {
      issues.push(error(`segments.${segment.id}.distalDiameterMm`, 'Distal diameter must be between 1 and 80 mm.'));
    }
    if (!Number.isFinite(segment.lengthMm) || segment.lengthMm <= 0 || segment.lengthMm > 2000) {
      issues.push(error(`segments.${segment.id}.lengthMm`, 'Length must be between 1 and 2000 mm.'));
    }
    if (!PATHOLOGY_OPTIONS.some((option) => option.id === segment.pathologyType)) {
      issues.push(error(`segments.${segment.id}.pathologyType`, 'Pathology type is not recognized.'));
    }
    if (
      segment.severityPercent !== undefined &&
      segment.severityPercent !== null &&
      (!Number.isFinite(segment.severityPercent) || segment.severityPercent < 0 || segment.severityPercent > 100)
    ) {
      issues.push(error(`segments.${segment.id}.severityPercent`, 'Severity must be 0 to 100%.'));
    }
  }

  for (const bifurcation of data.bifurcations) {
    if (bifurcation.parentSegmentId && !segmentIds.has(bifurcation.parentSegmentId)) {
      issues.push(error(`bifurcations.${bifurcation.id}.parentSegmentId`, 'Parent segment does not exist.'));
    }
    for (const childId of bifurcation.childSegmentIds) {
      if (!segmentIds.has(childId)) {
        issues.push(error(`bifurcations.${bifurcation.id}.childSegmentIds`, `Child segment ${childId} does not exist.`));
      }
    }
    if (!bifurcation.parentSegmentId && bifurcation.childSegmentIds.length === 0) {
      issues.push(warning(`bifurcations.${bifurcation.id}`, 'Bifurcation has no parent or child branch relationships yet.'));
    }
  }

  const markerBySegment = new Map<string, Set<TreatmentMarkerType>>();
  for (const marker of data.treatmentMarkers) {
    if (!segmentIds.has(marker.segmentId)) {
      issues.push(error(`treatmentMarkers.${marker.id}.segmentId`, 'Treatment marker must reference an existing vessel segment.'));
    }
    if (!Number.isFinite(marker.t) || marker.t < 0 || marker.t > 1) {
      issues.push(error(`treatmentMarkers.${marker.id}.t`, 'Treatment marker position must be between 0 and 1 along the segment.'));
    }
    const set = markerBySegment.get(marker.segmentId) ?? new Set<TreatmentMarkerType>();
    set.add(marker.markerType);
    markerBySegment.set(marker.segmentId, set);
  }

  for (const segment of data.segments) {
    if (segment.targetForIntervention || segment.pathologyType !== 'normal') {
      const markers = markerBySegment.get(segment.id);
      if (!markers?.has('proximalLandingZone') || !markers?.has('distalLandingZone')) {
        issues.push(warning(`segments.${segment.id}.landingZones`, 'Intervention targets should define proximal and distal landing zones.'));
      }
    }
  }

  for (const placement of data.devicePlacements) {
    if (!segmentIds.has(placement.segmentId)) {
      issues.push(error(`devicePlacements.${placement.id}.segmentId`, 'Device placement must reference an existing vessel segment.'));
    }
    if (!placement.deviceId.trim()) {
      issues.push(error(`devicePlacements.${placement.id}.deviceId`, 'Device placement must reference a catalog device.'));
    } else if (deviceIds && deviceIds.size > 0 && !deviceIds.has(placement.deviceId)) {
      issues.push(error(`devicePlacements.${placement.id}.deviceId`, 'Linked device is not in the current device catalog.'));
    }
    if (!Number.isFinite(placement.t) || placement.t < 0 || placement.t > 1) {
      issues.push(error(`devicePlacements.${placement.id}.t`, 'Device position must be between 0 and 1 along the segment.'));
    }
  }

  for (const object of data.proceduralObjects) {
    if (!segmentIds.has(object.segmentId)) {
      issues.push(error(`proceduralObjects.${object.id}.segmentId`, 'Procedural object must reference an existing vessel segment.'));
    }
    if (!PROCEDURAL_OBJECT_OPTIONS.some((option) => option.id === object.objectType)) {
      issues.push(error(`proceduralObjects.${object.id}.objectType`, 'Procedural object type is not recognized.'));
    }
    if (!Number.isFinite(object.t) || object.t < 0 || object.t > 1) {
      issues.push(error(`proceduralObjects.${object.id}.t`, 'Procedural object position must be between 0 and 1 along the segment.'));
    }
    if (!Number.isFinite(object.lengthMm) || object.lengthMm <= 0 || object.lengthMm > 2000) {
      issues.push(error(`proceduralObjects.${object.id}.lengthMm`, 'Procedural object length must be between 1 and 2000 mm.'));
    }
  }

  return issues;
}

export async function listVesselCompositions(caseId?: string | null): Promise<VesselCompositionRow[]> {
  if (isTauriDesktop()) {
    const rows = await safeInvoke<VesselCompositionWire[]>('list_vessel_compositions', {
      caseId: caseId ?? null,
    });
    if (rows) return rows.map(fromWire);
  }
  return readLocalRows(caseId);
}

export async function getVesselComposition(compositionId: string): Promise<VesselCompositionRow | null> {
  if (isTauriDesktop()) {
    const row = await safeInvoke<VesselCompositionWire | null>('get_vessel_composition', {
      compositionId,
    });
    if (row) return fromWire(row);
  }
  return readLocalRows().find((row) => row.id === compositionId) ?? null;
}

export async function saveVesselComposition(
  input: VesselCompositionInput,
): Promise<VesselCompositionRow> {
  if (isTauriDesktop()) {
    const row = await safeInvoke<VesselCompositionWire>('save_vessel_composition', { input });
    if (!row) throw new Error('save_vessel_composition returned no row');
    return fromWire(row);
  }

  const now = new Date().toISOString();
  const rows = readLocalRows();
  const id = input.id || makeLocalId();
  const next: VesselCompositionRow = {
    id,
    caseId: input.caseId ?? null,
    name: input.name.trim() || 'Untitled vessel plan',
    data: normalizeVesselCompositionData(input.data),
    updatedAt: now,
  };
  const updated = rows.some((row) => row.id === id)
    ? rows.map((row) => (row.id === id ? next : row))
    : [next, ...rows];
  writeJson(LOCAL_KEY, updated);
  return next;
}

export function devicePlacementFromDevice(
  id: string,
  device: Device,
  segmentId: string,
  t: number,
): DevicePlacement {
  return {
    id,
    type: 'devicePlacement',
    label: shortDeviceLabel(device),
    segmentId,
    t: clamp(t, 0, 1),
    deviceId: device.id,
    deviceName: device.name,
    deviceManufacturer: device.manufacturer,
    deviceCategory: device.category,
    metadata: {
      shortLabel: shortDeviceLabel(device),
    },
  };
}

export function treatmentMarkerLabel(markerType: TreatmentMarkerType): string {
  return TREATMENT_MARKER_OPTIONS.find((option) => option.id === markerType)?.label ?? 'Treatment marker';
}

export function makeTreatmentMarker(
  id: string,
  markerType: TreatmentMarkerType,
  segmentId: string,
  t: number,
): TreatmentMarker {
  return {
    id,
    type: 'treatmentMarker',
    markerType,
    label: treatmentMarkerLabel(markerType),
    segmentId,
    t: clamp(t, 0, 1),
  };
}

export const PROCEDURAL_OBJECT_OPTIONS: Array<{ id: ProceduralObjectType; label: string; defaultLengthMm: number }> = [
  { id: 'guidewire', label: 'Guidewire', defaultLengthMm: 180 },
  { id: 'catheter', label: 'Catheter', defaultLengthMm: 110 },
  { id: 'sheath', label: 'Sheath', defaultLengthMm: 55 },
  { id: 'balloon', label: 'Balloon', defaultLengthMm: 40 },
  { id: 'stent', label: 'Stent', defaultLengthMm: 50 },
  { id: 'stentGraft', label: 'Stent graft', defaultLengthMm: 90 },
];

export function proceduralObjectLabel(type: ProceduralObjectType): string {
  return PROCEDURAL_OBJECT_OPTIONS.find((option) => option.id === type)?.label ?? 'Procedural object';
}

export function makeProceduralObject(
  id: string,
  objectType: ProceduralObjectType,
  segmentId: string,
  t: number,
): ProceduralObject {
  const option = PROCEDURAL_OBJECT_OPTIONS.find((item) => item.id === objectType) ?? PROCEDURAL_OBJECT_OPTIONS[0];
  const deployable = objectType === 'balloon' || objectType === 'stent' || objectType === 'stentGraft';
  return {
    id,
    type: 'proceduralObject',
    objectType,
    label: option.label,
    segmentId,
    t: clamp(t, 0, 1),
    lengthMm: option.defaultLengthMm,
    state: deployable ? 'undeployed' : 'positioned',
    snapshot: objectType === 'guidewire' || objectType === 'catheter' || objectType === 'sheath' ? 'positioned' : 'pre',
  };
}

export function assessDeviceFit(
  placement: DevicePlacement,
  segment: VesselSegment | undefined,
  device: Device | undefined,
): DeviceFitWarning[] {
  const warnings: DeviceFitWarning[] = [];
  if (!segment) {
    warnings.push({
      severity: 'warning',
      placementId: placement.id,
      message: 'Device placement is not attached to a valid vessel segment.',
    });
    return warnings;
  }
  if (!device) {
    warnings.push({
      severity: 'warning',
      placementId: placement.id,
      message: 'Linked device is missing from the current catalog.',
    });
    return warnings;
  }

  const sizing = parseDeviceSizing(device);
  if (!sizing.hasDiameter && !sizing.hasLength) {
    warnings.push({
      severity: 'info',
      placementId: placement.id,
      message: 'Device catalog entry has no parseable size data.',
    });
    return warnings;
  }

  const averageDiameter = (segment.proximalDiameterMm + segment.distalDiameterMm) / 2;
  if (sizing.diameterMin !== null && averageDiameter < sizing.diameterMin * 0.85) {
    warnings.push({
      severity: 'warning',
      placementId: placement.id,
      message: `Diameter mismatch: vessel average ${averageDiameter.toFixed(1)} mm is below device range ${sizing.diameterMin}-${sizing.diameterMax ?? '?'} mm.`,
    });
  }
  if (sizing.diameterMax !== null && averageDiameter > sizing.diameterMax * 1.15) {
    warnings.push({
      severity: 'warning',
      placementId: placement.id,
      message: `Diameter mismatch: vessel average ${averageDiameter.toFixed(1)} mm is above device range ${sizing.diameterMin ?? '?'}-${sizing.diameterMax} mm.`,
    });
  }
  if (sizing.lengthMax !== null && segment.lengthMm > sizing.lengthMax) {
    warnings.push({
      severity: 'warning',
      placementId: placement.id,
      message: `Device may be too short: segment length ${segment.lengthMm} mm exceeds available device length ${sizing.lengthMax} mm.`,
    });
  }
  if (warnings.length === 0 && (!sizing.hasDiameter || !sizing.hasLength)) {
    warnings.push({
      severity: 'info',
      placementId: placement.id,
      message: 'Fit check is partial because diameter or length data is missing.',
    });
  }
  return warnings;
}

function parseDeviceSizing(device: Device): {
  diameterMin: number | null;
  diameterMax: number | null;
  lengthMax: number | null;
  hasDiameter: boolean;
  hasLength: boolean;
} {
  const diameterValues: number[] = [];
  const lengthValues: number[] = [];
  const sources = [
    ...device.sizes,
    ...Object.values(device.properties).filter((value): value is string => typeof value === 'string'),
  ];

  for (const source of sources) {
    const parts = source.split(/(?:x|×|Ã—)/i).map((part) => numbersFromText(part));
    if (parts.length >= 2) {
      diameterValues.push(...parts[0].filter((n) => n <= 80));
      for (const part of parts.slice(1)) {
        lengthValues.push(...part.filter((n) => n >= 10));
      }
    } else {
      const nums = parts[0] ?? [];
      const text = source.toLowerCase();
      if (text.includes('length') || text.includes('long')) {
        lengthValues.push(...nums.filter((n) => n >= 10));
      } else {
        diameterValues.push(...nums.filter((n) => n <= 80));
      }
    }
  }

  return {
    diameterMin: diameterValues.length > 0 ? Math.min(...diameterValues) : null,
    diameterMax: diameterValues.length > 0 ? Math.max(...diameterValues) : null,
    lengthMax: lengthValues.length > 0 ? Math.max(...lengthValues) : null,
    hasDiameter: diameterValues.length > 0,
    hasLength: lengthValues.length > 0,
  };
}

function numbersFromText(text: string): number[] {
  return (text.match(/\d+(?:\.\d+)?/g) ?? [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
}

function createAortoiliacTemplate(
  idFactory: (prefix: string) => string,
): Pick<VesselCompositionData, 'metadata' | 'segments' | 'bifurcations' | 'devicePlacements' | 'treatmentMarkers' | 'proceduralObjects'> {
  const aorta = templateSegment(idFactory, 'aorta', 'Infrarenal aorta', { x: 500, y: 90 }, { x: 500, y: 265 });
  const rightCommon = templateSegment(idFactory, 'common-iliac', 'Right common iliac', { x: 500, y: 265 }, { x: 650, y: 370 });
  const leftCommon = templateSegment(idFactory, 'common-iliac', 'Left common iliac', { x: 500, y: 265 }, { x: 350, y: 370 });
  const rightExternal = templateSegment(idFactory, 'external-iliac', 'Right external iliac', { x: 650, y: 370 }, { x: 710, y: 540 });
  const leftExternal = templateSegment(idFactory, 'external-iliac', 'Left external iliac', { x: 350, y: 370 }, { x: 290, y: 540 });
  const rightInternal = templateSegment(idFactory, 'internal-iliac', 'Right internal iliac', { x: 650, y: 370 }, { x: 555, y: 455 });
  const leftInternal = templateSegment(idFactory, 'internal-iliac', 'Left internal iliac', { x: 350, y: 370 }, { x: 445, y: 455 });

  return {
    metadata: {
      templateId: 'aortoiliac',
      templateLabel: 'Aortoiliac',
    },
    segments: [aorta, rightCommon, leftCommon, rightExternal, leftExternal, rightInternal, leftInternal],
    bifurcations: [
      {
        id: idFactory('bifurcation'),
        type: 'bifurcation',
        label: 'Aortic bifurcation',
        position: { x: 500, y: 265 },
        parentSegmentId: aorta.id,
        childSegmentIds: [rightCommon.id, leftCommon.id],
      },
      {
        id: idFactory('bifurcation'),
        type: 'bifurcation',
        label: 'Right iliac bifurcation',
        position: { x: 650, y: 370 },
        parentSegmentId: rightCommon.id,
        childSegmentIds: [rightExternal.id, rightInternal.id],
      },
      {
        id: idFactory('bifurcation'),
        type: 'bifurcation',
        label: 'Left iliac bifurcation',
        position: { x: 350, y: 370 },
        parentSegmentId: leftCommon.id,
        childSegmentIds: [leftExternal.id, leftInternal.id],
      },
    ],
    devicePlacements: [],
    treatmentMarkers: [],
    proceduralObjects: [],
  };
}

function createFemPopTemplate(
  idFactory: (prefix: string) => string,
): Pick<VesselCompositionData, 'metadata' | 'segments' | 'bifurcations' | 'devicePlacements' | 'treatmentMarkers' | 'proceduralObjects'> {
  const commonFemoral = templateSegment(idFactory, 'common-femoral', 'Common femoral artery', { x: 500, y: 90 }, { x: 500, y: 185 });
  const sfa = templateSegment(idFactory, 'superficial-femoral', 'Superficial femoral artery', { x: 500, y: 185 }, { x: 500, y: 425 });
  const profunda = templateSegment(idFactory, 'other', 'Profunda femoris', { x: 500, y: 185 }, { x: 660, y: 285 }, {
    vesselType: 'profunda femoris',
    proximalDiameterMm: 6,
    distalDiameterMm: 4.5,
    lengthMm: 95,
    strokeClass: 'branch',
  });
  const popliteal = templateSegment(idFactory, 'popliteal', 'Popliteal artery', { x: 500, y: 425 }, { x: 500, y: 555 });

  return {
    metadata: {
      templateId: 'fem-pop',
      templateLabel: 'Femoral / popliteal',
    },
    segments: [commonFemoral, sfa, profunda, popliteal],
    bifurcations: [
      {
        id: idFactory('bifurcation'),
        type: 'bifurcation',
        label: 'Femoral bifurcation',
        position: { x: 500, y: 185 },
        parentSegmentId: commonFemoral.id,
        childSegmentIds: [sfa.id, profunda.id],
      },
      {
        id: idFactory('bifurcation'),
        type: 'bifurcation',
        label: 'Adductor hiatus transition',
        position: { x: 500, y: 425 },
        parentSegmentId: sfa.id,
        childSegmentIds: [popliteal.id],
      },
    ],
    devicePlacements: [],
    treatmentMarkers: [],
    proceduralObjects: [],
  };
}

function createMesentericRenalTemplate(
  idFactory: (prefix: string) => string,
): Pick<VesselCompositionData, 'metadata' | 'segments' | 'bifurcations' | 'devicePlacements' | 'treatmentMarkers' | 'proceduralObjects'> {
  const aorta = templateSegment(idFactory, 'aorta', 'Visceral abdominal aorta', { x: 500, y: 70 }, { x: 500, y: 560 });
  const celiac = templateSegment(idFactory, 'other', 'Celiac axis', { x: 500, y: 160 }, { x: 370, y: 135 }, {
    vesselType: 'celiac axis',
    proximalDiameterMm: 7,
    distalDiameterMm: 5,
    lengthMm: 35,
    strokeClass: 'branch',
  });
  const sma = templateSegment(idFactory, 'sma', 'SMA', { x: 500, y: 230 }, { x: 650, y: 230 });
  const rightRenal = templateSegment(idFactory, 'renal-artery', 'Right renal artery', { x: 500, y: 315 }, { x: 655, y: 300 });
  const leftRenal = templateSegment(idFactory, 'renal-artery', 'Left renal artery', { x: 500, y: 335 }, { x: 345, y: 350 });

  return {
    metadata: {
      templateId: 'mesenteric-renal',
      templateLabel: 'Mesenteric / renal',
    },
    segments: [aorta, celiac, sma, rightRenal, leftRenal],
    bifurcations: [
      {
        id: idFactory('bifurcation'),
        type: 'bifurcation',
        label: 'Celiac origin',
        position: { x: 500, y: 160 },
        parentSegmentId: aorta.id,
        childSegmentIds: [celiac.id],
      },
      {
        id: idFactory('bifurcation'),
        type: 'bifurcation',
        label: 'SMA origin',
        position: { x: 500, y: 230 },
        parentSegmentId: aorta.id,
        childSegmentIds: [sma.id],
      },
      {
        id: idFactory('bifurcation'),
        type: 'bifurcation',
        label: 'Renal origins',
        position: { x: 500, y: 325 },
        parentSegmentId: aorta.id,
        childSegmentIds: [rightRenal.id, leftRenal.id],
      },
    ],
    devicePlacements: [],
    treatmentMarkers: [],
    proceduralObjects: [],
  };
}

function templateSegment(
  idFactory: (prefix: string) => string,
  presetId: string,
  label: string,
  start: ComposerPoint,
  end: ComposerPoint,
  overrides?: {
    vesselType?: string;
    proximalDiameterMm?: number;
    distalDiameterMm?: number;
    lengthMm?: number;
    strokeClass?: string;
  },
): VesselSegment {
  const segment = makeSegmentFromPreset(presetId, idFactory('segment'), start, end, 1);
  const preset = getVesselPreset(overrides?.vesselType ?? presetId);
  return {
    ...segment,
    label,
    vesselType: overrides?.vesselType ?? segment.vesselType,
    proximalDiameterMm: overrides?.proximalDiameterMm ?? segment.proximalDiameterMm,
    distalDiameterMm: overrides?.distalDiameterMm ?? segment.distalDiameterMm,
    lengthMm: overrides?.lengthMm ?? segment.lengthMm,
    metadata: {
      ...(segment.metadata ?? {}),
      presetId,
      strokeClass: overrides?.strokeClass ?? segment.metadata?.strokeClass ?? preset.strokeClass,
      anatomicalTemplate: true,
    },
  };
}

function fromWire(row: VesselCompositionWire): VesselCompositionRow {
  return {
    id: row.id,
    caseId: row.caseId ?? null,
    name: row.name,
    data: normalizeVesselCompositionData(row.data),
    updatedAt: row.updatedAt,
  };
}

function readLocalRows(caseId?: string | null): VesselCompositionRow[] {
  const rows = readJson<VesselCompositionWire[]>(LOCAL_KEY, []);
  const normalized = rows
    .filter((row) => row && typeof row.id === 'string')
    .map(fromWire)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (caseId === undefined || caseId === null || caseId === '') return normalized;
  return normalized.filter((row) => row.caseId === caseId);
}

function migrateOldObjects(rawObjects: unknown): {
  segments: VesselSegment[];
  bifurcations: BifurcationNode[];
  devicePlacements: DevicePlacement[];
} {
  if (!Array.isArray(rawObjects)) {
    return { segments: [], bifurcations: [], devicePlacements: [] };
  }
  const segments: VesselSegment[] = [];
  const bifurcations: BifurcationNode[] = [];
  const devicePlacements: DevicePlacement[] = [];

  for (const raw of rawObjects) {
    const obj = objectRecord(raw);
    if (!obj) continue;
    if (obj.type === 'segment') {
      const segment = normalizeSegment(obj);
      if (segment) segments.push(segment);
    } else if (obj.type === 'bifurcation') {
      const position = objectRecord(obj.position);
      const center = normalizePoint(position?.center);
      if (typeof obj.id === 'string' && center) {
        bifurcations.push({
          id: obj.id,
          type: 'bifurcation',
          label: stringValue(obj.label, 'Bifurcation'),
          position: center,
          parentSegmentId: null,
          childSegmentIds: [],
          metadata: objectRecord(obj.metadata) ?? undefined,
        });
      }
    } else if (obj.type === 'deviceMarker') {
      const placement = normalizeDevicePlacement(obj, new Set());
      if (placement) devicePlacements.push(placement);
    }
  }

  return { segments, bifurcations, devicePlacements };
}

function normalizeSegment(raw: unknown): VesselSegment | null {
  const obj = objectRecord(raw);
  if (!obj || typeof obj.id !== 'string' || !obj.id) return null;
  const position = objectRecord(obj.position);
  const start = normalizePoint(obj.start) ?? normalizePoint(position?.start);
  const end = normalizePoint(obj.end) ?? normalizePoint(position?.end);
  if (!start || !end) return null;

  const metadata = objectRecord(obj.metadata);
  const vesselType = stringValue(
    obj.vesselType,
    stringValue(metadata?.vesselType, stringValue(obj.label, 'other')),
  );
  const preset = getVesselPreset(vesselType);
  const legacyLesionType = optionalString(obj.lesionType);
  const pathologyType = normalizePathologyType(obj.pathologyType, legacyLesionType);
  const severityPercent = optionalNumber(obj.severityPercent) ?? optionalNumber(obj.lesionSeverity);

  return {
    id: obj.id,
    type: 'segment',
    label: stringValue(obj.label, preset.label),
    vesselType,
    start,
    end,
    proximalDiameterMm: sensibleNumber(obj.proximalDiameterMm, preset.proximalDiameterMm),
    distalDiameterMm: sensibleNumber(obj.distalDiameterMm, preset.distalDiameterMm),
    lengthMm: sensibleNumber(obj.lengthMm, preset.lengthMm),
    pathologyType,
    severityPercent,
    treated: booleanValue(obj.treated, false),
    targetForIntervention: booleanValue(obj.targetForIntervention, pathologyType !== 'normal'),
    notes: optionalString(obj.notes),
    metadata: metadata ? { ...metadata, strokeClass: metadata.strokeClass ?? preset.strokeClass } : { strokeClass: preset.strokeClass },
  };
}

function normalizeBifurcation(raw: unknown, segmentIds: Set<string>): BifurcationNode | null {
  const obj = objectRecord(raw);
  if (!obj || typeof obj.id !== 'string' || !obj.id) return null;
  const positionObj = objectRecord(obj.position);
  const position = normalizePoint(obj.position) ?? normalizePoint(positionObj?.center);
  if (!position) return null;
  const parentSegmentId = typeof obj.parentSegmentId === 'string' && segmentIds.has(obj.parentSegmentId)
    ? obj.parentSegmentId
    : null;
  const childSegmentIds = Array.isArray(obj.childSegmentIds)
    ? obj.childSegmentIds.filter((id): id is string => typeof id === 'string' && segmentIds.has(id))
    : [];
  const metadata = objectRecord(obj.metadata);
  return {
    id: obj.id,
    type: 'bifurcation',
    label: stringValue(obj.label, 'Bifurcation'),
    position,
    parentSegmentId,
    childSegmentIds: Array.from(new Set(childSegmentIds)),
    notes: optionalString(obj.notes),
    metadata: metadata ? { ...metadata } : undefined,
  };
}

function normalizeDevicePlacement(raw: unknown, segmentIds: Set<string>): DevicePlacement | null {
  const obj = objectRecord(raw);
  if (!obj || typeof obj.id !== 'string' || !obj.id) return null;
  const metadata = objectRecord(obj.metadata);
  const position = objectRecord(obj.position);
  const segmentId = stringValue(obj.segmentId, stringValue(position?.segmentId, ''));
  const deviceId = stringValue(obj.deviceId, stringValue(metadata?.deviceId, ''));
  const deviceName = stringValue(obj.deviceName, stringValue(metadata?.deviceName, 'Catalog device'));
  if (!segmentId && segmentIds.size > 0) return null;

  return {
    id: obj.id,
    type: 'devicePlacement',
    label: stringValue(obj.label, stringValue(metadata?.shortLabel, deviceName)),
    segmentId,
    t: clamp(finiteNumber(obj.t, finiteNumber(position?.t, 0)), 0, 1),
    deviceId,
    deviceName,
    deviceManufacturer: optionalString(obj.deviceManufacturer) ?? optionalString(metadata?.deviceManufacturer),
    deviceCategory: optionalString(obj.deviceCategory) ?? optionalString(metadata?.deviceCategory),
    notes: optionalString(obj.notes),
    metadata: metadata ? { ...metadata } : undefined,
  };
}

function normalizeTreatmentMarker(raw: unknown, segmentIds: Set<string>): TreatmentMarker | null {
  const obj = objectRecord(raw);
  if (!obj || typeof obj.id !== 'string' || !obj.id) return null;
  const segmentId = stringValue(obj.segmentId, '');
  if (!segmentId && segmentIds.size > 0) return null;
  const markerType = normalizeTreatmentMarkerType(obj.markerType);
  const metadata = objectRecord(obj.metadata);
  return {
    id: obj.id,
    type: 'treatmentMarker',
    markerType,
    label: stringValue(obj.label, treatmentMarkerLabel(markerType)),
    segmentId,
    t: clamp(finiteNumber(obj.t, 0), 0, 1),
    notes: optionalString(obj.notes),
    metadata: metadata ? { ...metadata } : undefined,
  };
}

function normalizeProceduralObject(raw: unknown, segmentIds: Set<string>): ProceduralObject | null {
  const obj = objectRecord(raw);
  if (!obj || typeof obj.id !== 'string' || !obj.id) return null;
  const segmentId = stringValue(obj.segmentId, '');
  if (!segmentId && segmentIds.size > 0) return null;
  const objectType = normalizeProceduralObjectType(obj.objectType);
  const option = PROCEDURAL_OBJECT_OPTIONS.find((item) => item.id === objectType) ?? PROCEDURAL_OBJECT_OPTIONS[0];
  const state = normalizeProceduralObjectState(obj.state, objectType);
  const snapshot = normalizeProceduralSnapshot(obj.snapshot, state);
  const metadata = objectRecord(obj.metadata);
  return {
    id: obj.id,
    type: 'proceduralObject',
    objectType,
    label: stringValue(obj.label, option.label),
    segmentId,
    t: clamp(finiteNumber(obj.t, 0.5), 0, 1),
    lengthMm: sensibleNumber(obj.lengthMm, option.defaultLengthMm),
    state,
    snapshot,
    notes: optionalString(obj.notes),
    metadata: metadata ? { ...metadata } : undefined,
  };
}

function normalizePoint(raw: unknown): ComposerPoint | null {
  const point = objectRecord(raw);
  if (!point) return null;
  const x = finiteNumber(point.x, Number.NaN);
  const y = finiteNumber(point.y, Number.NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function normalizeProceduralObjectType(value: unknown): ProceduralObjectType {
  if (typeof value !== 'string') return 'guidewire';
  const normalized = value.trim();
  return PROCEDURAL_OBJECT_OPTIONS.some((option) => option.id === normalized)
    ? (normalized as ProceduralObjectType)
    : 'guidewire';
}

function normalizeProceduralObjectState(value: unknown, objectType: ProceduralObjectType): ProceduralObjectState {
  if (value === 'deployed' || value === 'undeployed' || value === 'positioned') return value;
  return objectType === 'balloon' || objectType === 'stent' || objectType === 'stentGraft'
    ? 'undeployed'
    : 'positioned';
}

function normalizeProceduralSnapshot(value: unknown, state: ProceduralObjectState): ProceduralObject['snapshot'] {
  if (value === 'pre' || value === 'positioned' || value === 'post') return value;
  if (state === 'deployed') return 'post';
  if (state === 'positioned') return 'positioned';
  return 'pre';
}

function error(field: string, message: string): PlanValidationIssue {
  return { severity: 'error', field, message };
}

function warning(field: string, message: string): PlanValidationIssue {
  return { severity: 'warning', field, message };
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizePathologyType(value: unknown, legacyValue?: string): PathologyType {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : legacyValue ?? 'normal';
  const normalized = raw.toLowerCase();
  if (normalized.includes('stenosis')) return 'stenosis';
  if (normalized.includes('occlusion')) return 'occlusion';
  if (normalized.includes('aneurysm')) return 'aneurysm';
  if (normalized.includes('dissection')) return 'dissection';
  if (normalized.includes('thrombus') || normalized.includes('thrombosis')) return 'thrombus';
  return PATHOLOGY_OPTIONS.some((option) => option.id === normalized)
    ? (normalized as PathologyType)
    : 'normal';
}

function normalizeTreatmentMarkerType(value: unknown): TreatmentMarkerType {
  if (typeof value !== 'string') return 'lesionStart';
  const normalized = value.trim();
  return TREATMENT_MARKER_OPTIONS.some((option) => option.id === normalized)
    ? (normalized as TreatmentMarkerType)
    : 'lesionStart';
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function sensibleNumber(value: unknown, fallback: number): number {
  const n = finiteNumber(value, fallback);
  return n > 0 ? n : fallback;
}

function isSensibleDiameter(value: number): boolean {
  return Number.isFinite(value) && value >= 1 && value <= 80;
}

function isSegment(value: VesselSegment | null): value is VesselSegment {
  return value !== null;
}

function isBifurcation(value: BifurcationNode | null): value is BifurcationNode {
  return value !== null;
}

function isDevicePlacement(value: DevicePlacement | null): value is DevicePlacement {
  return value !== null;
}

function isTreatmentMarker(value: TreatmentMarker | null): value is TreatmentMarker {
  return value !== null;
}

function isProceduralObject(value: ProceduralObject | null): value is ProceduralObject {
  return value !== null;
}

function shortDeviceLabel(device: Device): string {
  if (device.name.length <= 24) return device.name;
  const words = device.name.split(/\s+/).filter(Boolean);
  return words.slice(0, 3).join(' ') || device.name.slice(0, 24);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function makeLocalId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const SEGMENT_LABEL_OFFSET = 22;
const SEGMENT_LABEL_HEIGHT = 16;
const SEGMENT_LABEL_HALF_WIDTH = 64;

export function layoutSegmentLabels(
  segments: VesselSegment[],
  bounds: { width: number; height: number },
): Map<string, LabelLayoutEntry> {
  const layout = new Map<string, LabelLayoutEntry>();
  const placed: Array<{ x: number; y: number; w: number; h: number }> = [];

  const rectsOverlap = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
    Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h;

  for (const segment of segments) {
    const candidates = candidateLabelPositions(segment, bounds);
    let chosen = candidates[0];
    let chosenScore = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      const rect = {
        x: candidate.x,
        y: candidate.y,
        w: SEGMENT_LABEL_HALF_WIDTH * 2,
        h: SEGMENT_LABEL_HEIGHT * 2,
      };
      const collisions = placed.filter((existing) => rectsOverlap(existing, rect)).length;
      const edgePenalty = candidate.edgePenalty ?? 0;
      const score = collisions * 1000 + edgePenalty;
      if (score < chosenScore) {
        chosenScore = score;
        chosen = candidate;
      }
    }

    const primary = { x: chosen.x, y: chosen.y, anchor: chosen.anchor };
    const primaryRect = { x: chosen.x, y: chosen.y, w: SEGMENT_LABEL_HALF_WIDTH * 2, h: SEGMENT_LABEL_HEIGHT };
    placed.push(primaryRect);

    const secondaryY = chosen.y + 14;
    const secondaryRect = {
      x: chosen.x,
      y: secondaryY,
      w: SEGMENT_LABEL_HALF_WIDTH * 1.6,
      h: SEGMENT_LABEL_HEIGHT,
    };
    const secondaryCollides = placed.some((existing) => rectsOverlap(existing, secondaryRect));
    let secondary: LabelLayoutEntry['secondary'] = null;
    if (!secondaryCollides && secondaryY + SEGMENT_LABEL_HEIGHT < bounds.height - 8) {
      secondary = { x: chosen.x, y: secondaryY, anchor: chosen.anchor };
      placed.push(secondaryRect);
    }

    layout.set(segment.id, { segmentId: segment.id, primary, secondary });
  }

  return layout;
}

function candidateLabelPositions(
  segment: VesselSegment,
  bounds: { width: number; height: number },
): Array<{ x: number; y: number; anchor: 'start' | 'middle' | 'end'; edgePenalty?: number }> {
  const dx = segment.end.x - segment.start.x;
  const dy = segment.end.y - segment.start.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const nx = -uy;
  const ny = ux;
  const padX = SEGMENT_LABEL_HALF_WIDTH;
  const padY = SEGMENT_LABEL_HEIGHT;
  const clampX = (x: number) => clamp(x, padX, bounds.width - padX);
  const clampY = (y: number) => clamp(y, padY, bounds.height - padY);

  const offsets = [0.5, 0.35, 0.65, 0.25, 0.75];
  const sides: Array<{ sign: 1 | -1; anchor: 'start' | 'end' }> = [
    { sign: 1, anchor: nx >= 0 ? 'start' : 'end' },
    { sign: -1, anchor: -nx >= 0 ? 'start' : 'end' },
  ];

  const candidates: Array<{ x: number; y: number; anchor: 'start' | 'middle' | 'end'; edgePenalty?: number }> = [];
  for (const t of offsets) {
    const cx = segment.start.x + dx * t;
    const cy = segment.start.y + dy * t;
    for (const side of sides) {
      const ox = nx * SEGMENT_LABEL_OFFSET * side.sign;
      const oy = ny * SEGMENT_LABEL_OFFSET * side.sign;
      const x = clampX(cx + ox);
      const y = clampY(cy + oy);
      const dxClamp = Math.abs(x - (cx + ox));
      const dyClamp = Math.abs(y - (cy + oy));
      const edgePenalty = (dxClamp + dyClamp) * 4 + Math.abs(t - 0.5) * 60;
      candidates.push({ x, y, anchor: side.anchor, edgePenalty });
    }
  }
  return candidates;
}

export function snapNormalizedT(t: number, tolerance = 0.04): number {
  const stops = [0, 0.25, 0.5, 0.75, 1];
  for (const stop of stops) {
    if (Math.abs(t - stop) <= tolerance) return stop;
  }
  return t;
}

export function snapToGrid(value: number, grid = 20): number {
  return Math.round(value / grid) * grid;
}

export function findEndpointSnap(
  point: ComposerPoint,
  segments: VesselSegment[],
  excludeSegmentId: string | null,
  threshold = 14,
): ComposerPoint | null {
  let best: { point: ComposerPoint; distance: number } | null = null;
  for (const segment of segments) {
    if (segment.id === excludeSegmentId) continue;
    for (const candidate of [segment.start, segment.end]) {
      const d = Math.hypot(point.x - candidate.x, point.y - candidate.y);
      if (d <= threshold && (!best || d < best.distance)) {
        best = { point: { x: candidate.x, y: candidate.y }, distance: d };
      }
    }
  }
  return best?.point ?? null;
}

export function assessPlanReadiness(
  data: VesselCompositionData,
  issues: PlanValidationIssue[],
  fitWarnings: DeviceFitWarning[],
): PlanReadinessSummary {
  const errorCount = issues.filter((issue) => issue.severity === 'error').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
  const fitWarningCount = fitWarnings.filter((warning) => warning.severity === 'warning').length;
  const infoCount = fitWarnings.filter((warning) => warning.severity === 'info').length;
  const interventionTargets = data.segments.filter(
    (segment) => segment.targetForIntervention || segment.pathologyType !== 'normal',
  ).length;
  const segmentCount = data.segments.length;
  const notes = typeof data.metadata.notes === 'string' ? data.metadata.notes.trim() : '';

  let status: PlanReadinessSummary['status'] = 'ready';
  let headline = 'Plan is ready for review.';
  if (segmentCount === 0) {
    status = 'empty';
    headline = 'Add at least one vessel segment to begin planning.';
  } else if (errorCount > 0) {
    status = 'blocked';
    headline = `${errorCount} blocking issue${errorCount === 1 ? '' : 's'} must be resolved before saving.`;
  } else if (warningCount > 0 || fitWarningCount > 0) {
    status = 'warnings';
    const total = warningCount + fitWarningCount;
    headline = `${total} planning warning${total === 1 ? '' : 's'} to review.`;
  }

  return {
    status,
    errorCount,
    warningCount: warningCount + fitWarningCount,
    infoCount,
    segmentCount,
    deviceCount: data.devicePlacements.length,
    markerCount: data.treatmentMarkers.length,
    bifurcationCount: data.bifurcations.length,
    interventionTargets,
    unresolvedFitWarnings: fitWarningCount,
    hasNotes: notes.length > 0,
    headline,
  };
}
