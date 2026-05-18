// Advanced 2D synthetic angiogram renderer (Canvas 2D).
//
// Pure module: the React layer owns interaction; this only draws pixels and
// is wrapped so any failure makes the caller fall back to the legacy SVG.
// Public API (projectPoint / renderAngiogram / types / workspace consts) is
// stable across v0.37–v0.39 so the surrounding component and fallback stay
// intact.
//
// v0.39: the vessels + devices are painted into a single offscreen
// "contrast-density" buffer (non-uniform internal density, central column,
// streaking, edge falloff, irregular borders) which then receives one shared
// acquisition pass (motion softness, exposure gradient, scatter haze,
// detector grain/banding, vignette). This makes it read as a captured X-ray
// image rather than stacked vector shapes.

import type {
  BifurcationNode,
  DevicePlacement,
  ProceduralObject,
  VesselSegment,
} from '../../lib/vesselComposer';

export type AngioProjection = 'ap' | 'lao' | 'rao' | 'lateral';
export type AngioPreset = 'dsa' | 'fluoro' | 'roadmap';

export const ANGIO_WORKSPACE_WIDTH = 1000;
export const ANGIO_WORKSPACE_HEIGHT = 620;

export interface AngioRenderInput {
  segments: VesselSegment[];
  bifurcations: BifurcationNode[];
  devicePlacements: DevicePlacement[];
  proceduralObjects: ProceduralObject[];
  projection: AngioProjection;
  preset: AngioPreset;
  selectedId: string | null;
}

interface Pt {
  x: number;
  y: number;
}

// --- internal quality / tuning knobs (no UI yet, kept easy to adjust) ------

const TUNING = {
  vesselDensity: 0.94,
  edgeSoftness: 2.05,
  internalNoise: 0.2,
  contrastFalloff: 0.62,
  backgroundNoise: 1,
  roadmapTintStrength: 0.55,
  deviceOpacity: 0.95,
  centralColumn: 0.42,
  streakStrength: 0.16,
  branchDensity: 0.72,
  branchOpacity: 0.36,
  branchMaxLength: 98,
  dsaSharpness: 0.42,
  fluoroSoftness: 0.95,
  roadmapAlpha: 0.48,
  sideBranchFade: 0.78,
  backgroundContextStrength: 0.078,
};

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

const CX = ANGIO_WORKSPACE_WIDTH / 2;
const CY = ANGIO_WORKSPACE_HEIGHT / 2;

export function projectPoint(p: Pt, projection: AngioProjection): Pt {
  const dx = p.x - CX;
  const dy = p.y - CY;
  switch (projection) {
    case 'lao':
      return { x: CX + dx * 0.86 + dy * 0.13, y: CY + dy * 0.99 };
    case 'rao':
      return { x: CX + dx * 0.86 - dy * 0.13, y: CY + dy * 0.99 };
    case 'lateral':
      return { x: CX + dx * 0.46, y: CY + dy * 1.07 };
    case 'ap':
    default:
      return { x: p.x, y: p.y };
  }
}

function gaussian(t: number, center: number, sigma: number): number {
  return Math.exp(-Math.pow((t - center) / sigma, 2));
}

// --- deterministic noise (stable between renders) --------------------------

