// Advanced 2D synthetic angiogram renderer (Canvas 2D), v0.43.
//
// Pure module: the React layer owns interaction; this only draws pixels and
// is wrapped so any failure makes the caller fall back to the legacy SVG.
//
// v0.43 — restores controlled radiographic bloom (from the FINAL density
// buffers, not segment stacking) and stabilizes multi-branch topology:
// cycle-safe parent/child linking, validity guards, an iterative depth/order
// pass, NaN/coordinate clamping, and a strict carina fork that only fuses a
// clean 2-child bifurcation — anything more complex or degenerate falls back
// to a small soft junction pool so the image can never explode into giant
// crossing polygons.
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

const ANGIO_DEBUG = false;

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

// --- internal tuning knobs (no UI yet) ------------------------------------

const TUNING = {
  vesselOpacity: 0.96,
  deviceOpacity: 0.96,
  graftBodyOpacity: 0.18,
  sideBranchOpacity: 0.34,
  sideBranchMaxLength: 60,
  centralColumnStrength: 0.4,
  edgeSoftness: 0.7,
  densityContrast: 0.52,
  roadmapTintStrength: 0.42,
  internalNoise: 0.13,
  // topology safety
  maxJoinDist: 34, // workspace px (× view.scale) for geometric child links
  minSegLen: 4,
};

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
// Guard against NaN / runaway coordinates ever reaching canvas commands.
function fin(v: number): number {
  return Number.isFinite(v) ? clamp(v, -4000, 5000) : 0;
}
function fpt(p: Pt): Pt {
  return { x: fin(p.x), y: fin(p.y) };
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
      if (!Number.isFinite(r.x) || !Number.isFinite(r.y)) continue;
      if (r.x < minX) minX = r.x;
      if (r.x > maxX) maxX = r.x;
      if (r.y < minY) minY = r.y;
      if (r.y > maxY) maxY = r.y;
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return { scale: 1, tx: 0, ty: 0 };
  const boxX0 = 96;
  const boxX1 = 904;
  const boxY0 = 118;
  const boxY1 = 556;
  const bw = Math.max(maxX - minX, 1);
  const bh = Math.max(maxY - minY, 1);
  const scale = clamp(Math.min((boxX1 - boxX0) / bw, (boxY1 - boxY0) / bh), 0.35, 2.4);
  const tx = (boxX0 + boxX1) / 2 - ((minX + maxX) / 2) * scale;
  const ty = (boxY0 + boxY1) / 2 - ((minY + maxY) / 2) * scale;
  return { scale, tx: fin(tx), ty: fin(ty) };
}

export function projectAngioPoint(
  point: Pt,
  projection: AngioProjection,
  view: AngioViewTransform,
): Pt {
  const r = projectRaw(point, projection);
  return { x: r.x * view.scale + view.tx, y: r.y * view.scale + view.ty };
}

/** Back-compat raw projector (kept exported so nothing external breaks). */
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
  const m = Math.hypot(v.x, v.y);
  if (!Number.isFinite(m) || m < 1e-6) return { x: 1, y: 0 };
  return { x: v.x / m, y: v.y / m };
}

// --- vascular graph (topology) --------------------------------------------

interface VNode {
  seg: VesselSegment;
  a: Pt;
  b: Pt;
  c: Pt;
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
  return 0.18;
}
function diameterToHalf(mm: number, scale: number): number {
  const v = Number.isFinite(mm) ? mm : 6;
  return (clamp(v, 1.2, 30) * 1.55 + 3) * 0.5 * scale;
}

