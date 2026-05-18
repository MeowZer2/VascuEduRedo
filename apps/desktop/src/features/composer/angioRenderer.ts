// Advanced 2D synthetic angiogram renderer (Canvas 2D), v0.42.
//
// Pure module: the React layer owns interaction; this only draws pixels and
// is wrapped so any failure makes the caller fall back to the legacy SVG.
//
// v0.42 — artifact cleanup. Vessels are now painted as ONE union mask that is
// then filled with a single continuous global density field (so there are no
// per-segment gradient resets, no overlap accumulation bands, and no hard
// rectangular noise clips). Devices are composited in a SEPARATE radiopacity
// buffer so contrast and hardware no longer muddy together. Graft fabric is a
// faint soft body (not a solid block); side branches are short, curved, low
// contrast and merged into the vessel union; global blur is replaced by a
// light local edge-softness halo.
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

// --- internal tuning knobs (no UI yet) ------------------------------------

const TUNING = {
  vesselOpacity: 0.92,
  deviceOpacity: 0.95,
  graftBodyOpacity: 0.16,
  sideBranchOpacity: 0.4,
  sideBranchMaxLength: 78,
  dsaBackgroundLevel: 0.86,
  centralColumnStrength: 0.3,
  junctionBlendStrength: 1,
  edgeSoftness: 1.4,
  internalNoise: 0.16,
  contrastFalloff: 0.6,
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
  const m = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / m, y: v.y / m };
}

// --- vascular graph (topology, unchanged from v0.41) -----------------------

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
  return 0.2;
}
function diameterToHalf(mm: number, scale: number): number {
  return (clamp(mm, 1.2, 30) * 1.55 + 3) * 0.5 * scale;
}

function buildGraph(
  input: AngioRenderInput,
  view: AngioViewTransform,
): { nodes: Map<string, VNode>; order: string[] } {
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

  return { nodes, order };
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
  const w = valueNoise(n.seed + 101, t * 2.2) * Math.hypot(n.b.x - n.a.x, n.b.y - n.a.y) * 0.01;
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
    valueNoise(n.seed + (side === 1 ? 7 : 23), t * 5) * 0.1 +
    valueNoise(n.seed + (side === 1 ? 53 : 71), t * 1.6) * 0.06;
  return Math.max(1.2, half * (1 + irr));
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
  edgeBlur: number;
  silhouettes: boolean;
  roadmapGhost: boolean;
  vignette: string;
}