function seedFromId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hash01(n: number): number {
  let x = (n ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(seed: number, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = hash01(seed * 374761 + i * 668265263);
  const b = hash01(seed * 374761 + (i + 1) * 668265263);
  return a + (b - a) * smoothstep(f) - 0.5;
}

// --- curved centerline -----------------------------------------------------

interface Spline {
  a: Pt;
  c: Pt;
  b: Pt;
  nx: number;
  ny: number;
  len: number;
  seed: number;
}

function vesselBow(vesselType: string): number {
  const v = (vesselType || '').toLowerCase();
  if (v.includes('aorta')) return 0.35;
  if (v.includes('iliac')) return 0.7;
  if (v.includes('femoral') || v.includes('popliteal')) return 0.8;
  return 1;
}

function makeSpline(segment: VesselSegment, projection: AngioProjection): Spline {
  const a = projectPoint(segment.start, projection);
  const b = projectPoint(segment.end, projection);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const seed = seedFromId(segment.id);
  const sign = hash01(seed) < 0.5 ? -1 : 1;
  const bow = sign * len * 0.05 * vesselBow(segment.vesselType) * (0.55 + hash01(seed * 7));
  const c = { x: (a.x + b.x) / 2 + nx * bow, y: (a.y + b.y) / 2 + ny * bow };
  return { a, c, b, nx, ny, len, seed };
}

function splineAt(sp: Spline, t: number): Pt {
  const u = 1 - t;
  const bx = u * u * sp.a.x + 2 * u * t * sp.c.x + t * t * sp.b.x;
  const by = u * u * sp.a.y + 2 * u * t * sp.c.y + t * t * sp.b.y;
  const w = valueNoise(sp.seed + 101, t * 2.4) * sp.len * 0.018;
  return { x: bx + sp.nx * w, y: by + sp.ny * w };
}

function splineNormal(sp: Spline, t: number): Pt {
  const u = 1 - t;
  let tx = 2 * u * (sp.c.x - sp.a.x) + 2 * t * (sp.b.x - sp.c.x);
  let ty = 2 * u * (sp.c.y - sp.a.y) + 2 * t * (sp.b.y - sp.c.y);
  const m = Math.hypot(tx, ty) || 1;
  tx /= m;
  ty /= m;
  return { x: -ty, y: tx };
}

function splineTangent(sp: Spline, t: number): Pt {
  const u = 1 - t;
  let tx = 2 * u * (sp.c.x - sp.a.x) + 2 * t * (sp.b.x - sp.c.x);
  let ty = 2 * u * (sp.c.y - sp.a.y) + 2 * t * (sp.b.y - sp.c.y);
  const m = Math.hypot(tx, ty) || 1;
  tx /= m;
  ty /= m;
  return { x: tx, y: ty };
}

function normalizePoint(p: Pt): Pt {
  const m = Math.hypot(p.x, p.y) || 1;
  return { x: p.x / m, y: p.y / m };
}

// --- shared adaptive framing ----------------------------------------------

export interface AngioViewTransform {
  scale: number;
  tx: number;
  ty: number;
}

const IDENTITY_VIEW_TRANSFORM: AngioViewTransform = { scale: 1, tx: 0, ty: 0 };

function applyViewPoint(p: Pt, view: AngioViewTransform): Pt {
  return { x: p.x * view.scale + view.tx, y: p.y * view.scale + view.ty };
}

function applyViewContext(ctx: CanvasRenderingContext2D, view: AngioViewTransform): void {
  ctx.translate(view.tx, view.ty);
  ctx.scale(view.scale, view.scale);
}

export function projectAngioPoint(
  p: Pt,
  projection: AngioProjection,
  view: AngioViewTransform = IDENTITY_VIEW_TRANSFORM,
): Pt {
  return applyViewPoint(projectPoint(p, projection), view);
}

export function computeAngioViewTransform(input: Pick<AngioRenderInput, 'segments' | 'projection'>): AngioViewTransform {
  if (input.segments.length === 0) return IDENTITY_VIEW_TRANSFORM;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  input.segments.forEach((segment) => {
    const sp = makeSpline(segment, input.projection);
    for (let i = 0; i <= 12; i += 1) {
      const p = splineAt(sp, i / 12);
      const pad = Math.max(baseDiameterPixels(segment, i / 12) * 0.75, 12);
      minX = Math.min(minX, p.x - pad);
      minY = Math.min(minY, p.y - pad);
      maxX = Math.max(maxX, p.x + pad);
      maxY = Math.max(maxY, p.y + pad);
    }
  });

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return IDENTITY_VIEW_TRANSFORM;
  }

  const width = Math.max(maxX - minX, 1);
  const height = Math.max(maxY - minY, 1);
  const margin = { left: 82, right: 126, top: 96, bottom: 62 };
  const availW = ANGIO_WORKSPACE_WIDTH - margin.left - margin.right;
  const availH = ANGIO_WORKSPACE_HEIGHT - margin.top - margin.bottom;
  const fit = Math.min(availW / width, availH / height);
  const scale = clamp(fit, 0.86, 1.34);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const targetX = ANGIO_WORKSPACE_WIDTH * 0.5;
  const targetY = ANGIO_WORKSPACE_HEIGHT * 0.53;
  const minTx = ANGIO_WORKSPACE_WIDTH - margin.right - maxX * scale;
  const maxTx = margin.left - minX * scale;
  const minTy = ANGIO_WORKSPACE_HEIGHT - margin.bottom - maxY * scale;
  const maxTy = margin.top - minY * scale;
  const tx = clamp(targetX - centerX * scale, Math.min(minTx, maxTx), Math.max(minTx, maxTx));
  const ty = clamp(targetY - centerY * scale, Math.min(minTy, maxTy), Math.max(minTy, maxTy));

  return {
    scale: Math.abs(scale - 1) < 0.015 ? 1 : scale,
    tx: Math.abs(tx) < 0.5 ? 0 : tx,
    ty: Math.abs(ty) < 0.5 ? 0 : ty,
  };
}

// --- lumen profile ---------------------------------------------------------

function baseDiameterPixels(segment: VesselSegment, t: number): number {
  const prox = clamp(segment.proximalDiameterMm, 1.5, 30);
  const dist = clamp(segment.distalDiameterMm, 1.2, 30);
  return (prox + (dist - prox) * t) * 1.55 + 3;
}

function aneurysmExtra(segment: VesselSegment, t: number): number {
  if (segment.pathologyType !== 'aneurysm') return 0;
  const base = baseDiameterPixels(segment, t);
  return base * 1.05 * gaussian(t, 0.5, 0.2);
}

function isSaccular(segment: VesselSegment): boolean {
  const meta = segment.metadata as Record<string, unknown> | undefined;
  const shape = typeof meta?.aneurysmShape === 'string' ? (meta.aneurysmShape as string) : '';
  const text = `${shape} ${segment.notes ?? ''} ${segment.label ?? ''}`.toLowerCase();
  return text.includes('saccular');
}

function baseHalf(segment: VesselSegment, t: number): number {
  const base = baseDiameterPixels(segment, t);
  const lesion = gaussian(t, 0.5, 0.13);
  switch (segment.pathologyType) {
    case 'stenosis': {
      const sev = clamp(segment.severityPercent ?? 65, 10, 95) / 100;
      let h = base * (1 - sev * 0.82 * lesion);
      if (sev > 0.6) {
        const post = gaussian(t, 0.68, 0.07);
        h *= 1 + post * 0.12 * (valueNoise(seedFromId(segment.id) + 41, t * 9) + 0.5);
      }
      return Math.max(1.4, h / 2);
    }
    case 'thrombus':
      return (base * (1 - 0.14 * lesion)) / 2;
    default:
      return base / 2;
  }
}

function sideHalf(segment: VesselSegment, sp: Spline, t: number, side: 1 | -1): number {
  const h = baseHalf(segment, t);
  // Irregular, deterministic borders. Aneurysm gets a wavier wall.
  const aneurysmWall = segment.pathologyType === 'aneurysm' ? 1.9 : 1;
  const n =
    valueNoise(sp.seed + (side === 1 ? 7 : 23), t * 5) * 0.13 * aneurysmWall +
    valueNoise(sp.seed + (side === 1 ? 53 : 71), t * 1.6) * 0.08 * aneurysmWall;
  let half = h * (1 + n);
  const bulge = aneurysmExtra(segment, t);
  if (bulge > 0) {
    if (isSaccular(segment)) {
      half += side === 1 ? bulge * 1.05 : bulge * 0.12;
    } else {
      // Fusiform: both walls dilate but asymmetrically (no perfect oval).
      half += bulge * (side === 1 ? 0.58 : 0.44);
    }
  }
  return Math.max(1.2, half);
}

// --- preset config ---------------------------------------------------------

interface PresetConfig {
  bg: [string, string, string];
  ink: string; // rgb of the contrast/device "exposure" in the scene buffer
  density: number; // overall lumen density multiplier
  haze: number; // scatter lift
  noise: number; // detector grain
  banding: number; // detector banding strength
  silhouettes: boolean;
  roadmapGhost: boolean;
  tint: string | null; // roadmap tint rgb
  vignette: string;
}

function presetConfig(preset: AngioPreset): PresetConfig {
  switch (preset) {
    case 'dsa':
      return {
        bg: ['#edeff0', '#dde0e1', '#c8ccce'],
        ink: '20,22,26',
        density: 0.98,
        haze: 0.018,
        noise: 0.022,
        banding: 0.01,
        silhouettes: false,
        roadmapGhost: false,
        tint: null,
        vignette: 'rgba(38,42,46,0.4)',
      };
    case 'roadmap':
      return {
        bg: ['#0e1620', '#091018', '#04080d'],
        ink: '150,170,178',
        density: 0.52,
        haze: 0.05,
        noise: 0.08,
        banding: 0.03,
        silhouettes: true,
        roadmapGhost: true,
        tint: '95,150,165',
        vignette: 'rgba(0,0,0,0.58)',
      };
    case 'fluoro':
    default:
      return {
        bg: ['#12171d', '#0b0f14', '#050709'],
        ink: '208,216,222',
        density: 0.5,
        haze: 0.06,
        noise: 0.16,
        banding: 0.035,
        silhouettes: true,
        roadmapGhost: false,
        tint: null,
        vignette: 'rgba(0,0,0,0.6)',
      };
  }
}

function withFilter(ctx: CanvasRenderingContext2D, filter: string, fn: () => void): void {
  let applied = false;
  try {
    if ('filter' in ctx) {
      ctx.filter = filter;
      applied = true;
    }
  } catch {
    applied = false;
  }
  fn();
  if (applied) {
    try {
      ctx.filter = 'none';
    } catch {
      /* ignore */
    }
  }
}

// --- cached offscreen layers ----------------------------------------------

interface Cached {
  scene: HTMLCanvasElement | null;
  grain: { c: HTMLCanvasElement; key: string } | null;
  internal: HTMLCanvasElement | null;
  banding: HTMLCanvasElement | null;
  branches: Map<string, SyntheticBranch[]>;
  branchOrder: string[];
}
const cache: Cached = {
  scene: null,
  grain: null,
  internal: null,
  banding: null,
  branches: new Map(),
  branchOrder: [],
};

function sceneCanvas(): HTMLCanvasElement | null {
  if (cache.scene) return cache.scene;
  const c = document.createElement('canvas');
  c.width = ANGIO_WORKSPACE_WIDTH;
  c.height = ANGIO_WORKSPACE_HEIGHT;
  cache.scene = c;
  return c;
}

function grainCanvas(amount: number): HTMLCanvasElement | null {
  const key = amount.toFixed(3);
  if (cache.grain && cache.grain.key === key) return cache.grain.c;
  const size = 240;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  if (!g) return null;
  const img = g.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 128 + (Math.random() - 0.5) * 255;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = Math.random() * 255 * amount;
  }
  g.putImageData(img, 0, 0);
  cache.grain = { c, key };
  return c;
}

// Low-frequency blotchy field used to break up flat lumen contrast.
function internalNoiseCanvas(): HTMLCanvasElement | null {
  if (cache.internal) return cache.internal;
  const cells = 26;
  const small = document.createElement('canvas');
  small.width = cells;
  small.height = cells;
  const sg = small.getContext('2d');
  if (!sg) return null;
  const img = sg.createImageData(cells, cells);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  sg.putImageData(img, 0, 0);
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d');
  if (!g) return null;
  withFilter(g, 'blur(7px)', () => {
    g.imageSmoothingEnabled = true;
    g.drawImage(small, 0, 0, 256, 256);
  });
  cache.internal = c;
  return c;
}