function buildGraph(
  input: AngioRenderInput,
  view: AngioViewTransform,
): { nodes: Map<string, VNode>; order: string[]; skipped: number } {
  const { segments, bifurcations, projection } = input;
  const nodes = new Map<string, VNode>();
  const proj = (p: Pt) => fpt(projectAngioPoint(p, projection, view));
  let skipped = 0;

  for (const seg of segments) {
    if (!seg || typeof seg.id !== 'string') {
      skipped += 1;
      continue;
    }
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

  // Would linking child→parent introduce a cycle? (walk parent chain).
  const wouldCycle = (childId: string, parentId: string): boolean => {
    let cur: string | null = parentId;
    let guard = 0;
    while (cur && guard < 128) {
      if (cur === childId) return true;
      cur = nodes.get(cur)?.parentId ?? null;
      guard += 1;
    }
    return false;
  };
  const link = (parentId: string, childId: string): boolean => {
    if (parentId === childId) return false;
    const child = nodes.get(childId);
    const parent = nodes.get(parentId);
    if (!child || !parent || child.parentId) return false;
    if (wouldCycle(childId, parentId)) {
      skipped += 1;
      return false;
    }
    child.parentId = parentId;
    if (!parent.childIds.includes(childId)) parent.childIds.push(childId);
    return true;
  };

  // 1. Authored bifurcations (cycle-safe).
  for (const node of bifurcations) {
    if (!node) continue;
    const jp = proj(node.position);
    const parentId = node.parentSegmentId ?? null;
    for (const childId of node.childSegmentIds ?? []) {
      const child = nodes.get(childId);
      if (!child) continue;
      child.startJunction = jp;
      if (parentId && nodes.has(parentId)) link(parentId, childId);
    }
  }

  // 2. Geometric fallback (clamped distance, cycle-safe, nearest only).
  const TOL = TUNING.maxJoinDist * view.scale;
  for (const child of nodes.values()) {
    if (child.parentId) continue;
    let best: { id: string; d: number } | null = null;
    for (const parent of nodes.values()) {
      if (parent.seg.id === child.seg.id) continue;
      const d = Math.hypot(parent.b.x - child.a.x, parent.b.y - child.a.y);
      if (Number.isFinite(d) && d < TOL && (!best || d < best.d)) {
        best = { id: parent.seg.id, d };
      }
    }
    if (best && link(best.id, child.seg.id)) {
      if (!child.startJunction) child.startJunction = { ...child.a };
    }
  }

  // 3. Curvature + branch-takeoff tangent continuity.
  for (const n of nodes.values()) {
    const a = n.a;
    const b = n.b;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!Number.isFinite(len) || len < TUNING.minSegLen) {
      n.c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      continue;
    }
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
    n.c = fpt({ x: cx, y: cy });
  }

  // 4. Width continuity.
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

  // 5. Iterative (cycle-proof) distance-from-root fraction + render order.
  const roots = [...nodes.values()].filter(
    (n) => !n.parentId || !nodes.has(n.parentId),
  );
  let maxCum = 1;
  const visited = new Set<string>();
  const queue: Array<{ id: string; cum: number }> = roots.map((r) => ({ id: r.seg.id, cum: 0 }));
  while (queue.length > 0) {
    const { id, cum } = queue.shift() as { id: string; cum: number };
    if (visited.has(id)) continue;
    visited.add(id);
    const n = nodes.get(id);
    if (!n) continue;
    const segLen = Math.max(1, Math.hypot(n.b.x - n.a.x, n.b.y - n.a.y) || 1);
    n.depthFrac0 = cum;
    n.depthFrac1 = cum + segLen;
    maxCum = Math.max(maxCum, n.depthFrac1);
    for (const cid of n.childIds) {
      if (!visited.has(cid)) queue.push({ id: cid, cum: cum + segLen });
    }
  }
  // Any node never reached (cycle island / orphan) renders as its own root.
  for (const n of nodes.values()) {
    if (!visited.has(n.seg.id)) {
      n.depthFrac0 = 0;
      n.depthFrac1 = Math.max(1, Math.hypot(n.b.x - n.a.x, n.b.y - n.a.y) || 1);
    }
    n.depthFrac0 /= maxCum;
    n.depthFrac1 /= maxCum;
  }

  const order = [...nodes.values()]
    .sort((x, y) => x.depthFrac0 - y.depthFrac0)
    .map((n) => n.seg.id);

  if (ANGIO_DEBUG && skipped > 0) {
    // eslint-disable-next-line no-console
    console.debug(`[angio] skipped ${skipped} invalid segment/links`);
  }
  return { nodes, order, skipped };
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
  const w = valueNoise(n.seed + 101, t * 2.2) * Math.hypot(n.b.x - n.a.x, n.b.y - n.a.y) * 0.009;
  return fpt({ x: p.x - tg.y * w, y: p.y + tg.x * w });
}
function normalAt(n: VNode, t: number): Pt {
  const tg = bezTangent(n, t);
  return { x: -tg.y, y: tg.x };
}

function pathologyHalf(n: VNode, t: number, side: 1 | -1): number {
  const seg = n.seg;
  let half = n.startHalf + (n.endHalf - n.startHalf) * t;
  if (!Number.isFinite(half)) half = 6;
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
    valueNoise(n.seed + (side === 1 ? 7 : 23), t * 5) * 0.1 +
    valueNoise(n.seed + (side === 1 ? 53 : 71), t * 1.6) * 0.06;
  return clamp(half * (1 + irr), 1.2, 220);
}

