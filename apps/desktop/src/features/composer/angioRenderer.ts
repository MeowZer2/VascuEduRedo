// Advanced 2D synthetic angiogram renderer (Canvas 2D), v0.41.
//
// Pure module: the React layer owns interaction; this only draws pixels and
// is wrapped so any failure makes the caller fall back to the legacy SVG.
//
// v0.41 — topology-aware continuous vessel rendering. Instead of painting each
// authored segment as an independent ribbon, this builds a vascular graph
// (parent/child junctions), derives continuous centerlines with tangent
// continuity across joins, merges geometry at bifurcations with real carina
// fork polygons, and drives a single continuous contrast column / density
// falloff across the connected tree. Everything is composited through one
// shared acquisition pass so it reads as one captured image.
//
// Public API consumed by AdvancedAngiogramCanvas.tsx (kept stable):
//   ANGIO_WORKSPACE_WIDTH / ANGIO_WORKSPACE_HEIGHT
//   AngioProjection / AngioPreset / AngioViewTransform / AngioRenderInput
//   computeAngioViewTransform(...) / projectAngioPoint(...) / renderAngiogram(...)

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

export interface AngioViewTransform {
  scale: number;
  tx: number;
  ty: number;
}

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

const TUNING = {
  vesselDensity: 0.94,
  edgeSoftness: 2,
  internalNoise: 0.2,
  contrastFalloff: 0.62,
  centralColumn: 0.42,
  streakStrength: 0.16,
  motionSoftness: 0.55,
  deviceOpacity: 0.95,
  roadmapTintStrength: 0.55,
  fluoroSoftTissueStrength: 0.06,
};

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

const CX = ANGIO_WORKSPACE_WIDTH / 2;
const CY = ANGIO_WORKSPACE_HEIGHT / 2;

// --- raw projection + auto-fit view transform ------------------------------

function projectRaw(p: Pt, projection: AngioProjection): Pt {
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

/** Auto-frame the connected anatomy into a comfortable region of the canvas,
 *  leaving safe margins for the AP/DSA labels and projection/preset controls.
 *  Pure + deterministic so the renderer and the SVG overlay agree. */
export function computeAngioViewTransform(args: {
  segments: VesselSegment[];
  projection: AngioProjection;
}): AngioViewTransform {
  const { segments, projection } = args;
  if (segments.length === 0) return { scale: 1, tx: 0, ty: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of segments) {
    for (const p of [s.start, s.end]) {
      const r = projectRaw(p, projection);
      if (r.x < minX) minX = r.x;
      if (r.x > maxX) maxX = r.x;
      if (r.y < minY) minY = r.y;
      if (r.y > maxY) maxY = r.y;
    }
  }
  // Content box: clear of top-left labels and top-right controls.
  const boxX0 = 96;
  const boxX1 = 904;
  const boxY0 = 118;
  const boxY1 = 556;
  const bw = Math.max(maxX - minX, 1);
  const bh = Math.max(maxY - minY, 1);
  const scale = clamp(Math.min((boxX1 - boxX0) / bw, (boxY1 - boxY0) / bh), 0.35, 2.4);
  const tx = (boxX0 + boxX1) / 2 - ((minX + maxX) / 2) * scale;
  const ty = (boxY0 + boxY1) / 2 - ((minY + maxY) / 2) * scale;
  return { scale, tx, ty };
}

export function projectAngioPoint(
  point: Pt,
  projection: AngioProjection,
  view: AngioViewTransform,
): Pt {
  const r = projectRaw(point, projection);
  return { x: r.x * view.scale + view.tx, y: r.y * view.scale + view.ty };
}

/** Back-compat raw projector (no auto-fit). Kept exported so nothing
 *  external breaks even though the component now uses projectAngioPoint. */
export function projectPoint(point: Pt, projection: AngioProjection): Pt {
  return projectRaw(point, projection);
}

// --- deterministic noise ---------------------------------------------------

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
function gaussian(t: number, c: number, s: number): number {
  return Math.exp(-Math.pow((t - c) / s, 2));
}
function norm(v: Pt): Pt {
  const m = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / m, y: v.y / m };
}

// --- vascular graph (topology) --------------------------------------------

interface VNode {
  seg: VesselSegment;
  a: Pt; // view-space start (exactly == overlay)
  b: Pt; // view-space end
  c: Pt; // quadratic control point (curvature + takeoff continuity)
  startHalf: number;
  endHalf: number;
  seed: number;
  parentId: string | null;
  childIds: string[];
  startJunction: Pt | null;
  depthFrac0: number;
  depthFrac1: number;
}

function vesselBow(vesselType: string): number {
  const v = (vesselType || '').toLowerCase();
  if (v.includes('aorta')) return 0.05;
  if (v.includes('iliac')) return 0.16;
  if (v.includes('femoral') || v.includes('popliteal')) return 0.14;
  if (v.includes('carotid')) return 0.12;
  return 0.2;
}