function bandingCanvas(): HTMLCanvasElement | null {
  if (cache.banding) return cache.banding;
  const c = document.createElement('canvas');
  c.width = 6;
  c.height = 6;
  const g = c.getContext('2d');
  if (!g) return null;
  g.clearRect(0, 0, 6, 6);
  g.fillStyle = 'rgba(255,255,255,0.5)';
  g.fillRect(0, 0, 6, 1);
  g.fillRect(0, 0, 1, 6);
  cache.banding = c;
  return c;
}

// --- procedural visual-only runoff branches -------------------------------

type BranchKind = 'aorta' | 'iliac' | 'lower' | 'visceral' | 'carotid' | 'dialysis' | 'generic';

interface BranchProfile {
  kind: BranchKind;
  baseCount: number;
  maxCount: number;
  minT: number;
  maxT: number;
  lengthMin: number;
  lengthMax: number;
  widthFactor: number;
  opacity: number;
  forwardBias: number;
  sideBias: number;
  arborize: number;
  terminalRunoff: boolean;
}

interface SyntheticBranch {
  id: string;
  segmentId: string;
  parentT: number;
  points: Pt[];
  width0: number;
  width1: number;
  opacity: number;
  generation: number;
}

const BRANCH_CACHE_LIMIT = 18;

function branchProfile(segment: VesselSegment): BranchProfile {
  const text = `${segment.vesselType} ${segment.label} ${segment.notes ?? ''}`.toLowerCase();
  if (text.includes('carotid') || text.includes('vertebral') || text.includes('cerebral')) {
    return {
      kind: 'carotid',
      baseCount: 3,
      maxCount: 5,
      minT: 0.2,
      maxT: 0.9,
      lengthMin: 32,
      lengthMax: 68,
      widthFactor: 0.15,
      opacity: 0.44,
      forwardBias: 0.45,
      sideBias: 0.9,
      arborize: 1,
      terminalRunoff: false,
    };
  }
  if (
    text.includes('dialysis') ||
    text.includes('access') ||
    text.includes('fistula') ||
    text.includes('graft') ||
    text.includes('brachial') ||
    text.includes('radial') ||
    text.includes('ulnar') ||
    text.includes('cephalic') ||
    text.includes('basilic')
  ) {
    return {
      kind: 'dialysis',
      baseCount: 2,
      maxCount: 3,
      minT: 0.18,
      maxT: 0.9,
      lengthMin: 28,
      lengthMax: 58,
      widthFactor: 0.13,
      opacity: 0.34,
      forwardBias: 0.35,
      sideBias: 0.8,
      arborize: 0,
      terminalRunoff: false,
    };
  }
  if (
    text.includes('renal') ||
    text.includes('sma') ||
    text.includes('celiac') ||
    text.includes('mesenteric') ||
    text.includes('visceral')
  ) {
    return {
      kind: 'visceral',
      baseCount: 5,
      maxCount: 8,
      minT: 0.32,
      maxT: 0.96,
      lengthMin: 36,
      lengthMax: 78,
      widthFactor: 0.17,
      opacity: 0.5,
      forwardBias: 0.54,
      sideBias: 0.78,
      arborize: 2,
      terminalRunoff: false,
    };
  }
  if (
    text.includes('femoral') ||
    text.includes('profunda') ||
    text.includes('popliteal') ||
    text.includes('tibial') ||
    text.includes('peroneal')
  ) {
    return {
      kind: 'lower',
      baseCount: 4,
      maxCount: 7,
      minT: 0.14,
      maxT: 0.96,
      lengthMin: 48,
      lengthMax: 105,
      widthFactor: 0.18,
      opacity: 0.46,
      forwardBias: 0.5,
      sideBias: 0.7,
      arborize: 1,
      terminalRunoff: true,
    };
  }
  if (text.includes('iliac')) {
    return {
      kind: 'iliac',
      baseCount: 3,
      maxCount: 5,
      minT: 0.18,
      maxT: 0.9,
      lengthMin: 42,
      lengthMax: 86,
      widthFactor: 0.16,
      opacity: 0.42,
      forwardBias: 0.34,
      sideBias: 0.86,
      arborize: 1,
      terminalRunoff: false,
    };
  }
  if (text.includes('aorta')) {
    const visceral = text.includes('visceral') || text.includes('abdominal');
    return {
      kind: 'aorta',
      baseCount: visceral ? 3 : 2,
      maxCount: visceral ? 5 : 4,
      minT: 0.16,
      maxT: 0.88,
      lengthMin: 40,
      lengthMax: 84,
      widthFactor: 0.12,
      opacity: 0.38,
      forwardBias: 0.06,
      sideBias: 1,
      arborize: 0,
      terminalRunoff: false,
    };
  }
  return {
    kind: 'generic',
    baseCount: 1,
    maxCount: 2,
    minT: 0.25,
    maxT: 0.82,
    lengthMin: 30,
    lengthMax: 58,
    widthFactor: 0.13,
    opacity: 0.32,
    forwardBias: 0.42,
    sideBias: 0.78,
    arborize: 0,
    terminalRunoff: false,
  };
}

function branchCacheKey(input: AngioRenderInput): string {
  return JSON.stringify({
    projection: input.projection,
    segments: input.segments.map((s) => [
      s.id,
      s.label,
      s.vesselType,
      s.start.x,
      s.start.y,
      s.end.x,
      s.end.y,
      s.proximalDiameterMm,
      s.distalDiameterMm,
      s.lengthMm,
    ]),
  });
}

function getSyntheticBranches(input: AngioRenderInput, splines: Map<string, Spline>): SyntheticBranch[] {
  const key = branchCacheKey(input);
  const cached = cache.branches.get(key);
  if (cached) return cached;

  const branches: SyntheticBranch[] = [];
  input.segments.forEach((segment) => {
    const sp = splines.get(segment.id);
    if (!sp) return;
    branches.push(...generateBranchesForSegment(segment, sp));
  });

  cache.branches.set(key, branches);
  cache.branchOrder.push(key);
  while (cache.branchOrder.length > BRANCH_CACHE_LIMIT) {
    const stale = cache.branchOrder.shift();
    if (stale) cache.branches.delete(stale);
  }
  return branches;
}