function ribbonPath(octx: CanvasRenderingContext2D, n: VNode, t0: number, t1: number, scale: number): void {
  const samples = 26;
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i < samples; i += 1) {
    const t = t0 + (t1 - t0) * (i / (samples - 1));
    const c = centerAt(n, t);
    const nr = normalAt(n, t);
    const hl = pathologyHalf(n, t, 1) * scale;
    const hr = pathologyHalf(n, t, -1) * scale;
    left.push(fpt({ x: c.x + nr.x * hl, y: c.y + nr.y * hl }));
    right.unshift(fpt({ x: c.x - nr.x * hr, y: c.y - nr.y * hr }));
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
  edgeBlur: number;
  vesselBloomA: number;
  vesselBloomR: number;
  deviceBloomA: number;
  deviceBloomR: number;
  silhouettes: boolean;
  roadmapGhost: boolean;
  vignette: string;
}

function presetConfig(preset: AngioPreset): PresetConfig {
  switch (preset) {
    case 'dsa':
      // Subtracted: light grey field (not blank), rich dark contrast column,
      // moderate vessel halo, minimal device bloom, no banding.
      return {
        bg: ['#e7e9ea', '#d6d9da', '#bdc1c3'],
        ink: '17,19,24',
        density: 1,
        haze: 0.045,
        noise: 0.03,
        banding: 0,
        edgeBlur: 0.6,
        vesselBloomA: 0.32,
        vesselBloomR: 5,
        deviceBloomA: 0.1,
        deviceBloomR: 2,
        silhouettes: false,
        roadmapGhost: false,
        vignette: 'rgba(30,34,38,0.42)',
      };
    case 'roadmap':
      return {
        bg: ['#0e1822', '#091119', '#04080e'],
        ink: '135,196,214',
        density: 0.72,
        haze: 0.04,
        noise: 0.075,
        banding: 0.015,
        edgeBlur: 0.85,
        vesselBloomA: 0.34,
        vesselBloomR: 5.5,
        deviceBloomA: 0.22,
        deviceBloomR: 3,
        silhouettes: true,
        roadmapGhost: true,
        vignette: 'rgba(0,0,0,0.52)',
      };
    case 'fluoro':
    default:
      return {
        bg: ['#12171d', '#0b0f14', '#050709'],
        ink: '212,220,226',
        density: 0.6,
        haze: 0.05,
        noise: 0.14,
        banding: 0.024,
        edgeBlur: 0.95,
        vesselBloomA: 0.2,
        vesselBloomR: 4.5,
        deviceBloomA: 0.34,
        deviceBloomR: 3.5,
        silhouettes: true,
        roadmapGhost: false,
        vignette: 'rgba(0,0,0,0.54)',
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

function makeBuffer(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = ANGIO_WORKSPACE_WIDTH;
  c.height = ANGIO_WORKSPACE_HEIGHT;
  return c;
}
const cache: {
  vbuf: HTMLCanvasElement | null;
  dbuf: HTMLCanvasElement | null;
  core: HTMLCanvasElement | null;
  grain: { c: HTMLCanvasElement; key: string } | null;
  internal: HTMLCanvasElement | null;
  banding: HTMLCanvasElement | null;
} = { vbuf: null, dbuf: null, core: null, grain: null, internal: null, banding: null };

function bufCtx(key: 'vbuf' | 'dbuf' | 'core'): CanvasRenderingContext2D | null {
  if (!cache[key]) cache[key] = makeBuffer();
  const el = cache[key];
  if (!el) return null;
  const ctx = el.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, ANGIO_WORKSPACE_WIDTH, ANGIO_WORKSPACE_HEIGHT);
  return ctx;
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
  const cells = 30;
  const s = document.createElement('canvas');
  s.width = cells;
  s.height = cells;
  const sg = s.getContext('2d');
  if (!sg) return null;
  const img = sg.createImageData(cells, cells);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 150 + Math.random() * 105;
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
  withFilter(g, 'blur(9px)', () => g.drawImage(s, 0, 0, 256, 256));
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

// --- junction geometry (strict valid 2-child fork, else soft pool) ---------

function tryCarinaFork(octx: CanvasRenderingContext2D, n: VNode, graph: Graph): boolean {
  const children = n.childIds
    .map((id) => graph.nodes.get(id))
    .filter((c): c is VNode => !!c)
    .filter((c) => Math.hypot(c.b.x - c.a.x, c.b.y - c.a.y) >= TUNING.minSegLen);
  if (children.length !== 2) return false; // only fuse a clean 2-way fork

  const pe = centerAt(n, 0.985);
  const pn = normalAt(n, 0.985);
  const ptan = bezTangent(n, 1);
  const ph = clamp(pathologyHalf(n, 0.985, 1), 2, 70);

  const meta = children.map((c) => {
    const cs = centerAt(c, 0.06);
    return { c, side: (cs.x - pe.x) * pn.x + (cs.y - pe.y) * pn.y, dir: bezTangent(c, 0.1) };
  });
  meta.sort((u, v) => v.side - u.side);
  // Degeneracy guards: children must straddle the parent axis and diverge.
  if (Math.sign(meta[0].side) === Math.sign(meta[1].side) && Math.abs(meta[0].side - meta[1].side) < ph) {
    return false;
  }
  const dot = meta[0].dir.x * meta[1].dir.x + meta[0].dir.y * meta[1].dir.y;
  if (dot > 0.996) return false; // children almost colinear → not a real fork

  const pL = { x: pe.x + pn.x * ph, y: pe.y + pn.y * ph };
  const pR = { x: pe.x - pn.x * ph, y: pe.y - pn.y * ph };
  const carina = { x: pe.x + ptan.x * ph * 1.05, y: pe.y + ptan.y * ph * 1.05 };
  octx.beginPath();
  octx.moveTo(fin(pL.x), fin(pL.y));
  meta.forEach(({ c }, idx) => {
    const cn = normalAt(c, 0.05);
    const ch = clamp(pathologyHalf(c, 0.05, 1), 1.5, 60);
    const cc = centerAt(c, 0.2);
    const outer = idx === 0 ? 1 : -1;
    const wallOut = fpt({ x: cc.x + cn.x * ch * outer, y: cc.y + cn.y * ch * outer });
    const wallIn = fpt({ x: cc.x - cn.x * ch * outer, y: cc.y - cn.y * ch * outer });
    const ctrlA = fpt({
      x: pe.x + ptan.x * ph * 0.55 + (idx === 0 ? pn.x : -pn.x) * ph,
      y: pe.y + ptan.y * ph * 0.55 + (idx === 0 ? pn.y : -pn.y) * ph,
    });
    octx.quadraticCurveTo(ctrlA.x, ctrlA.y, wallOut.x, wallOut.y);
    octx.lineTo(wallIn.x, wallIn.y);
    const last = idx === meta.length - 1;
    octx.quadraticCurveTo(fin(carina.x), fin(carina.y), fin(last ? pR.x : pe.x), fin(last ? pR.y : pe.y));
  });
  octx.closePath();
  return true;
}

function softJunctionPool(octx: CanvasRenderingContext2D, n: VNode): void {
  // Stable fallback for >2 children / degenerate forks: a small clamped soft
  // disc at the junction so lumens still merge — never a giant polygon.
  const pe = centerAt(n, 1);
  const r = clamp((n.endHalf || 6) * 1.45, 3, 56);
  octx.beginPath();
  octx.arc(fin(pe.x), fin(pe.y), r, 0, Math.PI * 2);
  octx.closePath();
}

function sideBranches(n: VNode, suppress: boolean, fn: (poly: Pt[]) => void): void {
  if (suppress) return;
  const vt = (n.seg.vesselType || '').toLowerCase();
  if (!(vt.includes('aorta') || vt.includes('iliac') || vt.includes('femoral'))) return;
  if (Math.hypot(n.b.x - n.a.x, n.b.y - n.a.y) < TUNING.minSegLen * 4) return;
  if (hash01(n.seed + 9) >= 0.5) return; // ≤1, often none
  const t = 0.42 + 0.36 * hash01(n.seed + 31);
  const root = centerAt(n, t);
  const tg = bezTangent(n, t);
  const sideSign = hash01(n.seed + 51) < 0.5 ? 1 : -1;
  const nrm = { x: -tg.y * sideSign, y: tg.x * sideSign };
  const dir = norm({ x: nrm.x * 0.75 + tg.x * 0.45, y: nrm.y * 0.75 + tg.y * 0.45 });
  const length = clamp(
    pathologyHalf(n, t, 1) * (2.6 + hash01(n.seed + 71) * 1.8),
    6,
    TUNING.sideBranchMaxLength,
  );
  const curve = (0.4 + hash01(n.seed + 81) * 0.5) * sideSign;
  const poly: Pt[] = [];
  const back: Pt[] = [];
  for (let i = 0; i <= 12; i += 1) {
    const f = i / 12;
    const w = Math.max(0.5, pathologyHalf(n, t, 1) * 0.3 * (1 - f) ** 1.6);
    const bend = curve * length * 0.32 * f * f;
    const bx = root.x + dir.x * length * f + nrm.x * bend;
    const by = root.y + dir.y * length * f + nrm.y * bend;
    poly.push(fpt({ x: bx + nrm.x * w, y: by + nrm.y * w }));
    back.unshift(fpt({ x: bx - nrm.x * w, y: by - nrm.y * w }));
  }
  fn([...poly, ...back]);
}

// --- vessel contrast buffer (union mask + global density field) ------------

function buildVesselBuffer(graph: Graph, cfg: PresetConfig): HTMLCanvasElement | null {
  const octx = bufCtx('vbuf');
  if (!octx || !cache.vbuf) return null;

  // Restrain decorative branches when the plan already has rich anatomy.
  const suppressBranches = graph.nodes.size > 5;

  // 1. UNION mask (ribbons + valid carina forks / soft pools + side branches).
  octx.fillStyle = '#ffffff';
  for (const id of graph.order) {
    const n = graph.nodes.get(id);
    if (!n) continue;
    const end = n.seg.pathologyType === 'occlusion' ? 0.6 : 1;
    ribbonPath(octx, n, 0, end, 0.98);
    octx.fill();
  }
  for (const n of graph.nodes.values()) {
    if (n.childIds.length === 0) continue;
    if (tryCarinaFork(octx, n, graph)) octx.fill();
    else {
      softJunctionPool(octx, n);
      withFilter(octx, 'blur(2px)', () => octx.fill());
    }
  }
  octx.save();
  octx.globalAlpha = TUNING.sideBranchOpacity;
  for (const n of graph.nodes.values()) {
    sideBranches(n, suppressBranches, (poly) => {
      octx.beginPath();
      poly.forEach((p, i) => (i === 0 ? octx.moveTo(p.x, p.y) : octx.lineTo(p.x, p.y)));
      octx.closePath();
      octx.fill();
    });
  }
  octx.restore();

  // 2. One continuous global density field (ink-tinted prox→distal).
  const a0 = cfg.density * TUNING.vesselOpacity;
  octx.globalCompositeOperation = 'source-in';
  const grad = octx.createLinearGradient(0, 110, 0, 560);
  grad.addColorStop(0, `rgba(${cfg.ink},${a0})`);
  grad.addColorStop(0.55, `rgba(${cfg.ink},${a0 * (1 - TUNING.densityContrast * 0.32)})`);
  grad.addColorStop(1, `rgba(${cfg.ink},${a0 * (1 - TUNING.densityContrast * 0.58)})`);
  octx.fillStyle = grad;
  octx.fillRect(0, 0, ANGIO_WORKSPACE_WIDTH, ANGIO_WORKSPACE_HEIGHT);

  // 3. Subtle internal density variation (clipped via source-atop).
  const tile = internalNoiseCanvas();
  if (tile) {
    octx.globalCompositeOperation = 'source-atop';
    octx.globalAlpha = TUNING.internalNoise;
    const pat = octx.createPattern(tile, 'repeat');
    if (pat) {
      octx.fillStyle = pat;
      octx.fillRect(0, 0, ANGIO_WORKSPACE_WIDTH, ANGIO_WORKSPACE_HEIGHT);
    }
    octx.globalAlpha = 1;
  }

  // 4. Continuous central contrast column (single union, source-atop).
  const cctx = bufCtx('core');
  if (cctx && cache.core) {
    cctx.strokeStyle = '#ffffff';
    cctx.lineCap = 'round';
    cctx.lineJoin = 'round';
    for (const id of graph.order) {
      const n = graph.nodes.get(id);
      if (!n) continue;
      const end = n.seg.pathologyType === 'occlusion' ? 0.6 : 1;
      cctx.lineWidth = clamp(((n.startHalf + n.endHalf) / 2) * 0.6, 2, 60);
      cctx.beginPath();
      for (let i = 0; i <= 22; i += 1) {
        const p = centerAt(n, (i / 22) * end);
        if (i === 0) cctx.moveTo(p.x, p.y);
        else cctx.lineTo(p.x, p.y);
      }
      cctx.stroke();
    }
    cctx.globalCompositeOperation = 'source-in';
    cctx.fillStyle = `rgba(${cfg.ink},1)`;
    cctx.fillRect(0, 0, ANGIO_WORKSPACE_WIDTH, ANGIO_WORKSPACE_HEIGHT);
    octx.globalCompositeOperation = 'source-atop';
    octx.globalAlpha = TUNING.centralColumnStrength;
    withFilter(octx, 'blur(1px)', () => octx.drawImage(cache.core as HTMLCanvasElement, 0, 0));
    octx.globalAlpha = 1;
  }

  // 5. Contrast-subtracting pathology, clipped by the mask.
  octx.globalCompositeOperation = 'destination-out';
  for (const id of graph.order) {
    const n = graph.nodes.get(id);
    if (!n) continue;
    if (n.seg.pathologyType === 'aneurysm') {
      withFilter(octx, 'blur(6px)', () => {
        ribbonPath(octx, n, 0.24, 0.76, 0.84);
        octx.fillStyle = 'rgba(0,0,0,0.4)';
        octx.fill();
      });
    } else if (n.seg.pathologyType === 'thrombus') {
      const m = centerAt(n, 0.52);
      const cn = normalAt(n, 0.52);
      withFilter(octx, 'blur(4px)', () => {
        octx.beginPath();
        octx.ellipse(
          fin(m.x),
          fin(m.y),
          clamp(pathologyHalf(n, 0.52, 1) * 0.5, 1, 120),
          clamp(pathologyHalf(n, 0.52, 1) * 1.35, 1, 200),
          Math.atan2(cn.x, -cn.y),
          0,
          Math.PI * 2,
        );
        octx.fillStyle = 'rgba(0,0,0,0.5)';
        octx.fill();
      });
    } else if (n.seg.pathologyType === 'dissection') {
      octx.lineWidth = 1.5;
      octx.strokeStyle = 'rgba(0,0,0,0.55)';
      octx.beginPath();
      for (let i = 0; i <= 22; i += 1) {
        const t = 0.16 + (0.68 * i) / 22;
        const c = centerAt(n, t);
        const cn = normalAt(n, t);
        const off = pathologyHalf(n, t, 1) * 0.4 * Math.sin(t * Math.PI);
        if (i === 0) octx.moveTo(fin(c.x + cn.x * off), fin(c.y + cn.y * off));
        else octx.lineTo(fin(c.x + cn.x * off), fin(c.y + cn.y * off));
      }
      octx.stroke();
    }
  }
  octx.globalCompositeOperation = 'source-over';
  return cache.vbuf;
}

// --- device radiopacity buffer + faint graft fabric ------------------------

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
  const traversal = isWire || object.objectType === 'catheter' || object.objectType === 'sheath';
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

function buildDeviceBuffer(
  graph: Graph,
  input: AngioRenderInput,
  cfg: PresetConfig,
): { dbuf: HTMLCanvasElement | null; grafts: Array<{ pts: Pt[]; half: number }> } {
  const octx = bufCtx('dbuf');
  const grafts: Array<{ pts: Pt[]; half: number }> = [];
  if (!octx || !cache.dbuf) return { dbuf: null, grafts };

  octx.strokeStyle = '#ffffff';
  octx.fillStyle = '#ffffff';
  octx.lineCap = 'round';
  octx.lineJoin = 'round';
  const markers: Array<{ p: Pt; tg: Pt; size: number }> = [];

  for (const object of input.proceduralObjects) {
    const dp = devicePath(graph, object, 26);
    if (!dp || dp.pts.length < 2) continue;
    const { pts, host } = dp;
    const half = clamp((host.startHalf + host.endHalf) * 0.42, 4, 22);
    const tangentAt = (i: number): Pt =>
      norm({
        x: pts[Math.min(pts.length - 1, i + 1)].x - pts[Math.max(0, i - 1)].x,
        y: pts[Math.min(pts.length - 1, i + 1)].y - pts[Math.max(0, i - 1)].y,
      });
    const strokePts = (w: number) => {
      octx.lineWidth = w;
      octx.beginPath();
      pts.forEach((p, i) => (i === 0 ? octx.moveTo(p.x, p.y) : octx.lineTo(p.x, p.y)));
      octx.stroke();
    };
    const queueBand = (frac: number, size: number) => {
      const i = clamp(Math.round(frac * (pts.length - 1)), 0, pts.length - 1);
      markers.push({ p: pts[i], tg: tangentAt(i), size });
    };

    if (object.objectType === 'guidewire') {
      strokePts(1.2);
    } else if (object.objectType === 'catheter') {
      strokePts(2.6);
      queueBand(1, 3.6);
    } else if (object.objectType === 'sheath') {
      strokePts(4.4);
      queueBand(0, 4.6);
    } else if (object.objectType === 'balloon') {
      strokePts(1.2);
      if (object.state === 'deployed') {
        const mid = Math.floor(pts.length / 2);
        const tg = tangentAt(mid);
        octx.save();
        octx.translate(fin(pts[mid].x), fin(pts[mid].y));
        octx.rotate(Math.atan2(tg.y, tg.x));
        octx.beginPath();
        octx.ellipse(0, 0, 18, 5.5, 0, 0, Math.PI * 2);
        octx.fill();
        octx.restore();
      }
      queueBand(0.2, 4);
      queueBand(0.8, 4);
    } else if (object.objectType === 'stent' || object.objectType === 'stentGraft') {
      const isGraft = object.objectType === 'stentGraft';
      if (isGraft) grafts.push({ pts, half });
      const cells = isGraft ? 22 : 26;
      octx.lineWidth = 0.75;
      for (const d of [1, -1]) {
        octx.beginPath();
        for (let i = 0; i <= cells; i += 1) {
          const f = i / cells;
          const pi = clamp(Math.round(f * (pts.length - 1)), 0, pts.length - 1);
          const p = pts[pi];
          const tg = tangentAt(pi);
          const amp = clamp(half * 0.8, 3, 15) * (i % 2 === 0 ? d : -d);
          if (i === 0) octx.moveTo(fin(p.x - tg.y * amp), fin(p.y + tg.x * amp));
          else octx.lineTo(fin(p.x - tg.y * amp), fin(p.y + tg.x * amp));
        }
        octx.stroke();
      }
      queueBand(0.02, half);
      queueBand(0.98, half);
      if (isGraft) queueBand(0.5, half * 0.62);
    }
  }
  for (const placement of input.devicePlacements) {
    const host = graph.nodes.get(placement.segmentId);
    if (!host) continue;
    const p = centerAt(host, clamp(placement.t, 0, 1));
    octx.beginPath();
    octx.arc(fin(p.x), fin(p.y), 3.2, 0, Math.PI * 2);
    octx.fill();
  }

  octx.globalCompositeOperation = 'source-in';
  octx.fillStyle = `rgba(${cfg.ink},${TUNING.deviceOpacity})`;
  octx.fillRect(0, 0, ANGIO_WORKSPACE_WIDTH, ANGIO_WORKSPACE_HEIGHT);
  octx.globalCompositeOperation = 'source-over';

  for (const m of markers) {
    octx.strokeStyle = `rgba(${cfg.ink},1)`;
    octx.lineWidth = 2.4;
    octx.beginPath();
    octx.moveTo(fin(m.p.x - m.tg.y * m.size), fin(m.p.y + m.tg.x * m.size));
    octx.lineTo(fin(m.p.x + m.tg.y * m.size), fin(m.p.y - m.tg.x * m.size));
    octx.stroke();
  }
  return { dbuf: cache.dbuf, grafts };
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

    // 1. Background + detector exposure gradient.
    const bg = ctx.createRadialGradient(CX, CY * 0.86, 60, CX, CY, ANGIO_WORKSPACE_WIDTH * 0.74);
    bg.addColorStop(0, cfg.bg[0]);
    bg.addColorStop(0.5, cfg.bg[1]);
    bg.addColorStop(1, cfg.bg[2]);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, ANGIO_WORKSPACE_WIDTH, ANGIO_WORKSPACE_HEIGHT);
    const expo = ctx.createLinearGradient(0, 0, ANGIO_WORKSPACE_WIDTH, ANGIO_WORKSPACE_HEIGHT);
    if (input.preset === 'dsa') {
      expo.addColorStop(0, 'rgba(44,48,52,0.06)');
      expo.addColorStop(0.5, 'rgba(0,0,0,0)');
      expo.addColorStop(1, 'rgba(18,20,24,0.09)');
    } else {
      expo.addColorStop(0, 'rgba(255,255,255,0.04)');
      expo.addColorStop(0.5, 'rgba(0,0,0,0)');
      expo.addColorStop(1, 'rgba(0,0,0,0.06)');
    }
    ctx.fillStyle = expo;
    ctx.fillRect(0, 0, ANGIO_WORKSPACE_WIDTH, ANGIO_WORKSPACE_HEIGHT);
    if (cfg.silhouettes) drawSilhouettes(ctx, 0.055);

    const vbuf = buildVesselBuffer(graph, cfg);
    const devices = buildDeviceBuffer(graph, input, cfg);

    if (vbuf) {
      // Roadmap persistent ghost — single intentional faint copy.
      if (cfg.roadmapGhost) {
        ctx.save();
        ctx.globalAlpha = 0.3;
        withFilter(ctx, 'blur(2px)', () => ctx.drawImage(vbuf, -1.5, 1));
        ctx.restore();
      }
      // Controlled radiographic bloom from the FINAL vessel buffer.
      ctx.save();
      ctx.globalAlpha = cfg.vesselBloomA;
      ctx.globalCompositeOperation = input.preset === 'dsa' ? 'multiply' : 'lighter';
      withFilter(ctx, `blur(${cfg.vesselBloomR}px)`, () => ctx.drawImage(vbuf, 0, 0));
      ctx.restore();
      // Soft local edge halo, then crisp interior (no global mush).
      ctx.save();
      ctx.globalAlpha = 0.5;
      withFilter(ctx, `blur(${cfg.edgeBlur + 1.4}px)`, () => ctx.drawImage(vbuf, 0, 0));
      ctx.restore();
      withFilter(ctx, `blur(${cfg.edgeBlur}px)`, () => ctx.drawImage(vbuf, 0, 0));
    }

    // 2. Faint graft fabric (subtle body, never a block).
    if (devices.grafts.length > 0) {
      ctx.save();
      ctx.globalAlpha = TUNING.graftBodyOpacity;
      ctx.fillStyle = `rgba(${cfg.ink},1)`;
      withFilter(ctx, 'blur(1.4px)', () => {
        for (const g of devices.grafts) {
          const tg = (i: number): Pt =>
            norm({
              x: g.pts[Math.min(g.pts.length - 1, i + 1)].x - g.pts[Math.max(0, i - 1)].x,
              y: g.pts[Math.min(g.pts.length - 1, i + 1)].y - g.pts[Math.max(0, i - 1)].y,
            });
          ctx.beginPath();
          g.pts.forEach((p, i) => {
            const t = tg(i);
            if (i === 0) ctx.moveTo(fin(p.x - t.y * g.half), fin(p.y + t.x * g.half));
            else ctx.lineTo(fin(p.x - t.y * g.half), fin(p.y + t.x * g.half));
          });
          for (let i = g.pts.length - 1; i >= 0; i -= 1) {
            const t = tg(i);
            ctx.lineTo(fin(g.pts[i].x + t.y * g.half), fin(g.pts[i].y - t.x * g.half));
          }
          ctx.closePath();
          ctx.fill();
        }
      });
      ctx.restore();
    }

    // 3. Device bloom + crisp device buffer.
    if (devices.dbuf) {
      ctx.save();
      ctx.globalAlpha = cfg.deviceBloomA;
      ctx.globalCompositeOperation = input.preset === 'dsa' ? 'multiply' : 'lighter';
      withFilter(ctx, `blur(${cfg.deviceBloomR}px)`, () =>
        ctx.drawImage(devices.dbuf as HTMLCanvasElement, 0, 0),
      );
      ctx.restore();
      withFilter(ctx, input.preset === 'dsa' ? 'none' : 'blur(0.35px)', () =>
        ctx.drawImage(devices.dbuf as HTMLCanvasElement, 0, 0),
      );
    }

    // 4. Selection highlight on the continuous centerline.
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
          ctx.arc(fin(p.x), fin(p.y), 14, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // 5. Scatter haze (avoids pure black/white clipping).
    ctx.fillStyle =
      input.preset === 'dsa' ? `rgba(70,72,76,${cfg.haze})` : `rgba(120,128,140,${cfg.haze})`;
    ctx.fillRect(0, 0, ANGIO_WORKSPACE_WIDTH, ANGIO_WORKSPACE_HEIGHT);

    // 6. Detector banding (skipped for DSA).
    const band = bandingCanvas();
    if (band && cfg.banding > 0) {
      const pat = ctx.createPattern(band, 'repeat');
      if (pat) {
        ctx.save();
        ctx.globalAlpha = cfg.banding;
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = pat;
        ctx.fillRect(0, 0, ANGIO_WORKSPACE_WIDTH, ANGIO_WORKSPACE_HEIGHT);
        ctx.restore();
      }
    }

    // 7. Detector grain.
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