function diameterToHalf(mm: number, scale: number): number {
  return (clamp(mm, 1.2, 30) * 1.55 + 3) * 0.5 * scale;
}

function buildGraph(
  input: AngioRenderInput,
  view: AngioViewTransform,
): { nodes: Map<string, VNode>; order: string[]; rootPaths: string[][] } {
  const { segments, bifurcations, projection } = input;
  const nodes = new Map<string, VNode>();
  const proj = (p: Pt) => projectAngioPoint(p, projection, view);

  for (const seg of segments) {
    const a = proj(seg.start);
    const b = proj(seg.end);
    nodes.set(seg.id, {
      seg,
      a,
      b,
      c: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      startHalf: diameterToHalf(seg.proximalDiameterMm, view.scale),
      endHalf: diameterToHalf(seg.distalDiameterMm, view.scale),
      seed: seedFromId(seg.id),
      parentId: null,
      childIds: [],
      startJunction: null,
      depthFrac0: 0,
      depthFrac1: 0,
    });
  }

  for (const node of bifurcations) {
    const jp = proj(node.position);
    const parent = node.parentSegmentId ? nodes.get(node.parentSegmentId) : undefined;
    for (const childId of node.childSegmentIds) {
      const child = nodes.get(childId);
      if (!child) continue;
      child.startJunction = jp;
      if (parent) {
        child.parentId = parent.seg.id;
        if (!parent.childIds.includes(childId)) parent.childIds.push(childId);
      }
    }
  }

  // Geometric fallback for un-authored joins (child start near a parent end).
  const TOL = 26 * view.scale;
  for (const child of nodes.values()) {
    if (child.parentId) continue;
    let best: { id: string; d: number } | null = null;
    for (const parent of nodes.values()) {
      if (parent.seg.id === child.seg.id) continue;
      const d = Math.hypot(parent.b.x - child.a.x, parent.b.y - child.a.y);
      if (d < TOL && (!best || d < best.d)) best = { id: parent.seg.id, d };
    }
    if (best) {
      child.parentId = best.id;
      const p = nodes.get(best.id);
      if (p && !p.childIds.includes(child.seg.id)) p.childIds.push(child.seg.id);
      if (!child.startJunction) child.startJunction = { ...child.a };
    }
  }

  // Anatomy-aware curvature + tangent continuity at branch takeoffs.
  for (const n of nodes.values()) {
    const a = n.a;
    const b = n.b;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const nrm = { x: -dir.y, y: dir.x };
    const vt = (n.seg.vesselType || '').toLowerCase();
    const bowMag = len * vesselBow(n.seg.vesselType) * (0.6 + hash01(n.seed * 7) * 0.5);
    let bowSign = hash01(n.seed) < 0.5 ? -1 : 1;
    if (vt.includes('iliac')) bowSign = a.x < (n.startJunction?.x ?? CX) ? -1 : 1;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    let cx = mid.x + nrm.x * bowMag * bowSign;
    let cy = mid.y + nrm.y * bowMag * bowSign;

    if (n.parentId) {
      const p = nodes.get(n.parentId);
      if (p) {
        const pdir = norm({ x: p.b.x - p.c.x, y: p.b.y - p.c.y });
        const tk = norm({ x: pdir.x * 0.55 + dir.x * 0.45, y: pdir.y * 0.55 + dir.y * 0.45 });
        cx = a.x + tk.x * len * 0.5;
        cy = a.y + tk.y * len * 0.5;
      }
    }
    n.c = { x: cx, y: cy };
  }

  // Width continuity across junctions.
  for (const n of nodes.values()) {
    if (n.parentId) {
      const p = nodes.get(n.parentId);
      if (p) n.startHalf = Math.min(n.startHalf, p.endHalf * 0.72);
    }
  }
  for (const n of nodes.values()) {
    if (n.childIds.length > 0) {
      let maxChild = 0;
      for (const cid of n.childIds) {
        const c = nodes.get(cid);
        if (c) maxChild = Math.max(maxChild, c.startHalf);
      }
      n.endHalf = Math.max(n.endHalf, maxChild * 1.18);
    }
  }

  // Continuous distance-from-root fraction → smooth contrast falloff.
  const roots = [...nodes.values()].filter((n) => !n.parentId);
  let maxCum = 1;
  const setCum = (n: VNode, startCum: number, guard: number) => {
    if (guard > 64) return;
    const segLen = Math.hypot(n.b.x - n.a.x, n.b.y - n.a.y);
    n.depthFrac0 = startCum;
    n.depthFrac1 = startCum + segLen;
    maxCum = Math.max(maxCum, n.depthFrac1);
    for (const cid of n.childIds) {
      const c = nodes.get(cid);
      if (c) setCum(c, n.depthFrac1, guard + 1);
    }
  };
  roots.forEach((r) => setCum(r, 0, 0));
  for (const n of nodes.values()) {
    n.depthFrac0 /= maxCum;
    n.depthFrac1 /= maxCum;
  }

  const order = [...nodes.values()]
    .sort((x, y) => x.depthFrac0 - y.depthFrac0)
    .map((n) => n.seg.id);

  const rootPaths: string[][] = [];
  const walk = (n: VNode, acc: string[], guard: number) => {
    if (guard > 64) return;
    const path = [...acc, n.seg.id];
    if (n.childIds.length === 0) {
      rootPaths.push(path);
      return;
    }
    for (const cid of n.childIds) {
      const c = nodes.get(cid);
      if (c) walk(c, path, guard + 1);
    }
  };
  roots.forEach((r) => walk(r, [], 0));

  return { nodes, order, rootPaths };
}