function generateBranchesForSegment(segment: VesselSegment, sp: Spline): SyntheticBranch[] {
  const profile = branchProfile(segment);
  const seed = sp.seed ^ seedFromId(`${segment.vesselType}:${segment.label}`);
  const lengthFactor = clamp(Math.sqrt(Math.max(segment.lengthMm, sp.len) / 110), 0.75, 1.55);
  const jitter = 0.82 + hash01(seed + 17) * 0.42;
  const count = clamp(
    Math.round(profile.baseCount * lengthFactor * jitter * TUNING.branchDensity),
    profile.baseCount > 1 ? 1 : 0,
    profile.maxCount,
  );
  const out: SyntheticBranch[] = [];

  for (let i = 0; i < count; i += 1) {
    const branchSeed = seed + i * 9973;
    const slot = (i + 0.24 + hash01(branchSeed + 3) * 0.52) / Math.max(count, 1);
    const t = clamp(profile.minT + (profile.maxT - profile.minT) * slot, 0.06, 0.98);
    const side = (i % 2 === 0 ? 1 : -1) * (hash01(branchSeed + 11) < 0.18 ? -1 : 1) as 1 | -1;
    out.push(makeBranch(segment, sp, profile, branchSeed, t, side, 1));
  }

  if (profile.terminalRunoff && count > 0) {
    for (let i = 0; i < 2; i += 1) {
      const branchSeed = seed + 40111 + i * 1877;
      const t = clamp(0.78 + i * 0.12 + hash01(branchSeed) * 0.04, 0.74, 0.98);
      const side = (i === 0 ? 1 : -1) as 1 | -1;
      out.push(makeBranch(segment, sp, profile, branchSeed, t, side, 1, 1.12));
    }
  }

  const children: SyntheticBranch[] = [];
  out.forEach((branch, index) => {
    if (profile.arborize <= 0 || branch.generation !== 1) return;
    const childCount = profile.arborize === 2 && hash01(seed + index * 43) > 0.35 ? 2 : 1;
    for (let i = 0; i < childCount; i += 1) {
      const childSeed = seed + index * 593 + i * 1777;
      const base = branch.points[Math.min(branch.points.length - 2, 2 + i)] ?? branch.points[branch.points.length - 1];
      const tip = branch.points[Math.min(branch.points.length - 1, 3 + i)] ?? branch.points[branch.points.length - 1];
      const dir = normalizePoint({ x: tip.x - base.x, y: tip.y - base.y });
      const side = (hash01(childSeed) < 0.5 ? 1 : -1) as 1 | -1;
      const nrm = { x: -dir.y * side, y: dir.x * side };
      const len = Math.min(TUNING.branchMaxLength * 0.55, branchLength(profile, childSeed) * 0.46);
      const points = [base];
      const bend = (hash01(childSeed + 5) - 0.5) * len * 0.22;
      for (let j = 1; j <= 3; j += 1) {
        const u = j / 3;
        points.push({
          x: base.x + (dir.x * 0.75 + nrm.x * 0.7) * len * u + nrm.y * bend * Math.sin(u * Math.PI),
          y: base.y + (dir.y * 0.75 + nrm.y * 0.7) * len * u - nrm.x * bend * Math.sin(u * Math.PI),
        });
      }
      children.push({
        id: `${branch.id}-a${i}`,
        segmentId: branch.segmentId,
        parentT: branch.parentT,
        points,
        width0: Math.max(0.45, branch.width0 * 0.58),
        width1: Math.max(0.25, branch.width1 * 0.55),
        opacity: branch.opacity * 0.62,
        generation: 2,
      });
    }
  });

  return [...out, ...children].slice(0, 12);
}

function branchLength(profile: BranchProfile, seed: number): number {
  const base = profile.lengthMin + (profile.lengthMax - profile.lengthMin) * hash01(seed + 29);
  return Math.min(TUNING.branchMaxLength, base);
}

function makeBranch(
  segment: VesselSegment,
  sp: Spline,
  profile: BranchProfile,
  seed: number,
  t: number,
  side: 1 | -1,
  generation: number,
  lengthBoost = 1,
): SyntheticBranch {
  const anchor = splineAt(sp, t);
  const tan = splineTangent(sp, t);
  const nrm = splineNormal(sp, t);
  const sideBias = profile.sideBias * side * (0.74 + hash01(seed + 7) * 0.46);
  const forwardBias = profile.forwardBias + (hash01(seed + 13) - 0.5) * 0.34;
  const dir = normalizePoint({
    x: tan.x * forwardBias + nrm.x * sideBias,
    y: tan.y * forwardBias + nrm.y * sideBias,
  });
  const perp = { x: -dir.y, y: dir.x };
  const len = branchLength(profile, seed) * lengthBoost;
  const bend = (hash01(seed + 23) - 0.5) * len * 0.34 + side * len * 0.08;
  const points = [anchor];
  const samples = profile.kind === 'visceral' || profile.kind === 'lower' ? 5 : 4;

  for (let i = 1; i <= samples; i += 1) {
    const u = i / samples;
    const fine = valueNoise(seed + 301, u * 3.5) * len * 0.05;
    points.push({
      x: anchor.x + dir.x * len * Math.pow(u, 0.95) + perp.x * (bend * Math.sin(u * Math.PI) + fine),
      y: anchor.y + dir.y * len * Math.pow(u, 0.95) + perp.y * (bend * Math.sin(u * Math.PI) + fine),
    });
  }

  const width0 = clamp(baseHalf(segment, t) * profile.widthFactor * (0.78 + hash01(seed + 41) * 0.5), 0.65, 3.2);
  return {
    id: `${segment.id}-runoff-${seed >>> 0}-${generation}`,
    segmentId: segment.id,
    parentT: t,
    points,
    width0,
    width1: Math.max(0.28, width0 * (0.22 + hash01(seed + 47) * 0.12)),
    opacity: profile.opacity * (generation === 1 ? 1 : 0.64),
    generation,
  };
}

function flowDensity(segment: VesselSegment, t: number, preset: AngioPreset): number {
  if (segment.pathologyType === 'occlusion') {
    if (t <= 0.6) return 1;
    if (preset === 'roadmap') return clamp((1 - (t - 0.6) / 0.4) * 0.16, 0, 0.16);
    return 0;
  }
  if (segment.pathologyType === 'stenosis') {
    const sev = clamp(segment.severityPercent ?? 65, 10, 95) / 100;
    if (sev <= 0.68 || t < 0.5) return 1;
    const distal = smoothstep(clamp((t - 0.5) / 0.42, 0, 1));
    return 1 - clamp((sev - 0.68) * 0.55, 0, 0.16) * distal;
  }
  return 1;
}

function paintSyntheticBranches(
  octx: CanvasRenderingContext2D,
  branches: SyntheticBranch[],
  segments: VesselSegment[],
  cfg: PresetConfig,
  preset: AngioPreset,
): void {
  if (branches.length === 0) return;
  const segmentMap = new Map(segments.map((s) => [s.id, s]));
  const presetFactor = preset === 'dsa' ? 1.05 : preset === 'roadmap' ? TUNING.roadmapAlpha : 0.72;
  const blur = preset === 'dsa' ? 0.55 : preset === 'roadmap' ? 1.35 : TUNING.fluoroSoftness;

  octx.save();
  octx.lineCap = 'round';
  octx.lineJoin = 'round';
  branches.forEach((branch) => {
    const segment = segmentMap.get(branch.segmentId);
    if (!segment) return;
    const flow = flowDensity(segment, branch.parentT, preset);
    if (flow <= 0.01) return;
    drawBranchStroke(octx, branch, cfg.ink, branch.opacity * TUNING.branchOpacity * presetFactor * flow, blur, true);
    drawBranchStroke(octx, branch, cfg.ink, branch.opacity * TUNING.branchOpacity * presetFactor * flow * 1.35, 0, false);
  });
  octx.restore();
}

function drawBranchStroke(
  octx: CanvasRenderingContext2D,
  branch: SyntheticBranch,
  ink: string,
  alpha: number,
  blur: number,
  soft: boolean,
): void {
  const paint = () => {
    for (let i = 0; i < branch.points.length - 1; i += 1) {
      const a = branch.points[i];
      const b = branch.points[i + 1];
      const u = (i + 1) / (branch.points.length - 1);
      const fade = clamp(1 - TUNING.sideBranchFade * Math.pow(u, 1.05), 0.08, 1);
      octx.strokeStyle = `rgba(${ink},${alpha * fade})`;
      octx.lineWidth = (branch.width0 + (branch.width1 - branch.width0) * u) * (soft ? 2.2 : 1);
      octx.beginPath();
      octx.moveTo(a.x, a.y);
      octx.lineTo(b.x, b.y);
      octx.stroke();
    }
  };
  if (blur > 0) withFilter(octx, `blur(${blur}px)`, paint);
  else paint();
}

// --- scene painting (into the offscreen density buffer) --------------------

function ribbonPath(
  ctx: CanvasRenderingContext2D,
  segment: VesselSegment,
  sp: Spline,
  t1: number,
  t2: number,
  scale: number,
): void {
  const samples = 30;
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i < samples; i += 1) {
    const t = t1 + (t2 - t1) * (i / (samples - 1));
    const c = splineAt(sp, t);
    const nrm = splineNormal(sp, t);
    const hl = sideHalf(segment, sp, t, 1) * scale;
    const hr = sideHalf(segment, sp, t, -1) * scale;
    left.push({ x: c.x + nrm.x * hl, y: c.y + nrm.y * hl });
    right.unshift({ x: c.x - nrm.x * hr, y: c.y - nrm.y * hr });
  }
  const pts = [...left, ...right];
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
}

