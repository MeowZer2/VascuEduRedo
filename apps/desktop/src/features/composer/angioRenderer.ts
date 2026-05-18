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
  vesselDensity: 0.9,
  edgeSoftness: 2.6,
  internalNoise: 0.26,
  contrastFalloff: 0.72,
  backgroundNoise: 1,
  roadmapTintStrength: 0.55,
  fluoroSoftTissueStrength: 0.06,
  deviceOpacity: 0.95,
  motionSoftness: 0.9,
  centralColumn: 0.3,
  streakStrength: 0.12,
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

// --- lumen profile ---------------------------------------------------------

function aneurysmExtra(segment: VesselSegment, t: number): number {
  if (segment.pathologyType !== 'aneurysm') return 0;
  const prox = clamp(segment.proximalDiameterMm, 1.5, 30);
  const dist = clamp(segment.distalDiameterMm, 1.2, 30);
  const base = (prox + (dist - prox) * t) * 1.55 + 3;
  return base * 1.05 * gaussian(t, 0.5, 0.2);
}

function isSaccular(segment: VesselSegment): boolean {
  const meta = segment.metadata as Record<string, unknown> | undefined;
  const shape = typeof meta?.aneurysmShape === 'string' ? (meta.aneurysmShape as string) : '';
  const text = `${shape} ${segment.notes ?? ''} ${segment.label ?? ''}`.toLowerCase();
  return text.includes('saccular');
}