type Graph = ReturnType<typeof buildGraph>;

// --- geometry sampling -----------------------------------------------------

function bez(n: VNode, t: number): Pt {
  const u = 1 - t;
  return {
    x: u * u * n.a.x + 2 * u * t * n.c.x + t * t * n.b.x,
    y: u * u * n.a.y + 2 * u * t * n.c.y + t * t * n.b.y,
  };
}
function bezTangent(n: VNode, t: number): Pt {
  const u = 1 - t;
  return norm({
    x: 2 * u * (n.c.x - n.a.x) + 2 * t * (n.b.x - n.c.x),
    y: 2 * u * (n.c.y - n.a.y) + 2 * t * (n.b.y - n.c.y),
  });
}
function centerAt(n: VNode, t: number): Pt {
  const p = bez(n, t);
  const tg = bezTangent(n, t);
  const w = valueNoise(n.seed + 101, t * 2.2) * Math.hypot(n.b.x - n.a.x, n.b.y - n.a.y) * 0.012;
  return { x: p.x - tg.y * w, y: p.y + tg.x * w };
}
function normalAt(n: VNode, t: number): Pt {
  const tg = bezTangent(n, t);
  return { x: -tg.y, y: tg.x };
}

function pathologyHalf(n: VNode, t: number, side: 1 | -1): number {
  const seg = n.seg;
  let half = n.startHalf + (n.endHalf - n.startHalf) * t;
  const lesion = gaussian(t, 0.5, 0.13);
  if (seg.pathologyType === 'stenosis') {
    const sev = clamp(seg.severityPercent ?? 65, 10, 95) / 100;
    half *= 1 - sev * 0.82 * lesion;
    if (sev > 0.6) half *= 1 + gaussian(t, 0.68, 0.07) * 0.1 * (valueNoise(n.seed + 41, t * 9) + 0.5);
  } else if (seg.pathologyType === 'aneurysm') {
    const meta = seg.metadata as Record<string, unknown> | undefined;
    const text = `${typeof meta?.aneurysmShape === 'string' ? meta.aneurysmShape : ''} ${seg.notes ?? ''} ${seg.label ?? ''}`.toLowerCase();
    const bulge = (n.startHalf + n.endHalf) * 1.05 * gaussian(t, 0.5, 0.22);
    half += text.includes('saccular')
      ? side === 1
        ? bulge * 1.05
        : bulge * 0.12
      : bulge * (side === 1 ? 0.58 : 0.46);
  } else if (seg.pathologyType === 'thrombus') {
    half *= 1 - 0.14 * lesion;
  }
  const irr =
    valueNoise(n.seed + (side === 1 ? 7 : 23), t * 5) * 0.12 +
    valueNoise(n.seed + (side === 1 ? 53 : 71), t * 1.6) * 0.07;
  return Math.max(1.2, half * (1 + irr));
}

function ribbonPath(octx: CanvasRenderingContext2D, n: VNode, t0: number, t1: number, scale: number): void {
  const samples = 28;
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i < samples; i += 1) {
    const t = t0 + (t1 - t0) * (i / (samples - 1));
    const c = centerAt(n, t);
    const nr = normalAt(n, t);
    const hl = pathologyHalf(n, t, 1) * scale;
    const hr = pathologyHalf(n, t, -1) * scale;
    left.push({ x: c.x + nr.x * hl, y: c.y + nr.y * hl });
    right.unshift({ x: c.x - nr.x * hr, y: c.y - nr.y * hr });
  }
  const pts = [...left, ...right];
  octx.beginPath();
  pts.forEach((p, i) => (i === 0 ? octx.moveTo(p.x, p.y) : octx.lineTo(p.x, p.y)));
  octx.closePath();
}

// --- preset config ---------------------------------------------------------