function lengthDensity(t: number): number {
  // Strong inflow, gentle taper, weaker distal runoff.
  return clamp(1 - TUNING.contrastFalloff * Math.pow(t, 1.35), 0.22, 1);
}

function paintSegment(
  octx: CanvasRenderingContext2D,
  segment: VesselSegment,
  sp: Spline,
  cfg: PresetConfig,
  preset: AngioPreset,
): void {
  const occluded = segment.pathologyType === 'occlusion';
  const lumenEnd = occluded ? 0.6 : 1;
  const ink = cfg.ink;
  const baseA = cfg.density * TUNING.vesselDensity;
  const edgeSoftness =
    preset === 'dsa' ? Math.max(1.1, TUNING.edgeSoftness - 0.75) : preset === 'roadmap' ? 2.3 : TUNING.edgeSoftness;
  const centralBlur = preset === 'dsa' ? TUNING.dsaSharpness : preset === 'roadmap' ? 1.15 : 0.85;
  const centralScale = preset === 'dsa' ? 0.34 : 0.42;
  const densityAt = (t: number) => lengthDensity(t) * flowDensity(segment, t, preset);

  // Soft outer margin (edge falloff — no hard vector edge).
  withFilter(octx, `blur(${edgeSoftness}px)`, () => {
    ribbonPath(octx, segment, sp, 0, lumenEnd, 1.06);
    octx.fillStyle = `rgba(${ink},${baseA * 0.34})`;
    octx.fill();
  });

  // Body density with proximal→distal falloff (gradient along the chord).
  const grad = octx.createLinearGradient(sp.a.x, sp.a.y, sp.b.x, sp.b.y);
  grad.addColorStop(0, `rgba(${ink},${baseA * 0.86})`);
  grad.addColorStop(0.55, `rgba(${ink},${baseA * 0.74 * densityAt(0.55)})`);
  grad.addColorStop(1, `rgba(${ink},${baseA * 0.64 * densityAt(lumenEnd)})`);
  ribbonPath(octx, segment, sp, 0, lumenEnd, 0.96);
  octx.fillStyle = grad;
  octx.fill();

  octx.save();
  ribbonPath(octx, segment, sp, 0, lumenEnd, 0.96);
  octx.clip();

  // Patchy internal density — breaks up the flat fill.
  const tile = internalNoiseCanvas();
  if (tile) {
    const pat = octx.createPattern(tile, 'repeat');
    if (pat) {
      octx.save();
      octx.globalCompositeOperation = 'destination-out';
      octx.globalAlpha = TUNING.internalNoise;
      octx.fillStyle = pat;
      octx.fillRect(0, 0, ANGIO_WORKSPACE_WIDTH, ANGIO_WORKSPACE_HEIGHT);
      octx.restore();
    }
  }

  // Brighter central contrast column down the lumen.
  withFilter(octx, `blur(${centralBlur}px)`, () => {
    ribbonPath(octx, segment, sp, 0, lumenEnd, centralScale);
    octx.fillStyle = `rgba(${ink},${baseA * TUNING.centralColumn * (preset === 'dsa' ? 1.26 : 1)})`;
    octx.fill();
  });

  // Faint directional streaking along the vessel axis.
  octx.globalAlpha = TUNING.streakStrength;
  octx.strokeStyle = `rgba(${ink},1)`;
  octx.lineWidth = 0.8;
  for (let s = -2; s <= 2; s += 1) {
    octx.beginPath();
    for (let i = 0; i <= 18; i += 1) {
      const t = (i / 18) * lumenEnd;
      const c = splineAt(sp, t);
      const nrm = splineNormal(sp, t);
      const off = (s / 2) * baseHalf(segment, t) * 0.7 + valueNoise(sp.seed + s * 13, t * 6) * 2;
      const x = c.x + nrm.x * off;
      const y = c.y + nrm.y * off;
      if (i === 0) octx.moveTo(x, y);
      else octx.lineTo(x, y);
    }
    octx.stroke();
  }
  octx.globalAlpha = 1;
  octx.restore();

  if (segment.pathologyType === 'aneurysm') {
    // Lower-density sac with an eccentric mural-thrombus-like crescent and a
    // preserved central flow channel — not a uniformly opacified oval.
    octx.save();
    ribbonPath(octx, segment, sp, 0.18, 0.82, 1.0);
    octx.clip();
    // knock the sac density down so it isn't a solid blob
    octx.globalCompositeOperation = 'destination-out';
    withFilter(octx, 'blur(5px)', () => {
      ribbonPath(octx, segment, sp, 0.2, 0.8, 0.95);
      octx.fillStyle = 'rgba(0,0,0,0.42)';
      octx.fill();
    });
    // eccentric thrombus crescent on one wall
    const side = hash01(sp.seed + 5) < 0.5 ? 1 : -1;
    withFilter(octx, 'blur(6px)', () => {
      octx.beginPath();
      for (let i = 0; i <= 22; i += 1) {
        const t = 0.22 + (0.56 * i) / 22;
        const c = splineAt(sp, t);
        const nrm = splineNormal(sp, t);
        const o = sideHalf(segment, sp, t, side === 1 ? 1 : -1) * (0.45 + 0.3 * gaussian(t, 0.5, 0.22));
        octx.lineTo(c.x + nrm.x * o * side, c.y + nrm.y * o * side);
      }
      for (let i = 22; i >= 0; i -= 1) {
        const t = 0.22 + (0.56 * i) / 22;
        const c = splineAt(sp, t);
        octx.lineTo(c.x, c.y);
      }
      octx.closePath();
      octx.fillStyle = 'rgba(0,0,0,0.5)';
      octx.fill();
    });
    octx.restore();
    // central flow channel kept brighter
    octx.save();
    withFilter(octx, 'blur(1.6px)', () => {
      ribbonPath(octx, segment, sp, 0.16, 0.84, 0.3);
      octx.fillStyle = `rgba(${ink},${baseA * 0.8})`;
      octx.fill();
    });
    octx.restore();
  }

  if (occluded) {
    const cut = splineAt(sp, lumenEnd);
    const nrm = splineNormal(sp, lumenEnd);
    const h = sideHalf(segment, sp, lumenEnd, 1) * 0.95;
    octx.strokeStyle = `rgba(${ink},${baseA})`;
    octx.lineWidth = 2;
    octx.beginPath();
    octx.moveTo(cut.x + nrm.x * h, cut.y + nrm.y * h);
    octx.lineTo(cut.x - nrm.x * h, cut.y - nrm.y * h);
    octx.stroke();
    if (preset === 'roadmap') {
      withFilter(octx, 'blur(4px)', () => {
        ribbonPath(octx, segment, sp, 0.78, 1, 0.42);
        octx.fillStyle = `rgba(${ink},${baseA * 0.1})`;
        octx.fill();
      });
    }
  }

  if (segment.pathologyType === 'thrombus') {
    const m = splineAt(sp, 0.52);
    const nrm = splineNormal(sp, 0.52);
    octx.save();
    octx.globalCompositeOperation = 'destination-out';
    withFilter(octx, 'blur(4px)', () => {
      octx.beginPath();
      octx.ellipse(
        m.x,
        m.y,
        baseHalf(segment, 0.52) * 0.6,
        baseHalf(segment, 0.52) * 1.5,
        Math.atan2(nrm.x, -nrm.y),
        0,
        Math.PI * 2,
      );
      octx.fillStyle = 'rgba(0,0,0,0.5)';
      octx.fill();
    });
    octx.restore();
  }

  if (segment.pathologyType === 'dissection') {
    octx.save();
    octx.globalCompositeOperation = 'destination-out';
    octx.lineWidth = 1.6;
    octx.strokeStyle = 'rgba(0,0,0,0.5)';
    octx.beginPath();
    for (let i = 0; i <= 22; i += 1) {
      const t = 0.16 + (0.68 * i) / 22;
      const c = splineAt(sp, t);
      const nrm = splineNormal(sp, t);
      const off = baseHalf(segment, t) * 0.42 * Math.sin(t * Math.PI);
      const x = c.x + nrm.x * off;
      const y = c.y + nrm.y * off;
      if (i === 0) octx.moveTo(x, y);
      else octx.lineTo(x, y);
    }
    octx.stroke();
    octx.restore();
  }
}