function baseHalf(segment: VesselSegment, t: number): number {
  const prox = clamp(segment.proximalDiameterMm, 1.5, 30);
  const dist = clamp(segment.distalDiameterMm, 1.2, 30);
  const base = (prox + (dist - prox) * t) * 1.55 + 3;
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
        density: 0.92,
        haze: 0.04,
        noise: 0.03,
        banding: 0.015,
        silhouettes: false,
        roadmapGhost: false,
        tint: null,
        vignette: 'rgba(38,42,46,0.4)',
      };
    case 'roadmap':
      return {
        bg: ['#0e1620', '#091018', '#04080d'],
        ink: '150,170,178',
        density: 0.58,
        haze: 0.05,
        noise: 0.09,
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
}
const cache: Cached = { scene: null, grain: null, internal: null, banding: null };

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
): void {
  const occluded = segment.pathologyType === 'occlusion';
  const lumenEnd = occluded ? 0.6 : 1;
  const ink = cfg.ink;
  const baseA = cfg.density * TUNING.vesselDensity;

  // Soft outer margin (edge falloff — no hard vector edge).
  withFilter(octx, `blur(${TUNING.edgeSoftness}px)`, () => {
    ribbonPath(octx, segment, sp, 0, lumenEnd, 1.06);
    octx.fillStyle = `rgba(${ink},${baseA * 0.34})`;
    octx.fill();
  });

  // Body density with proximal→distal falloff (gradient along the chord).
  const grad = octx.createLinearGradient(sp.a.x, sp.a.y, sp.b.x, sp.b.y);
  grad.addColorStop(0, `rgba(${ink},${baseA * 0.86})`);
  grad.addColorStop(0.55, `rgba(${ink},${baseA * 0.7 * lengthDensity(0.55)})`);
  grad.addColorStop(1, `rgba(${ink},${baseA * 0.6 * lengthDensity(1)})`);
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
  withFilter(octx, 'blur(1.4px)', () => {
    ribbonPath(octx, segment, sp, 0, lumenEnd, 0.42);
    octx.fillStyle = `rgba(${ink},${baseA * TUNING.centralColumn})`;
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
    withFilter(octx, 'blur(4px)', () => {
      ribbonPath(octx, segment, sp, 0.78, 1, 0.42);
      octx.fillStyle = `rgba(${ink},${baseA * 0.12})`;
      octx.fill();
    });
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

function paintDevice(
  octx: CanvasRenderingContext2D,
  object: ProceduralObject,
  segment: VesselSegment,
  sp: Spline,
  cfg: PresetConfig,
): void {
  const lenFrac = clamp(object.lengthMm / Math.max(segment.lengthMm, 1), 0.04, 0.95);
  const isWire = object.objectType === 'guidewire';
  const t1 = isWire ? 0 : clamp(object.t - lenFrac / 2, 0, 1);
  const t2 = isWire ? object.t : clamp(object.t + lenFrac / 2, 0, 1);
  const dev = cfg.ink;
  const dA = TUNING.deviceOpacity;

  const path = (steps: number): Pt[] => {
    const out: Pt[] = [];
    for (let i = 0; i <= steps; i += 1) out.push(splineAt(sp, t1 + (t2 - t1) * (i / steps)));
    return out;
  };
  const stroke = (pts: Pt[], width: number, alpha: number) => {
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
    octx.lineWidth = 2.4;
    octx.beginPath();
    octx.moveTo(c.x + nrm.x * size, c.y + nrm.y * size);
    octx.lineTo(c.x - nrm.x * size, c.y - nrm.y * size);
    octx.stroke();
  };

  octx.save();
  octx.lineCap = 'round';
  octx.lineJoin = 'round';

  if (object.objectType === 'guidewire') {
    stroke(path(28), 1.1, dA);
    // slightly noisy / aliased look
    octx.globalAlpha = 0.4;
    stroke(path(28), 0.6, dA);
    octx.globalAlpha = 1;
    stroke([splineAt(sp, clamp(t2 - 0.05, 0, 1)), splineAt(sp, t2)], 1.7, dA);
  } else if (object.objectType === 'catheter') {
    stroke(path(24), 3, dA * 0.78);
    stroke(path(24), 1.4, dA * 0.5);
    band(t2, 4);
  } else if (object.objectType === 'sheath') {
    stroke(path(20), 5, dA * 0.62);
    stroke([splineAt(sp, (t1 + t2) / 2), splineAt(sp, t2)], 3, dA * 0.7);
    band(t1, 5);
  } else if (object.objectType === 'balloon') {
    const inflated = object.state === 'deployed';
    stroke(path(20), 1.2, dA * 0.7);
    if (inflated) {
      const m = splineAt(sp, object.t);
      const nrm = splineNormal(sp, object.t);
      octx.save();
      octx.translate(m.x, m.y);
      octx.rotate(Math.atan2(nrm.y, nrm.x) + Math.PI / 2);
      octx.fillStyle = `rgba(${dev},0.18)`;
      octx.beginPath();
      octx.ellipse(0, 0, 22, 7, 0, 0, Math.PI * 2);
      octx.fill();
      octx.restore();
    }
    band(object.t - lenFrac * 0.4, 4.5);
    band(object.t + lenFrac * 0.4, 4.5);
  } else if (object.objectType === 'stent' || object.objectType === 'stentGraft') {
    const isGraft = object.objectType === 'stentGraft';
    if (isGraft) {
      octx.save();
      octx.globalAlpha = 0.22;
      ribbonPath(octx, segment, sp, t1, t2, 0.92);
      octx.fillStyle = `rgba(${dev},1)`;
      octx.fill();
      octx.restore();
    }
    // fine diamond strut mesh (two phases), thin lines
    const cells = isGraft ? 16 : 20;
    octx.strokeStyle = `rgba(${dev},${dA * 0.7})`;
    octx.lineWidth = isGraft ? 1 : 0.8;
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
    const splines = new Map<string, Spline>();
    input.segments.forEach((s) => splines.set(s.id, makeSpline(s, input.projection)));

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

    if (cfg.silhouettes) drawSilhouettes(ctx, TUNING.fluoroSoftTissueStrength);

    // 2. Paint the whole vascular + device scene into one density buffer.
    const scene = sceneCanvas();
    const octx = scene && scene.getContext('2d');
    if (scene && octx) {
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.clearRect(0, 0, ANGIO_WORKSPACE_WIDTH, ANGIO_WORKSPACE_HEIGHT);
      paintJunctions(octx, input, splines, cfg);
      input.segments.forEach((s) => {
        const sp = splines.get(s.id);
        if (sp) paintSegment(octx, s, sp, cfg);
      });
      input.proceduralObjects.forEach((object) => {
        const seg = input.segments.find((s) => s.id === object.segmentId);
        const sp = seg && splines.get(seg.id);
        if (seg && sp) paintDevice(octx, object, seg, sp, cfg);
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
      withFilter(ctx, `blur(${TUNING.motionSoftness}px)`, () => ctx.drawImage(scene, 0, 0));
      ctx.restore();
    }

    // 4. Selection highlight (follows the curved centerline).
    if (input.selectedId) {
      const seg = input.segments.find((s) => s.id === input.selectedId);
      const obj = input.proceduralObjects.find((o) => o.id === input.selectedId);
      ctx.save();
      ctx.strokeStyle = 'rgba(120,200,255,0.7)';
      ctx.lineWidth = 1.8;
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
          const p = splineAt(osp, clamp(obj.t, 0, 1));
          ctx.beginPath();
          ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
          ctx.stroke();
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