interface PresetConfig {
  bg: [string, string, string];
  ink: string;
  density: number;
  haze: number;
  noise: number;
  banding: number;
  softness: number;
  silhouettes: boolean;
  roadmapGhost: boolean;
  vignette: string;
}

function presetConfig(preset: AngioPreset): PresetConfig {
  switch (preset) {
    case 'dsa':
      return {
        bg: ['#edeff0', '#dde0e1', '#c8ccce'],
        ink: '20,22,26',
        density: 0.95,
        haze: 0.035,
        noise: 0.028,
        banding: 0.012,
        softness: 0.35,
        silhouettes: false,
        roadmapGhost: false,
        vignette: 'rgba(38,42,46,0.38)',
      };
    case 'roadmap':
      return {
        bg: ['#0e1620', '#091018', '#04080d'],
        ink: '150,170,178',
        density: 0.62,
        haze: 0.045,
        noise: 0.085,
        banding: 0.025,
        softness: 0.7,
        silhouettes: true,
        roadmapGhost: true,
        vignette: 'rgba(0,0,0,0.56)',
      };
    case 'fluoro':
    default:
      return {
        bg: ['#12171d', '#0b0f14', '#050709'],
        ink: '208,216,222',
        density: 0.54,
        haze: 0.055,
        noise: 0.15,
        banding: 0.03,
        softness: 0.85,
        silhouettes: true,
        roadmapGhost: false,
        vignette: 'rgba(0,0,0,0.58)',
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

// --- cached layers ---------------------------------------------------------

const cache: {
  scene: HTMLCanvasElement | null;
  grain: { c: HTMLCanvasElement; key: string } | null;
  internal: HTMLCanvasElement | null;
  banding: HTMLCanvasElement | null;
} = { scene: null, grain: null, internal: null, banding: null };

function sceneCanvas(): HTMLCanvasElement {
  if (!cache.scene) {
    const c = document.createElement('canvas');
    c.width = ANGIO_WORKSPACE_WIDTH;
    c.height = ANGIO_WORKSPACE_HEIGHT;
    cache.scene = c;
  }
  return cache.scene;
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
function internalNoiseCanvas(): HTMLCanvasElement | null {
  if (cache.internal) return cache.internal;
  const cells = 26;
  const s = document.createElement('canvas');
  s.width = cells;
  s.height = cells;
  const sg = s.getContext('2d');
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
  withFilter(g, 'blur(7px)', () => g.drawImage(s, 0, 0, 256, 256));
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

// --- scene painting --------------------------------------------------------

function densityAt(depthFrac: number): number {
  return clamp(1 - TUNING.contrastFalloff * Math.pow(depthFrac, 1.25), 0.28, 1);
}

function paintTreeMask(octx: CanvasRenderingContext2D, graph: Graph, cfg: PresetConfig): void {
  const ink = cfg.ink;
  const baseA = cfg.density * TUNING.vesselDensity;

  // 1. One soft outer margin for the whole tree (edge falloff, no hard edge).
  withFilter(octx, `blur(${TUNING.edgeSoftness}px)`, () => {
    octx.fillStyle = `rgba(${ink},${baseA * 0.3})`;
    for (const id of graph.order) {
      const n = graph.nodes.get(id);
      if (!n) continue;
      ribbonPath(octx, n, 0, 1, 1.08);
      octx.fill();
    }
  });

  // 2. Carina fork polygons merge parent trunk into child branches so the
  //    bifurcation is one continuous lumen, not stacked ribbons / a diamond.
  for (const n of graph.nodes.values()) {
    if (n.childIds.length === 0) continue;
    const children = n.childIds.map((id) => graph.nodes.get(id)).filter((c): c is VNode => !!c);
    if (children.length === 0) continue;
    const pe = centerAt(n, 0.985);
    const pn = normalAt(n, 0.985);
    const ph = pathologyHalf(n, 0.985, 1);
    const ptan = bezTangent(n, 1);
    const a = densityAt(n.depthFrac1) * baseA;
    octx.fillStyle = `rgba(${ink},${a})`;
    const ordered = children
      .map((c) => {
        const cs = centerAt(c, 0.06);
        return { c, side: (cs.x - pe.x) * pn.x + (cs.y - pe.y) * pn.y };
      })
      .sort((u, v) => v.side - u.side);
    const pL = { x: pe.x + pn.x * ph, y: pe.y + pn.y * ph };
    const pR = { x: pe.x - pn.x * ph, y: pe.y - pn.y * ph };
    const carina = { x: pe.x + ptan.x * ph * 1.15, y: pe.y + ptan.y * ph * 1.15 };
    octx.beginPath();
    octx.moveTo(pL.x, pL.y);
    ordered.forEach(({ c }, idx) => {
      const cn = normalAt(c, 0.05);
      const ch = pathologyHalf(c, 0.05, 1);
      const cc = centerAt(c, 0.18);
      const outer = idx === 0 ? 1 : -1;
      const wallOut = { x: cc.x + cn.x * ch * outer, y: cc.y + cn.y * ch * outer };
      const wallIn = { x: cc.x - cn.x * ch * outer, y: cc.y - cn.y * ch * outer };
      const ctrlA = {
        x: pe.x + ptan.x * ph * 0.6 + (idx === 0 ? pn.x : -pn.x) * ph,
        y: pe.y + ptan.y * ph * 0.6 + (idx === 0 ? pn.y : -pn.y) * ph,
      };
      octx.quadraticCurveTo(ctrlA.x, ctrlA.y, wallOut.x, wallOut.y);
      octx.lineTo(wallIn.x, wallIn.y);
      const last = idx === ordered.length - 1;
      octx.quadraticCurveTo(carina.x, carina.y, last ? pR.x : pe.x, last ? pR.y : pe.y);
    });
    octx.closePath();
    withFilter(octx, 'blur(1.1px)', () => octx.fill());
  }

  // 3. Continuous lumen body (width + density already matched at joins).
  const tile = internalNoiseCanvas();
  for (const id of graph.order) {
    const n = graph.nodes.get(id);
    if (!n) continue;
    const occluded = n.seg.pathologyType === 'occlusion';
    const lumenEnd = occluded ? 0.6 : 1;
    const aProx = densityAt(n.depthFrac0) * baseA;
    const aDist = densityAt(n.depthFrac1) * baseA;
    const grad = octx.createLinearGradient(n.a.x, n.a.y, n.b.x, n.b.y);
    grad.addColorStop(0, `rgba(${ink},${aProx * 0.82})`);
    grad.addColorStop(1, `rgba(${ink},${aDist * 0.7})`);
    ribbonPath(octx, n, 0, lumenEnd, 0.96);
    octx.fillStyle = grad;
    octx.fill();

    octx.save();
    ribbonPath(octx, n, 0, lumenEnd, 0.96);
    octx.clip();
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
    octx.restore();

    if (occluded) {
      const cut = centerAt(n, lumenEnd);
      const cn = normalAt(n, lumenEnd);
      const h = pathologyHalf(n, lumenEnd, 1) * 0.95;
      octx.strokeStyle = `rgba(${ink},${aDist})`;
      octx.lineWidth = 2;
      octx.beginPath();
      octx.moveTo(cut.x + cn.x * h, cut.y + cn.y * h);
      octx.lineTo(cut.x - cn.x * h, cut.y - cn.y * h);
      octx.stroke();
      withFilter(octx, 'blur(4px)', () => {
        ribbonPath(octx, n, 0.78, 1, 0.4);
        octx.fillStyle = `rgba(${ink},${aDist * 0.12})`;
        octx.fill();
      });
    }
    if (n.seg.pathologyType === 'aneurysm') {
      octx.save();
      ribbonPath(octx, n, 0.2, 0.8, 0.95);
      octx.clip();
      octx.globalCompositeOperation = 'destination-out';
      withFilter(octx, 'blur(5px)', () => {
        ribbonPath(octx, n, 0.22, 0.78, 0.9);
        octx.fillStyle = 'rgba(0,0,0,0.4)';
        octx.fill();
      });
      octx.restore();
      withFilter(octx, 'blur(1.6px)', () => {
        ribbonPath(octx, n, 0.16, 0.84, 0.3);
        octx.fillStyle = `rgba(${ink},${aDist * 0.8})`;
        octx.fill();
      });
    }
    if (n.seg.pathologyType === 'thrombus') {
      const m = centerAt(n, 0.52);
      const cn = normalAt(n, 0.52);
      octx.save();
      octx.globalCompositeOperation = 'destination-out';
      withFilter(octx, 'blur(4px)', () => {
        octx.beginPath();
        octx.ellipse(
          m.x,
          m.y,
          pathologyHalf(n, 0.52, 1) * 0.55,
          pathologyHalf(n, 0.52, 1) * 1.4,
          Math.atan2(cn.x, -cn.y),
          0,
          Math.PI * 2,
        );
        octx.fillStyle = 'rgba(0,0,0,0.5)';
        octx.fill();
      });
      octx.restore();
    }
    if (n.seg.pathologyType === 'dissection') {
      octx.save();
      octx.globalCompositeOperation = 'destination-out';
      octx.strokeStyle = 'rgba(0,0,0,0.5)';
      octx.lineWidth = 1.5;
      octx.beginPath();
      for (let i = 0; i <= 22; i += 1) {
        const t = 0.16 + (0.68 * i) / 22;
        const c = centerAt(n, t);
        const cn = normalAt(n, t);
        const off = pathologyHalf(n, t, 1) * 0.4 * Math.sin(t * Math.PI);
        const x = c.x + cn.x * off;
        const y = c.y + cn.y * off;
        if (i === 0) octx.moveTo(x, y);
        else octx.lineTo(x, y);
      }
      octx.stroke();
      octx.restore();
    }
  }

  // 4. Continuous central contrast column flowing root→leaf through joins.
  for (const path of graph.rootPaths) {
    const pts: Pt[] = [];
    path.forEach((id) => {
      const n = graph.nodes.get(id);
      if (!n) return;
      const end = n.seg.pathologyType === 'occlusion' ? 0.6 : 1;
      for (let i = 0; i <= 16; i += 1) pts.push(centerAt(n, (i / 16) * end));
    });
    if (pts.length < 2) continue;
    const head = graph.nodes.get(path[0]);
    withFilter(octx, 'blur(1.3px)', () => {
      octx.strokeStyle = `rgba(${ink},${baseA * TUNING.centralColumn})`;
      octx.lineJoin = 'round';
      octx.lineCap = 'round';
      octx.lineWidth = Math.max(2, (head ? head.startHalf : 6) * 0.7);
      octx.beginPath();
      pts.forEach((p, i) => (i === 0 ? octx.moveTo(p.x, p.y) : octx.lineTo(p.x, p.y)));
      octx.stroke();
    });
  }

  // 5. Tangential side branches that emerge from the host wall, taper, fade.
  for (const n of graph.nodes.values()) {
    const vt = (n.seg.vesselType || '').toLowerCase();
    if (!(vt.includes('aorta') || vt.includes('iliac') || vt.includes('femoral'))) continue;
    const count = 1 + Math.floor(hash01(n.seed + 9) * 2);
    for (let k = 0; k < count; k += 1) {
      const t = 0.35 + 0.45 * hash01(n.seed + 31 + k);
      const root = centerAt(n, t);
      const tg = bezTangent(n, t);
      const sideSign = hash01(n.seed + 51 + k) < 0.5 ? 1 : -1;
      const nrm = { x: -tg.y * sideSign, y: tg.x * sideSign };
      const dir = norm({ x: nrm.x + tg.x * 0.55, y: nrm.y + tg.y * 0.55 });
      const length = pathologyHalf(n, t, 1) * (5 + hash01(n.seed + 71 + k) * 4);
      withFilter(octx, 'blur(1.4px)', () => {
        octx.beginPath();
        for (let i = 0; i <= 10; i += 1) {
          const f = i / 10;
          const w = pathologyHalf(n, t, 1) * 0.4 * (1 - f) ** 1.4 + 0.6;
          const bx = root.x + dir.x * length * f;
          const by = root.y + dir.y * length * f;
          if (i === 0) octx.moveTo(bx + nrm.x * w, by + nrm.y * w);
          else octx.lineTo(bx + nrm.x * w, by + nrm.y * w);
        }
        for (let i = 10; i >= 0; i -= 1) {
          const f = i / 10;
          const w = pathologyHalf(n, t, 1) * 0.4 * (1 - f) ** 1.4 + 0.6;
          const bx = root.x + dir.x * length * f;
          const by = root.y + dir.y * length * f;
          octx.lineTo(bx - nrm.x * w, by - nrm.y * w);
        }
        octx.closePath();
        octx.fillStyle = `rgba(${ink},${baseA * 0.46})`;
        octx.fill();
      });
    }
  }
}

// --- devices conform to the continuous connected centerline ----------------

function devicePath(graph: Graph, object: ProceduralObject, steps: number): { pts: Pt[]; host: VNode } | null {
  const host = graph.nodes.get(object.segmentId);
  if (!host) return null;
  const ids =
    object.pathSegmentIds && object.pathSegmentIds.length > 0 ? object.pathSegmentIds : [object.segmentId];
  const idx = Math.max(0, ids.indexOf(object.segmentId));
  const chain = ids.slice(0, idx + 1).filter((id) => graph.nodes.has(id));
  const lenFrac = clamp(object.lengthMm / Math.max(host.seg.lengthMm, 1), 0.04, 0.95);
  const isWire = object.objectType === 'guidewire';
  const endT = isWire ? object.t : clamp(object.t + lenFrac / 2, 0, 1);
  const startT = isWire ? 0 : clamp(object.t - lenFrac / 2, 0, 1);
  const pts: Pt[] = [];
  const traversal =
    isWire || object.objectType === 'catheter' || object.objectType === 'sheath';
  if (chain.length > 1 && traversal) {
    chain.forEach((id, ci) => {
      const node = graph.nodes.get(id);
      if (!node) return;
      const a = ci === 0 ? (isWire ? 0 : startT) : 0;
      const b = id === object.segmentId ? endT : 1;
      for (let i = 0; i <= steps; i += 1) pts.push(centerAt(node, a + (b - a) * (i / steps)));
    });
  } else {
    for (let i = 0; i <= steps; i += 1) pts.push(centerAt(host, startT + (endT - startT) * (i / steps)));
  }
  return { pts, host };
}

function paintDevices(
  octx: CanvasRenderingContext2D,
  graph: Graph,
  input: AngioRenderInput,
  cfg: PresetConfig,
): void {
  const dev = cfg.ink;
  const dA = TUNING.deviceOpacity;
  octx.save();
  octx.lineCap = 'round';
  octx.lineJoin = 'round';

  for (const object of input.proceduralObjects) {
    const dp = devicePath(graph, object, 28);
    if (!dp || dp.pts.length < 2) continue;
    const { pts, host } = dp;
    const half = clamp((host.startHalf + host.endHalf) * 0.42, 4, 24);
    const strokePts = (w: number, alpha: number) => {
      octx.strokeStyle = `rgba(${dev},${alpha})`;
      octx.lineWidth = w;
      octx.beginPath();
      pts.forEach((p, i) => (i === 0 ? octx.moveTo(p.x, p.y) : octx.lineTo(p.x, p.y)));
      octx.stroke();
    };
    const tangentAt = (i: number): Pt => {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      return norm({ x: b.x - a.x, y: b.y - a.y });
    };
    const bandAt = (frac: number, size: number) => {
      const i = clamp(Math.round(frac * (pts.length - 1)), 0, pts.length - 1);
      const tg = tangentAt(i);
      octx.strokeStyle = `rgba(${dev},${Math.min(1, dA + 0.05)})`;
      octx.lineWidth = 2.4;
      octx.beginPath();
      octx.moveTo(pts[i].x - tg.y * size, pts[i].y + tg.x * size);
      octx.lineTo(pts[i].x + tg.y * size, pts[i].y - tg.x * size);
      octx.stroke();
    };

    if (object.objectType === 'guidewire') {
      strokePts(1.1, dA);
      octx.globalAlpha = 0.4;
      strokePts(0.6, dA);
      octx.globalAlpha = 1;
    } else if (object.objectType === 'catheter') {
      strokePts(3, dA * 0.78);
      strokePts(1.3, dA * 0.5);
      bandAt(1, 4);
    } else if (object.objectType === 'sheath') {
      strokePts(5, dA * 0.6);
      bandAt(0, 5);
    } else if (object.objectType === 'balloon') {
      strokePts(1.2, dA * 0.7);
      if (object.state === 'deployed') {
        const mid = Math.floor(pts.length / 2);
        const tg = tangentAt(mid);
        octx.save();
        octx.translate(pts[mid].x, pts[mid].y);
        octx.rotate(Math.atan2(tg.y, tg.x));
        octx.fillStyle = `rgba(${dev},0.16)`;
        octx.beginPath();
        octx.ellipse(0, 0, 20, 6.5, 0, 0, Math.PI * 2);
        octx.fill();
        octx.restore();
      }
      bandAt(0.18, 4.5);
      bandAt(0.82, 4.5);
    } else if (object.objectType === 'stent' || object.objectType === 'stentGraft') {
      const isGraft = object.objectType === 'stentGraft';
      if (isGraft) {
        octx.save();
        octx.globalAlpha = 0.22;
        octx.fillStyle = `rgba(${dev},1)`;
        octx.beginPath();
        pts.forEach((p, i) => {
          const tg = tangentAt(i);
          const e = { x: p.x - tg.y * half, y: p.y + tg.x * half };
          if (i === 0) octx.moveTo(e.x, e.y);
          else octx.lineTo(e.x, e.y);
        });
        for (let i = pts.length - 1; i >= 0; i -= 1) {
          const tg = tangentAt(i);
          octx.lineTo(pts[i].x + tg.y * half, pts[i].y - tg.x * half);
        }
        octx.closePath();
        octx.fill();
        octx.restore();
      }
      const cells = isGraft ? 18 : 22;
      octx.strokeStyle = `rgba(${dev},${dA * 0.7})`;
      octx.lineWidth = isGraft ? 1 : 0.8;
      for (const d of [1, -1]) {
        octx.beginPath();
        for (let i = 0; i <= cells; i += 1) {
          const f = i / cells;
          const pi = clamp(Math.round(f * (pts.length - 1)), 0, pts.length - 1);
          const p = pts[pi];
          const tg = tangentAt(pi);
          const amp = clamp(half * 0.82, 3, 15) * (i % 2 === 0 ? d : -d);
          const x = p.x - tg.y * amp;
          const y = p.y + tg.x * amp;
          if (i === 0) octx.moveTo(x, y);
          else octx.lineTo(x, y);
        }
        octx.stroke();
      }
      bandAt(0.02, clamp(half, 4, 15));
      bandAt(0.98, clamp(half, 4, 15));
      if (isGraft) bandAt(0.5, clamp(half * 0.6, 3, 9));
    }
  }

  for (const placement of input.devicePlacements) {
    const host = graph.nodes.get(placement.segmentId);
    if (!host) continue;
    const p = centerAt(host, clamp(placement.t, 0, 1));
    octx.fillStyle = `rgba(${dev},${dA * 0.7})`;
    octx.beginPath();
    octx.arc(p.x, p.y, 3.4, 0, Math.PI * 2);
    octx.fill();
  }
  octx.restore();
}

function drawSilhouettes(ctx: CanvasRenderingContext2D, strength: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  withFilter(ctx, 'blur(9px)', () => {
    ctx.fillStyle = `rgba(150,156,166,${strength})`;
    ctx.fillRect(CX - 30, 30, 60, ANGIO_WORKSPACE_HEIGHT - 60);
    ctx.fillStyle = `rgba(150,156,166,${strength * 0.8})`;
    ctx.beginPath();
    ctx.ellipse(CX - 155, ANGIO_WORKSPACE_HEIGHT - 115, 135, 100, 0.3, 0, Math.PI * 2);
    ctx.ellipse(CX + 155, ANGIO_WORKSPACE_HEIGHT - 115, 135, 100, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(120,126,134,${strength * 0.5})`;
    ctx.beginPath();
    ctx.ellipse(CX, CY - 30, 330, 240, 0, 0, Math.PI * 2);
    ctx.fill();
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
    const view = computeAngioViewTransform({
      segments: input.segments,
      projection: input.projection,
    });
    const graph = buildGraph(input, view);

    const bg = ctx.createRadialGradient(CX, CY * 0.86, 60, CX, CY, ANGIO_WORKSPACE_WIDTH * 0.74);
    bg.addColorStop(0, cfg.bg[0]);
    bg.addColorStop(0.5, cfg.bg[1]);
    bg.addColorStop(1, cfg.bg[2]);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, ANGIO_WORKSPACE_WIDTH, ANGIO_WORKSPACE_HEIGHT);
    const expo = ctx.createLinearGradient(0, 0, ANGIO_WORKSPACE_WIDTH, ANGIO_WORKSPACE_HEIGHT);
    expo.addColorStop(0, 'rgba(255,255,255,0.045)');
    expo.addColorStop(0.5, 'rgba(0,0,0,0)');
    expo.addColorStop(1, 'rgba(0,0,0,0.06)');
    ctx.fillStyle = expo;
    ctx.fillRect(0, 0, ANGIO_WORKSPACE_WIDTH, ANGIO_WORKSPACE_HEIGHT);
    if (cfg.silhouettes) drawSilhouettes(ctx, TUNING.fluoroSoftTissueStrength);

    const scene = sceneCanvas();
    const octx = scene.getContext('2d');
    if (octx) {
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.clearRect(0, 0, ANGIO_WORKSPACE_WIDTH, ANGIO_WORKSPACE_HEIGHT);
      paintTreeMask(octx, graph, cfg);
      paintDevices(octx, graph, input, cfg);

      if (cfg.roadmapGhost) {
        ctx.save();
        ctx.globalAlpha = TUNING.roadmapTintStrength * 0.45;
        withFilter(ctx, 'blur(2.2px)', () => ctx.drawImage(scene, -2, 1));
        ctx.restore();
      }
      ctx.save();
      if (cfg.roadmapGhost) ctx.globalAlpha = 0.92;
      withFilter(ctx, `blur(${Math.min(cfg.softness, TUNING.motionSoftness + 0.4)}px)`, () =>
        ctx.drawImage(scene, 0, 0),
      );
      ctx.restore();
    }

    if (input.selectedId) {
      const seg = graph.nodes.get(input.selectedId);
      const obj = input.proceduralObjects.find((o) => o.id === input.selectedId);
      ctx.save();
      ctx.strokeStyle = 'rgba(120,200,255,0.7)';
      ctx.lineWidth = 1.8;
      ctx.setLineDash([5, 4]);
      if (seg) {
        ctx.beginPath();
        for (let i = 0; i <= 24; i += 1) {
          const p = centerAt(seg, i / 24);
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      } else if (obj) {
        const host = graph.nodes.get(obj.segmentId);
        if (host) {
          const p = centerAt(host, clamp(obj.t, 0, 1));
          ctx.beginPath();
          ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    ctx.fillStyle =
      input.preset === 'dsa' ? `rgba(70,72,76,${cfg.haze})` : `rgba(120,128,140,${cfg.haze})`;
    ctx.fillRect(0, 0, ANGIO_WORKSPACE_WIDTH, ANGIO_WORKSPACE_HEIGHT);

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

    const nz = grainCanvas(cfg.noise);
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