function paintJunctions(
  octx: CanvasRenderingContext2D,
  input: AngioRenderInput,
  splines: Map<string, Spline>,
  cfg: PresetConfig,
): void {
  input.bifurcations.forEach((node) => {
    const related = [node.parentSegmentId, ...node.childSegmentIds]
      .map((id) => input.segments.find((s) => s.id === id))
      .filter((s): s is VesselSegment => !!s);
    if (related.length === 0) return;
    const p = projectPoint(node.position, input.projection);
    const r =
      related.reduce(
        (acc, s) => Math.max(acc, baseHalf(s, s.id === node.parentSegmentId ? 1 : 0)),
        4,
      ) * 1.7;
    // Organic contrast pooling — soft, slightly elliptical, no bright diamond.
    octx.save();
    octx.translate(p.x, p.y);
    octx.rotate(hash01(seedFromId(node.id)) * Math.PI);
    withFilter(octx, 'blur(4px)', () => {
      const g = octx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, `rgba(${cfg.ink},${cfg.density * 0.6})`);
      g.addColorStop(0.65, `rgba(${cfg.ink},${cfg.density * 0.3})`);
      g.addColorStop(1, `rgba(${cfg.ink},0)`);
      octx.fillStyle = g;
      octx.beginPath();
      octx.ellipse(0, 0, r * 1.05, r * 0.78, 0, 0, Math.PI * 2);
      octx.fill();
    });
    octx.restore();
  });
}

function objectPathIds(object: ProceduralObject, input: AngioRenderInput): string[] {
  const raw = object.pathSegmentIds.length > 0 ? object.pathSegmentIds : [object.segmentId];
  const ids = raw.filter((id) => input.segments.some((segment) => segment.id === id));
  if (!ids.includes(object.segmentId) && input.segments.some((segment) => segment.id === object.segmentId)) {
    ids.push(object.segmentId);
  }
  return Array.from(new Set(ids));
}

function pathLengthForSegment(segment: VesselSegment): number {
  return Math.max(segment.lengthMm, 1);
}

function procedureProgressMm(object: ProceduralObject, input: AngioRenderInput): number {
  const ids = objectPathIds(object, input);
  let cursor = 0;
  for (const id of ids) {
    const segment = input.segments.find((item) => item.id === id);
    if (!segment) continue;
    const len = pathLengthForSegment(segment);
    if (id === object.segmentId) return cursor + len * clamp(object.t, 0, 1);
    cursor += len;
  }
  return cursor;
}

function sampleProcedurePath(
  object: ProceduralObject,
  input: AngioRenderInput,
  splines: Map<string, Spline>,
  startMm: number,
  endMm: number,
): Pt[] {
  const ids = objectPathIds(object, input);
  const pts: Pt[] = [];
  let cursor = 0;
  ids.forEach((id) => {
    const segment = input.segments.find((item) => item.id === id);
    const sp = splines.get(id);
    if (!segment || !sp) return;
    const len = pathLengthForSegment(segment);
    const a = Math.max(startMm, cursor);
    const b = Math.min(endMm, cursor + len);
    if (b < a) {
      cursor += len;
      return;
    }
    const t1 = clamp((a - cursor) / len, 0, 1);
    const t2 = clamp((b - cursor) / len, 0, 1);
    const steps = Math.max(3, Math.ceil(Math.abs(t2 - t1) * 18));
    for (let i = 0; i <= steps; i += 1) {
      if (pts.length > 0 && i === 0) continue;
      pts.push(splineAt(sp, t1 + (t2 - t1) * (i / steps)));
    }
    cursor += len;
  });
  return pts;
}

function paintDevice(
  octx: CanvasRenderingContext2D,
  object: ProceduralObject,
  input: AngioRenderInput,
  splines: Map<string, Spline>,
  cfg: PresetConfig,
): void {
  const segment = input.segments.find((s) => s.id === object.segmentId);
  const sp = segment && splines.get(segment.id);
  if (!segment || !sp) return;

  const lenFrac = clamp(object.lengthMm / Math.max(segment.lengthMm, 1), 0.04, 0.95);
  const isWire = object.objectType === 'guidewire';
  const t1 = isWire ? 0 : clamp(object.t - lenFrac / 2, 0, 1);
  const t2 = isWire ? object.t : clamp(object.t + lenFrac / 2, 0, 1);
  const dev = cfg.ink;
  const dA = TUNING.deviceOpacity;

  const localPath = (steps: number): Pt[] => {
    const out: Pt[] = [];
    for (let i = 0; i <= steps; i += 1) out.push(splineAt(sp, t1 + (t2 - t1) * (i / steps)));
    return out;
  };
  const stroke = (pts: Pt[], width: number, alpha: number) => {
    if (pts.length < 2) return;
    octx.strokeStyle = `rgba(${dev},${alpha})`;
    octx.lineWidth = width;
    octx.beginPath();
    pts.forEach((p, i) => (i === 0 ? octx.moveTo(p.x, p.y) : octx.lineTo(p.x, p.y)));
    octx.stroke();
  };
  const band = (t: number, size: number) => {
    const c = splineAt(sp, clamp(t, 0, 1));
    const nrm = splineNormal(sp, clamp(t, 0, 1));
    octx.strokeStyle = `rgba(${dev},${Math.min(1, dA + 0.05)})`;
    octx.lineWidth = 1.9;
    octx.beginPath();
    octx.moveTo(c.x + nrm.x * size, c.y + nrm.y * size);
    octx.lineTo(c.x - nrm.x * size, c.y - nrm.y * size);
    octx.stroke();
  };

  const tipProgress = procedureProgressMm(object, input);
  const pathStart =
    object.objectType === 'guidewire' ? 0 : Math.max(0, tipProgress - Math.max(object.lengthMm, segment.lengthMm * 0.15));
  const devicePath = sampleProcedurePath(object, input, splines, pathStart, tipProgress);

  octx.save();
  octx.lineCap = 'round';
  octx.lineJoin = 'round';

  if (object.objectType === 'guidewire') {
    const pts = devicePath.length >= 2 ? devicePath : localPath(28);
    stroke(pts, 1.05, dA);
    octx.globalAlpha = 0.38;
    stroke(pts, 0.55, dA);
    octx.globalAlpha = 1;
    stroke(pts.slice(-3), 1.65, dA);
  } else if (object.objectType === 'catheter') {
    const pts = devicePath.length >= 2 ? devicePath : localPath(24);
    stroke(pts, 3, dA * 0.76);
    stroke(pts, 1.25, dA * 0.48);
    band(object.t, 3.8);
  } else if (object.objectType === 'sheath') {
    const pts = devicePath.length >= 2 ? devicePath : localPath(20);
    stroke(pts, 4.8, dA * 0.6);
    stroke(pts.slice(Math.max(0, pts.length - 5)), 2.7, dA * 0.68);
    band(object.t, 4.8);
  } else if (object.objectType === 'balloon') {
    const inflated = object.state === 'deployed';
    stroke(localPath(20), 1.15, dA * 0.68);
    if (inflated) {
      const m = splineAt(sp, object.t);
      const tan = splineTangent(sp, object.t);
      octx.save();
      octx.translate(m.x, m.y);
      octx.rotate(Math.atan2(tan.y, tan.x));
      octx.fillStyle = `rgba(${dev},0.16)`;
      octx.strokeStyle = `rgba(${dev},0.54)`;
      octx.lineWidth = 1.2;
      octx.beginPath();
      octx.ellipse(0, 0, 22, 6.6, 0, 0, Math.PI * 2);
      octx.fill();
      octx.stroke();
      octx.restore();
    }
    band(object.t - lenFrac * 0.4, 4.2);
    band(object.t + lenFrac * 0.4, 4.2);
  } else if (object.objectType === 'stent' || object.objectType === 'stentGraft') {
    const isGraft = object.objectType === 'stentGraft';
    if (isGraft) {
      octx.save();
      octx.globalAlpha = 0.18;
      ribbonPath(octx, segment, sp, t1, t2, 0.92);
      octx.fillStyle = `rgba(${dev},1)`;
      octx.fill();
      octx.restore();
    }
    const cells = isGraft ? 16 : 20;
    octx.strokeStyle = `rgba(${dev},${dA * 0.7})`;
    octx.lineWidth = isGraft ? 0.9 : 0.72;
    for (const dir of [1, -1]) {
      octx.beginPath();
      for (let i = 0; i <= cells; i += 1) {
        const t = t1 + (t2 - t1) * (i / cells);
        const c = splineAt(sp, t);
        const nrm = splineNormal(sp, t);
        const amp = clamp(baseHalf(segment, t) * 0.78, 3, 16) * (i % 2 === 0 ? dir : -dir);
        const x = c.x + nrm.x * amp;
        const y = c.y + nrm.y * amp;
        if (i === 0) octx.moveTo(x, y);
        else octx.lineTo(x, y);
      }
      octx.stroke();
    }
    band(t1, clamp(baseHalf(segment, t1) * 0.85, 4, 15));
    band(t2, clamp(baseHalf(segment, t2) * 0.85, 4, 15));
    if (isGraft) band((t1 + t2) / 2, clamp(baseHalf(segment, (t1 + t2) / 2) * 0.5, 3, 9));
  }
  octx.restore();
}