function presetConfig(preset: AngioPreset): PresetConfig {
  switch (preset) {
    case 'dsa':
      // Subtracted look: muted grey field (not blank white), crisp.
      return {
        bg: ['#dfe2e4', '#ccd0d2', '#b4b9bc'],
        ink: '22,25,30',
        density: 0.95,
        haze: 0.05,
        noise: 0.03,
        banding: 0.01,
        edgeBlur: 0.5,
        silhouettes: false,
        roadmapGhost: false,
        vignette: 'rgba(34,38,42,0.42)',
      };
    case 'roadmap':
      return {
        bg: ['#0e1620', '#091018', '#04080d'],
        ink: '150,170,178',
        density: 0.6,
        haze: 0.045,
        noise: 0.08,
        banding: 0.02,
        edgeBlur: 0.8,
        silhouettes: true,
        roadmapGhost: true,
        vignette: 'rgba(0,0,0,0.54)',
      };
    case 'fluoro':
    default:
      return {
        bg: ['#12171d', '#0b0f14', '#050709'],
        ink: '208,216,222',
        density: 0.52,
        haze: 0.05,
        noise: 0.15,
        banding: 0.028,
        edgeBlur: 0.9,
        silhouettes: true,
        roadmapGhost: false,
        vignette: 'rgba(0,0,0,0.56)',
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
  const ctx = cache[key]!.getContext('2d');
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

// --- shared shape helpers --------------------------------------------------

function carinaPath(octx: CanvasRenderingContext2D, n: VNode, graph: Graph): boolean {
  if (n.childIds.length === 0) return false;
  const children = n.childIds.map((id) => graph.nodes.get(id)).filter((c): c is VNode => !!c);
  if (children.length === 0) return false;
  const pe = centerAt(n, 0.985);
  const pn = normalAt(n, 0.985);
  const ph = pathologyHalf(n, 0.985, 1);
  const ptan = bezTangent(n, 1);
  const ordered = children
    .map((c) => {
      const cs = centerAt(c, 0.06);
      return { c, side: (cs.x - pe.x) * pn.x + (cs.y - pe.y) * pn.y };
    })
    .sort((u, v) => v.side - u.side);
  const pL = { x: pe.x + pn.x * ph, y: pe.y + pn.y * ph };
  const pR = { x: pe.x - pn.x * ph, y: pe.y - pn.y * ph };
  const carina = { x: pe.x + ptan.x * ph * 1.05, y: pe.y + ptan.y * ph * 1.05 };
  octx.beginPath();
  octx.moveTo(pL.x, pL.y);
  ordered.forEach(({ c }, idx) => {
    const cn = normalAt(c, 0.05);
    const ch = pathologyHalf(c, 0.05, 1);
    const cc = centerAt(c, 0.2);
    const outer = idx === 0 ? 1 : -1;
    const wallOut = { x: cc.x + cn.x * ch * outer, y: cc.y + cn.y * ch * outer };
    const wallIn = { x: cc.x - cn.x * ch * outer, y: cc.y - cn.y * ch * outer };
    const ctrlA = {
      x: pe.x + ptan.x * ph * 0.55 + (idx === 0 ? pn.x : -pn.x) * ph,
      y: pe.y + ptan.y * ph * 0.55 + (idx === 0 ? pn.y : -pn.y) * ph,
    };
    octx.quadraticCurveTo(ctrlA.x, ctrlA.y, wallOut.x, wallOut.y);
    octx.lineTo(wallIn.x, wallIn.y);
    const last = idx === ordered.length - 1;
    octx.quadraticCurveTo(carina.x, carina.y, last ? pR.x : pe.x, last ? pR.y : pe.y);
  });
  octx.closePath();
  return true;
}

function sideBranches(
  n: VNode,
  fn: (poly: Pt[]) => void,
): void {
  const vt = (n.seg.vesselType || '').toLowerCase();
  if (!(vt.includes('aorta') || vt.includes('iliac') || vt.includes('femoral'))) return;
  const count = hash01(n.seed + 9) < 0.55 ? 1 : 0; // restrained
  for (let k = 0; k < count; k += 1) {
    const t = 0.4 + 0.4 * hash01(n.seed + 31 + k);
    const root = centerAt(n, t);
    const tg = bezTangent(n, t);
    const sideSign = hash01(n.seed + 51 + k) < 0.5 ? 1 : -1;
    const nrm = { x: -tg.y * sideSign, y: tg.x * sideSign };
    // emerge tangentially, then curve away — short and tapered
    const dir = norm({ x: nrm.x * 0.7 + tg.x * 0.5, y: nrm.y * 0.7 + tg.y * 0.5 });
    const length = Math.min(
      TUNING.sideBranchMaxLength,
      pathologyHalf(n, t, 1) * (3.4 + hash01(n.seed + 71 + k) * 2.4),
    );
    const curve = (0.5 + hash01(n.seed + 81 + k) * 0.5) * sideSign;
    const poly: Pt[] = [];
    const back: Pt[] = [];
    for (let i = 0; i <= 12; i += 1) {
      const f = i / 12;
      const w = Math.max(0.5, pathologyHalf(n, t, 1) * 0.34 * (1 - f) ** 1.5);
      const bend = curve * length * 0.35 * f * f;
      const bx = root.x + dir.x * length * f + nrm.x * bend;
      const by = root.y + dir.y * length * f + nrm.y * bend;
      poly.push({ x: bx + nrm.x * w, y: by + nrm.y * w });
      back.unshift({ x: bx - nrm.x * w, y: by - nrm.y * w });
    }
    fn([...poly, ...back]);
  }
}

// --- vessel contrast buffer (union mask + one global density field) --------

function buildVesselBuffer(graph: Graph, cfg: PresetConfig): HTMLCanvasElement | null {
  const octx = bufCtx('vbuf');
  if (!octx || !cache.vbuf) return null;

  // 1. UNION mask: every ribbon + carina fork + side branch at alpha 1, same
  //    white, so overlaps merge (no per-segment accumulation bands or seams).
  octx.fillStyle = '#ffffff';
  for (const id of graph.order) {
    const n = graph.nodes.get(id);
    if (!n) continue;
    const end = n.seg.pathologyType === 'occlusion' ? 0.6 : 1;
    ribbonPath(octx, n, 0, end, 0.98);
    octx.fill();
  }
  for (const n of graph.nodes.values()) {
    if (carinaPath(octx, n, graph)) octx.fill();
  }
  octx.save();
  octx.globalAlpha = TUNING.sideBranchOpacity;
  for (const n of graph.nodes.values()) {
    sideBranches(n, (poly) => {
      octx.beginPath();
      poly.forEach((p, i) => (i === 0 ? octx.moveTo(p.x, p.y) : octx.lineTo(p.x, p.y)));
      octx.closePath();
      octx.fill();
    });
  }
  octx.restore();

  // 2. Replace the mask with ONE continuous global density field (ink-tinted,
  //    proximal→distal vertical falloff). source-in keeps the mask shape, so
  //    density is seamless across every join.
  const minY = 110;
  const maxY = 560;
  octx.globalCompositeOperation = 'source-in';
  const grad = octx.createLinearGradient(0, minY, 0, maxY);
  const a0 = cfg.density * TUNING.vesselOpacity;
  grad.addColorStop(0, `rgba(${cfg.ink},${a0})`);
  grad.addColorStop(0.55, `rgba(${cfg.ink},${a0 * (1 - TUNING.contrastFalloff * 0.35)})`);
  grad.addColorStop(1, `rgba(${cfg.ink},${a0 * (1 - TUNING.contrastFalloff * 0.62)})`);
  octx.fillStyle = grad;
  octx.fillRect(0, 0, ANGIO_WORKSPACE_WIDTH, ANGIO_WORKSPACE_HEIGHT);

  // 3. Subtle internal density variation, clipped to the mask via source-atop
  //    (no rectangular noise clips).
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

  // 4. Continuous central contrast column — one union of centerline strokes,
  //    laid over the field via source-atop so it cannot escape the lumen and
  //    the shared trunk is never stacked/over-painted.
  const cctx = bufCtx('core');
  if (cctx && cache.core) {
    cctx.strokeStyle = '#ffffff';
    cctx.lineCap = 'round';
    cctx.lineJoin = 'round';
    for (const id of graph.order) {
      const n = graph.nodes.get(id);
      if (!n) continue;
      const end = n.seg.pathologyType === 'occlusion' ? 0.6 : 1;
      cctx.lineWidth = Math.max(2, ((n.startHalf + n.endHalf) / 2) * 0.62);
      cctx.beginPath();
      for (let i = 0; i <= 22; i += 1) {
        const p = centerAt(n, (i / 22) * end);
        if (i === 0) cctx.moveTo(p.x, p.y);
        else cctx.lineTo(p.x, p.y);
      }
      cctx.stroke();
    }
    octx.globalCompositeOperation = 'source-atop';
    octx.globalAlpha = TUNING.centralColumnStrength;
    withFilter(octx, 'blur(1.1px)', () => {
      octx.fillStyle = `rgba(${cfg.ink},1)`;
      // tint the core mask, then stamp it
      const tmp = cctx;
      tmp.globalCompositeOperation = 'source-in';
      tmp.fillStyle = `rgba(${cfg.ink},1)`;
      tmp.fillRect(0, 0, ANGIO_WORKSPACE_WIDTH, ANGIO_WORKSPACE_HEIGHT);
      tmp.globalCompositeOperation = 'source-over';
      octx.drawImage(cache.core as HTMLCanvasElement, 0, 0);
    });
    octx.globalAlpha = 1;
  }

  // 5. Pathology that subtracts contrast (soft, clipped by the mask).
  octx.globalCompositeOperation = 'destination-out';
  for (const id of graph.order) {
    const n = graph.nodes.get(id);
    if (!n) continue;
    if (n.seg.pathologyType === 'aneurysm') {
      withFilter(octx, 'blur(6px)', () => {
        ribbonPath(octx, n, 0.24, 0.76, 0.84);
        octx.fillStyle = 'rgba(0,0,0,0.42)';
        octx.fill();
      });
    } else if (n.seg.pathologyType === 'thrombus') {
      const m = centerAt(n, 0.52);
      const cn = normalAt(n, 0.52);
      withFilter(octx, 'blur(4px)', () => {
        octx.beginPath();
        octx.ellipse(
          m.x,
          m.y,
          pathologyHalf(n, 0.52, 1) * 0.5,
          pathologyHalf(n, 0.52, 1) * 1.35,
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
        const x = c.x + cn.x * off;
        const y = c.y + cn.y * off;
        if (i === 0) octx.moveTo(x, y);
        else octx.lineTo(x, y);
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

  // Hardware union mask (white) — wires/catheters/sheaths/struts.
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
      strokePts(1.1);
    } else if (object.objectType === 'catheter') {
      strokePts(2.6);
      queueBand(1, 3.6);
    } else if (object.objectType === 'sheath') {
      strokePts(4.4);
      queueBand(0, 4.6);
    } else if (object.objectType === 'balloon') {
      strokePts(1.1);
      if (object.state === 'deployed') {
        const mid = Math.floor(pts.length / 2);
        const tg = tangentAt(mid);
        octx.save();
        octx.translate(pts[mid].x, pts[mid].y);
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
      // fine regular strut diamond (thin lines, not bars)
      const cells = isGraft ? 22 : 26;
      octx.lineWidth = 0.7;
      for (const d of [1, -1]) {
        octx.beginPath();
        for (let i = 0; i <= cells; i += 1) {
          const f = i / cells;
          const pi = clamp(Math.round(f * (pts.length - 1)), 0, pts.length - 1);
          const p = pts[pi];
          const tg = tangentAt(pi);
          const amp = clamp(half * 0.8, 3, 15) * (i % 2 === 0 ? d : -d);
          const x = p.x - tg.y * amp;
          const y = p.y + tg.x * amp;
          if (i === 0) octx.moveTo(x, y);
          else octx.lineTo(x, y);
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
    octx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
    octx.fill();
  }

  // Tint the hardware union once (uniform device radiopacity, no stacking).
  octx.globalCompositeOperation = 'source-in';
  octx.fillStyle = `rgba(${cfg.ink},${TUNING.deviceOpacity})`;
  octx.fillRect(0, 0, ANGIO_WORKSPACE_WIDTH, ANGIO_WORKSPACE_HEIGHT);
  octx.globalCompositeOperation = 'source-over';

  // Crisp bright marker bands on top (the most radiopaque parts).
  for (const m of markers) {
    octx.strokeStyle = `rgba(${cfg.ink},1)`;
    octx.lineWidth = 2.4;
    octx.beginPath();
    octx.moveTo(m.p.x - m.tg.y * m.size, m.p.y + m.tg.x * m.size);
    octx.lineTo(m.p.x + m.tg.y * m.size, m.p.y - m.tg.x * m.size);
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

    // 1. Background + subtle detector exposure gradient.
    const bg = ctx.createRadialGradient(CX, CY * 0.86, 60, CX, CY, ANGIO_WORKSPACE_WIDTH * 0.74);
    bg.addColorStop(0, cfg.bg[0]);
    bg.addColorStop(0.5, cfg.bg[1]);
    bg.addColorStop(1, cfg.bg[2]);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, ANGIO_WORKSPACE_WIDTH, ANGIO_WORKSPACE_HEIGHT);
    const expo = ctx.createLinearGradient(0, 0, ANGIO_WORKSPACE_WIDTH, ANGIO_WORKSPACE_HEIGHT);
    if (input.preset === 'dsa') {
      expo.addColorStop(0, 'rgba(40,44,48,0.05)');
      expo.addColorStop(0.5, 'rgba(0,0,0,0)');
      expo.addColorStop(1, 'rgba(20,22,26,0.08)');
    } else {
      expo.addColorStop(0, 'rgba(255,255,255,0.04)');
      expo.addColorStop(0.5, 'rgba(0,0,0,0)');
      expo.addColorStop(1, 'rgba(0,0,0,0.06)');
    }
    ctx.fillStyle = expo;
    ctx.fillRect(0, 0, ANGIO_WORKSPACE_WIDTH, ANGIO_WORKSPACE_HEIGHT);
    if (cfg.silhouettes) drawSilhouettes(ctx, 0.055);

    // 2. Vessel buffer (continuous contrast).
    const vbuf = buildVesselBuffer(graph, cfg);
    const devices = buildDeviceBuffer(graph, input, cfg);

    if (vbuf) {
      // Roadmap persistent ghost — single faint copy, no muddy duplicates.
      if (cfg.roadmapGhost) {
        ctx.save();
        ctx.globalAlpha = 0.32;
        withFilter(ctx, 'blur(2px)', () => ctx.drawImage(vbuf, -1.5, 1));
        ctx.restore();
      }
      // Soft edge halo (local softness) then crisp interior — not a global blur.
      ctx.save();
      ctx.globalAlpha = 0.55;
      withFilter(ctx, `blur(${cfg.edgeBlur + 1}px)`, () => ctx.drawImage(vbuf, 0, 0));
      ctx.restore();
      withFilter(ctx, `blur(${cfg.edgeBlur}px)`, () => ctx.drawImage(vbuf, 0, 0));
    }

    // 3. Faint graft fabric (soft body, never a solid block) — between
    //    contrast and hardware so the column still reads through it.
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
            const e = { x: p.x - t.y * g.half, y: p.y + t.x * g.half };
            if (i === 0) ctx.moveTo(e.x, e.y);
            else ctx.lineTo(e.x, e.y);
          });
          for (let i = g.pts.length - 1; i >= 0; i -= 1) {
            const t = tg(i);
            ctx.lineTo(g.pts[i].x + t.y * g.half, g.pts[i].y - t.x * g.half);
          }
          ctx.closePath();
          ctx.fill();
        }
      });
      ctx.restore();
    }

    // 4. Crisp device radiopacity buffer.
    if (devices.dbuf) {
      withFilter(ctx, input.preset === 'dsa' ? 'none' : 'blur(0.4px)', () =>
        ctx.drawImage(devices.dbuf as HTMLCanvasElement, 0, 0),
      );
    }

    // 5. Selection highlight on the continuous centerline.
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

    // 6. Scatter haze (avoids pure black/white blocks).
    ctx.fillStyle =
      input.preset === 'dsa' ? `rgba(70,72,76,${cfg.haze})` : `rgba(120,128,140,${cfg.haze})`;
    ctx.fillRect(0, 0, ANGIO_WORKSPACE_WIDTH, ANGIO_WORKSPACE_HEIGHT);

    // 7. Detector banding.
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

    // 8. Detector grain.
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

    // 9. Vignette.
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