// --- acquisition + background ---------------------------------------------

type AnatomyContext = 'aortoiliac' | 'thoracic' | 'carotid' | 'lower' | 'dialysis' | 'mesenteric' | 'generic';

function inferAnatomyContext(input: AngioRenderInput): AnatomyContext {
  const text = input.segments
    .map((segment) => `${segment.vesselType} ${segment.label} ${segment.notes ?? ''}`)
    .join(' ')
    .toLowerCase();
  if (text.includes('carotid') || text.includes('vertebral') || text.includes('cerebral')) return 'carotid';
  if (
    text.includes('dialysis') ||
    text.includes('access') ||
    text.includes('fistula') ||
    text.includes('graft') ||
    text.includes('brachial') ||
    text.includes('radial') ||
    text.includes('ulnar') ||
    text.includes('cephalic') ||
    text.includes('basilic')
  ) return 'dialysis';
  if (text.includes('thoracic') || text.includes('arch')) return 'thoracic';
  if (text.includes('renal') || text.includes('sma') || text.includes('celiac') || text.includes('mesenteric')) return 'mesenteric';
  if (text.includes('femoral') || text.includes('profunda') || text.includes('popliteal') || text.includes('tibial')) return 'lower';
  if (text.includes('aorta') || text.includes('iliac')) return 'aortoiliac';
  return 'generic';
}

function transformedVesselBounds(input: AngioRenderInput, view: AngioViewTransform): { cx: number; cy: number; minY: number; maxY: number } {
  if (input.segments.length === 0) return { cx: CX, cy: CY, minY: 90, maxY: ANGIO_WORKSPACE_HEIGHT - 70 };
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  input.segments.forEach((segment) => {
    for (const raw of [segment.start, segment.end]) {
      const p = projectAngioPoint(raw, input.projection, view);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
  });
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, minY, maxY };
}

function drawBoneColumn(ctx: CanvasRenderingContext2D, x: number, y1: number, y2: number, strength: number): void {
  const h = Math.max(60, y2 - y1);
  ctx.fillStyle = `rgba(164,170,176,${strength})`;
  ctx.fillRect(x - 16, y1, 32, h);
  ctx.fillStyle = `rgba(210,215,218,${strength * 0.46})`;
  for (let y = y1 + 14; y < y2 - 8; y += 32) ctx.fillRect(x - 28, y, 56, 4);
}

function drawAnatomicalContext(
  ctx: CanvasRenderingContext2D,
  input: AngioRenderInput,
  view: AngioViewTransform,
  preset: AngioPreset,
  strength: number,
): void {
  if (strength <= 0.001) return;
  const territory = inferAnatomyContext(input);
  const bounds = transformedVesselBounds(input, view);
  const cx = clamp(bounds.cx, 180, ANGIO_WORKSPACE_WIDTH - 180);
  const cy = clamp(bounds.cy, 145, ANGIO_WORKSPACE_HEIGHT - 100);
  const top = clamp(bounds.minY - 54, 28, ANGIO_WORKSPACE_HEIGHT - 160);
  const bottom = clamp(bounds.maxY + 54, 160, ANGIO_WORKSPACE_HEIGHT - 36);
  const s = preset === 'roadmap' ? strength * 0.46 : strength;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  withFilter(ctx, 'blur(9px)', () => {
    if (territory === 'carotid') {
      drawBoneColumn(ctx, cx, top + 72, bottom, s * 0.7);
      ctx.fillStyle = `rgba(160,166,176,${s * 0.8})`;
      ctx.beginPath();
      ctx.ellipse(cx, top + 44, 138, 48, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(120,126,136,${s * 0.5})`;
      ctx.fillRect(cx - 72, top + 78, 144, Math.max(90, bottom - top - 94));
    } else if (territory === 'lower') {
      const legX = cx + 42;
      ctx.fillStyle = `rgba(172,176,178,${s})`;
      ctx.beginPath();
      ctx.ellipse(legX, cy - 70, 34, 180, 0.05, 0, Math.PI * 2);
      ctx.ellipse(legX - 10, cy + 178, 24, 150, -0.05, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(106,112,120,${s * 0.42})`;
      ctx.beginPath();
      ctx.ellipse(legX + 58, cy + 178, 18, 132, 0.05, 0, Math.PI * 2);
      ctx.fill();
    } else if (territory === 'dialysis') {
      ctx.fillStyle = `rgba(164,170,174,${s * 0.9})`;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 260, 44, -0.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(106,112,120,${s * 0.48})`;
      ctx.beginPath();
      ctx.ellipse(cx - 190, cy - 6, 74, 54, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (territory === 'thoracic') {
      drawBoneColumn(ctx, cx, top, bottom, s * 0.68);
      ctx.fillStyle = `rgba(132,138,146,${s * 0.62})`;
      ctx.beginPath();
      ctx.ellipse(cx - 145, cy, 150, 225, -0.12, 0, Math.PI * 2);
      ctx.ellipse(cx + 145, cy, 150, 225, 0.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(180,186,190,${s * 0.36})`;
      ctx.beginPath();
      ctx.ellipse(cx, cy - 26, 86, 170, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (territory === 'mesenteric') {
      drawBoneColumn(ctx, cx, top, bottom, s * 0.74);
      ctx.fillStyle = `rgba(126,132,138,${s * 0.62})`;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 315, 235, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(184,176,170,${s * 0.44})`;
      ctx.beginPath();
      ctx.ellipse(cx - 128, cy + 20, 70, 110, -0.2, 0, Math.PI * 2);
      ctx.ellipse(cx + 128, cy + 20, 70, 110, 0.2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      drawBoneColumn(ctx, cx, top, bottom, s * 0.78);
      ctx.fillStyle = `rgba(150,156,166,${s * 0.78})`;
      ctx.beginPath();
      ctx.ellipse(cx - 155, bottom - 72, 135, 94, 0.3, 0, Math.PI * 2);
      ctx.ellipse(cx + 155, bottom - 72, 135, 94, -0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(120,126,134,${s * 0.44})`;
      ctx.beginPath();
      ctx.ellipse(cx, cy - 30, 318, 235, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  ctx.restore();
}

export function renderAngiogram(canvas: HTMLCanvasElement, input: AngioRenderInput): boolean {
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;

    const rect = canvas.getBoundingClientRect();
    const cssW = rect.width || canvas.clientWidth || ANGIO_WORKSPACE_WIDTH;
    const cssH = rect.height || canvas.clientHeight || ANGIO_WORKSPACE_HEIGHT;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pxW = Math.max(1, Math.round(cssW * dpr));
    const pxH = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== pxW || canvas.height !== pxH) {
      canvas.width = pxW;
      canvas.height = pxH;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pxW, pxH);
    ctx.scale(pxW / ANGIO_WORKSPACE_WIDTH, pxH / ANGIO_WORKSPACE_HEIGHT);

    const cfg = presetConfig(input.preset);
    const view = computeAngioViewTransform(input);
    const splines = new Map<string, Spline>();
    input.segments.forEach((s) => splines.set(s.id, makeSpline(s, input.projection)));
    const branches = getSyntheticBranches(input, splines);

    // 1. Background field + exposure non-uniformity.
    const grad = ctx.createRadialGradient(CX, CY * 0.86, 60, CX, CY, ANGIO_WORKSPACE_WIDTH * 0.74);
    grad.addColorStop(0, cfg.bg[0]);
    grad.addColorStop(0.5, cfg.bg[1]);
    grad.addColorStop(1, cfg.bg[2]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, ANGIO_WORKSPACE_WIDTH, ANGIO_WORKSPACE_HEIGHT);

    const expo = ctx.createLinearGradient(0, 0, ANGIO_WORKSPACE_WIDTH, ANGIO_WORKSPACE_HEIGHT);
    expo.addColorStop(0, 'rgba(255,255,255,0.05)');
    expo.addColorStop(0.5, 'rgba(0,0,0,0)');
    expo.addColorStop(1, 'rgba(0,0,0,0.07)');
    ctx.fillStyle = expo;
    ctx.fillRect(0, 0, ANGIO_WORKSPACE_WIDTH, ANGIO_WORKSPACE_HEIGHT);

    if (cfg.silhouettes) {
      drawAnatomicalContext(ctx, input, view, input.preset, TUNING.backgroundContextStrength);
    }

    // 2. Paint the whole vascular + device scene into one density buffer.
    const scene = sceneCanvas();
    const octx = scene && scene.getContext('2d');
    if (scene && octx) {
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.clearRect(0, 0, ANGIO_WORKSPACE_WIDTH, ANGIO_WORKSPACE_HEIGHT);
      octx.save();
      applyViewContext(octx, view);
      paintSyntheticBranches(octx, branches, input.segments, cfg, input.preset);
      paintJunctions(octx, input, splines, cfg);
      input.segments.forEach((s) => {
        const sp = splines.get(s.id);
        if (sp) paintSegment(octx, s, sp, cfg, input.preset);
      });
      input.proceduralObjects.forEach((object) => {
        paintDevice(octx, object, input, splines, cfg);
      });
      input.devicePlacements.forEach((placement) => {
        const seg = input.segments.find((s) => s.id === placement.segmentId);
        const sp = seg && splines.get(seg.id);
        if (!seg || !sp) return;
        const p = splineAt(sp, clamp(placement.t, 0, 1));
        octx.fillStyle = `rgba(${cfg.ink},${TUNING.deviceOpacity * 0.7})`;
        octx.beginPath();
        octx.arc(p.x, p.y, 3.6, 0, Math.PI * 2);
        octx.fill();
      });
      octx.restore();

      // Roadmap "prior contrast" ghost: a faint, offset, tinted copy.
      if (cfg.roadmapGhost && cfg.tint) {
        ctx.save();
        ctx.globalAlpha = TUNING.roadmapTintStrength * 0.5;
        withFilter(ctx, 'blur(2.4px)', () => ctx.drawImage(scene, -2, 1));
        ctx.restore();
      }

      // 3. Single shared acquisition pass: motion softness for the whole
      //    captured image so devices/vessels are one exposure, not stacked.
      ctx.save();
      if (cfg.tint) ctx.globalAlpha = 0.9;
      const acquisitionBlur =
        input.preset === 'dsa' ? TUNING.dsaSharpness : input.preset === 'roadmap' ? 1.15 : TUNING.fluoroSoftness;
      withFilter(ctx, `blur(${acquisitionBlur}px)`, () => ctx.drawImage(scene, 0, 0));
      ctx.restore();
    }

    // 4. Selection highlight (follows the curved centerline).
    if (input.selectedId) {
      const seg = input.segments.find((s) => s.id === input.selectedId);
      const obj = input.proceduralObjects.find((o) => o.id === input.selectedId);
      ctx.save();
      applyViewContext(ctx, view);
      ctx.strokeStyle = 'rgba(120,200,255,0.7)';
      ctx.lineWidth = 1.8 / view.scale;
      ctx.setLineDash([5, 4]);
      const sseg = seg && splines.get(seg.id);
      if (seg && sseg) {
        ctx.beginPath();
        for (let i = 0; i <= 24; i += 1) {
          const p = splineAt(sseg, i / 24);
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      } else if (obj) {
        const oseg = input.segments.find((s) => s.id === obj.segmentId);
        const osp = oseg && splines.get(oseg.id);
        if (osp) {
          const progress = procedureProgressMm(obj, input);
          const start = obj.objectType === 'guidewire' ? 0 : Math.max(0, progress - Math.max(obj.lengthMm, 1));
          const pts = sampleProcedurePath(obj, input, splines, start, progress);
          if (pts.length >= 2 && (obj.objectType === 'guidewire' || obj.objectType === 'catheter' || obj.objectType === 'sheath')) {
            ctx.beginPath();
            pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
            ctx.stroke();
          } else {
            const p = splineAt(osp, clamp(obj.t, 0, 1));
            ctx.beginPath();
            ctx.arc(p.x, p.y, 14 / view.scale, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      }
      ctx.restore();
    }

    // 5. Scatter haze (slight global lift, reduces pure black/white).
    ctx.fillStyle =
      input.preset === 'dsa'
        ? `rgba(70,72,76,${cfg.haze})`
        : `rgba(120,128,140,${cfg.haze})`;
    ctx.fillRect(0, 0, ANGIO_WORKSPACE_WIDTH, ANGIO_WORKSPACE_HEIGHT);

    // 6. Detector banding.
    const band = bandingCanvas();
    if (band && cfg.banding > 0) {
      const pat = ctx.createPattern(band, 'repeat');
      if (pat) {
        ctx.save();
        ctx.globalAlpha = cfg.banding;
        ctx.globalCompositeOperation = input.preset === 'dsa' ? 'multiply' : 'lighter';
        ctx.fillStyle = pat;
        ctx.fillRect(0, 0, ANGIO_WORKSPACE_WIDTH, ANGIO_WORKSPACE_HEIGHT);
        ctx.restore();
      }
    }

    // 7. Detector grain.
    const nz = grainCanvas(cfg.noise * TUNING.backgroundNoise);
    if (nz) {
      const pat = ctx.createPattern(nz, 'repeat');
      if (pat) {
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = pat;
        ctx.fillRect(0, 0, ANGIO_WORKSPACE_WIDTH, ANGIO_WORKSPACE_HEIGHT);
        ctx.restore();
      }
    }

    // 8. Vignette.
    const vig = ctx.createRadialGradient(
      CX,
      CY,
      ANGIO_WORKSPACE_HEIGHT * 0.34,
      CX,
      CY,
      ANGIO_WORKSPACE_WIDTH * 0.66,
    );
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, cfg.vignette);
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, ANGIO_WORKSPACE_WIDTH, ANGIO_WORKSPACE_HEIGHT);

    return true;
  } catch {
    return false;
  }
}
