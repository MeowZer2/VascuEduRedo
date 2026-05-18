// Advanced 2D synthetic angiogram renderer (Canvas 2D).
//
// Paints a believable grayscale DSA / fluoroscopy image from the existing
// vessel-composer data model. Pure module: the React layer owns interaction;
// this only draws pixels and is wrapped so any failure makes the caller fall
// back to the legacy SVG renderer.
//
// v0.38: curved spline centerlines, seeded irregular lumen borders, smooth
// bifurcation pooling, contour-deforming pathology, proximal→distal contrast
// falloff, spline-following hardware, and tuned DSA/Fluoro/Roadmap presets.
// Public API (projectPoint / renderAngiogram / types / workspace consts) is
// unchanged so the surrounding component and fallback architecture stay intact.

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

function lerpPoint(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function gaussian(t: number, center: number, sigma: number): number {
  return Math.exp(-Math.pow((t - center) / sigma, 2));
}

// --- deterministic noise (stable between renders, keyed by segment id) -----

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

// Smooth 1D value noise in [-0.5, 0.5], deterministic for (seed, x).
function valueNoise(seed: number, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = hash01(seed * 374761 + i * 668265263);
  const b = hash01(seed * 374761 + (i + 1) * 668265263);
  return (a + (b - a) * smoothstep(f)) - 0.5;
}

// --- curved centerline (quadratic bezier + subtle wobble) ------------------

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
  if (v.includes('aorta')) return 0.35; // great vessels run fairly straight
  if (v.includes('iliac')) return 0.7;
  if (v.includes('femoral') || v.includes('popliteal')) return 0.8;
  return 1; // branches curve the most
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
  // Gentle anatomical bow, proportional to length and vessel type.
  const bow = sign * len * 0.05 * vesselBow(segment.vesselType) * (0.55 + hash01(seed * 7));
  const c = { x: (a.x + b.x) / 2 + nx * bow, y: (a.y + b.y) / 2 + ny * bow };
  return { a, c, b, nx, ny, len, seed };
}

function splineAt(sp: Spline, t: number): Pt {
  const u = 1 - t;
  const bx = u * u * sp.a.x + 2 * u * t * sp.c.x + t * t * sp.b.x;
  const by = u * u * sp.a.y + 2 * u * t * sp.c.y + t * t * sp.b.y;
  // Low-frequency centerline wobble — keeps it from looking machined.
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

// --- lumen profile (pathology-deformed, contour-level) ---------------------

function aneurysmExtra(segment: VesselSegment, t: number): number {
  if (segment.pathologyType !== 'aneurysm') return 0;
  const prox = clamp(segment.proximalDiameterMm, 1.5, 30);
  const dist = clamp(segment.distalDiameterMm, 1.2, 30);
  const base = (prox + (dist - prox) * t) * 1.55 + 3;
  // Wider sigma → fusiform dilatation that flows into the vessel.
  return base * 1.05 * gaussian(t, 0.5, 0.2);
}

function isSaccular(segment: VesselSegment): boolean {
  const meta = segment.metadata as Record<string, unknown> | undefined;
  const shape = typeof meta?.aneurysmShape === 'string' ? (meta.aneurysmShape as string) : '';
  const text = `${shape} ${segment.notes ?? ''} ${segment.label ?? ''}`.toLowerCase();
  return text.includes('saccular');
}

// Symmetric base half-width (px) WITHOUT the aneurysm bulge (that is routed
// per-side so saccular can be asymmetric).
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
        // Mild post-stenotic irregularity just distal to the lesion.
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

// Per-side offset including edge irregularity + aneurysm routing.
function sideHalf(segment: VesselSegment, sp: Spline, t: number, side: 1 | -1): number {
  const h = baseHalf(segment, t);
  // Two octaves of low-frequency, deterministic border waviness.
  const n =
    valueNoise(sp.seed + (side === 1 ? 7 : 23), t * 5) * 0.13 +
    valueNoise(sp.seed + (side === 1 ? 53 : 71), t * 1.6) * 0.08;
  let half = h * (1 + n);
  const bulge = aneurysmExtra(segment, t);
  if (bulge > 0) {
    if (isSaccular(segment)) {
      // Asymmetric out-pouching to one wall.
      half += side === 1 ? bulge * 1.05 : bulge * 0.12;
    } else {
      half += bulge * 0.5; // fusiform: both walls dilate
    }
  }
  return Math.max(1.2, half);
}

// --- preset config ---------------------------------------------------------

interface PresetConfig {
  bg: [string, string, string];
  vessel: string;
  vesselComposite: GlobalCompositeOperation;
  coreAlpha: number;
  softAlpha: number;
  /** distal contrast loss: alpha multiplier at the distal end (0..1). */
  distalFalloff: number;
  softBlur: number;
  device: string;
  deviceAlpha: number;
  noise: number;
  roadmapGhost: boolean;
  silhouettes: boolean;
}

function presetConfig(preset: AngioPreset): PresetConfig {
  switch (preset) {
    case 'dsa':
      // Subtracted: clean pale field, dark contrast column, minimal bloom.
      return {
        bg: ['#eceeef', '#dadddf', '#c4c8ca'],
        vessel: '26,29,33',
        vesselComposite: 'multiply',
        coreAlpha: 0.95,
        softAlpha: 0.2,
        distalFalloff: 0.78,
        softBlur: 1.8,
        device: '10,11,13',
        deviceAlpha: 0.97,
        noise: 0.035,
        roadmapGhost: false,
        silhouettes: false,
      };
    case 'roadmap':
      // Persistent muted overlay, restrained cyan (no neon).
      return {
        bg: ['#0d1620', '#080f17', '#03070c'],
        vessel: '120,170,184',
        vesselComposite: 'lighter',
        coreAlpha: 0.5,
        softAlpha: 0.16,
        distalFalloff: 0.82,
        softBlur: 2.2,
        device: '226,236,242',
        deviceAlpha: 0.95,
        noise: 0.1,
        roadmapGhost: true,
        silhouettes: false,
      };
    case 'fluoro':
    default:
      // Darker, noisier, weaker vessel contrast, visible hardware + tissue.
      return {
        bg: ['#11161c', '#0a0e13', '#040608'],
        vessel: '205,213,219',
        vesselComposite: 'lighter',
        coreAlpha: 0.46,
        softAlpha: 0.16,
        distalFalloff: 0.7,
        softBlur: 2.4,
        device: '244,248,251',
        deviceAlpha: 1,
        noise: 0.17,
        roadmapGhost: false,
        silhouettes: true,
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

// --- vessel ribbon ---------------------------------------------------------

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

function falloffGradient(
  ctx: CanvasRenderingContext2D,
  sp: Spline,
  rgb: string,
  alpha: number,
  distalFalloff: number,
): CanvasGradient {
  const g = ctx.createLinearGradient(sp.a.x, sp.a.y, sp.b.x, sp.b.y);
  g.addColorStop(0, `rgba(${rgb},${alpha})`);
  g.addColorStop(0.55, `rgba(${rgb},${alpha * (0.92 + 0.08 * distalFalloff)})`);
  g.addColorStop(1, `rgba(${rgb},${alpha * distalFalloff})`);
  return g;
}

function drawSegment(
  ctx: CanvasRenderingContext2D,
  segment: VesselSegment,
  sp: Spline,
  cfg: PresetConfig,
): void {
  const occluded = segment.pathologyType === 'occlusion';
  const lumenEnd = occluded ? 0.62 : 1;

  // Soft contrast halo — single restrained pass (no cartoon glow).
  withFilter(ctx, `blur(${cfg.softBlur}px)`, () => {
    ribbonPath(ctx, segment, sp, 0, lumenEnd, 1.12);
    ctx.fillStyle = `rgba(${cfg.vessel},${cfg.softAlpha})`;
    ctx.fill();
  });
  // Mid density.
  withFilter(ctx, 'blur(0.9px)', () => {
    ribbonPath(ctx, segment, sp, 0, lumenEnd, 0.98);
    ctx.fillStyle = falloffGradient(ctx, sp, cfg.vessel, cfg.coreAlpha * 0.7, cfg.distalFalloff);
    ctx.fill();
  });
  // Bright lumen core with proximal→distal contrast falloff.
  ribbonPath(ctx, segment, sp, 0, lumenEnd, 0.78);
  ctx.fillStyle = falloffGradient(ctx, sp, cfg.vessel, cfg.coreAlpha, cfg.distalFalloff);
  ctx.fill();

  if (occluded) {
    const cut = splineAt(sp, lumenEnd);
    const nrm = splineNormal(sp, lumenEnd);
    const h = sideHalf(segment, sp, lumenEnd, 1) * 0.9;
    ctx.strokeStyle = `rgba(${cfg.vessel},${cfg.coreAlpha})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cut.x + nrm.x * h, cut.y + nrm.y * h);
    ctx.lineTo(cut.x - nrm.x * h, cut.y - nrm.y * h);
    ctx.stroke();
    // Very faint distal ghost only (no full-bright distal vessel).
    withFilter(ctx, 'blur(3px)', () => {
      ribbonPath(ctx, segment, sp, 0.78, 1, 0.42);
      ctx.fillStyle = `rgba(${cfg.vessel},${cfg.softAlpha * 0.45})`;
      ctx.fill();
    });
  }

  if (segment.pathologyType === 'thrombus') {
    // Soft-edged filling defect that subtracts contrast inside the lumen.
    const m = splineAt(sp, 0.52);
    const nrm = splineNormal(sp, 0.52);
    const ang = Math.atan2(nrm.x, -nrm.y);
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    withFilter(ctx, 'blur(3px)', () => {
      ctx.beginPath();
      ctx.ellipse(
        m.x,
        m.y,
        baseHalf(segment, 0.52) * 0.62,
        baseHalf(segment, 0.52) * 1.5,
        ang,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fill();
    });
    ctx.restore();
  }

  if (segment.pathologyType === 'dissection') {
    // Subtle intimal flap curving within the lumen + a faint false lumen.
    ctx.save();
    ctx.strokeStyle =
      cfg.vesselComposite === 'multiply' ? 'rgba(110,114,120,0.65)' : 'rgba(8,12,18,0.5)';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    for (let i = 0; i <= 22; i += 1) {
      const t = 0.16 + (0.68 * i) / 22;
      const c = splineAt(sp, t);
      const nrm = splineNormal(sp, t);
      const off = baseHalf(segment, t) * 0.42 * Math.sin(t * Math.PI);
      const x = c.x + nrm.x * off;
      const y = c.y + nrm.y * off;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }
}

// --- bifurcation pooling ---------------------------------------------------

function drawJunctions(
  ctx: CanvasRenderingContext2D,
  input: AngioRenderInput,
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
      ) * 1.55;
    // Soft contrast pooling so the Y-junction blends instead of looking boxy.
    withFilter(ctx, 'blur(2.4px)', () => {
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      g.addColorStop(0, `rgba(${cfg.vessel},${cfg.coreAlpha * 0.85})`);
      g.addColorStop(0.7, `rgba(${cfg.vessel},${cfg.coreAlpha * 0.45})`);
      g.addColorStop(1, `rgba(${cfg.vessel},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    });
  });
}

// --- fluoro soft-tissue / bone silhouettes ---------------------------------

function drawSilhouettes(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  withFilter(ctx, 'blur(7px)', () => {
    // Faint spinal column down the midline.
    ctx.fillStyle = 'rgba(150,156,166,0.05)';
    ctx.fillRect(CX - 26, 40, 52, ANGIO_WORKSPACE_HEIGHT - 80);
    // Faint pelvic wings low in the field.
    ctx.fillStyle = 'rgba(150,156,166,0.045)';
    ctx.beginPath();
    ctx.ellipse(CX - 150, ANGIO_WORKSPACE_HEIGHT - 120, 130, 95, 0.3, 0, Math.PI * 2);
    ctx.ellipse(CX + 150, ANGIO_WORKSPACE_HEIGHT - 120, 130, 95, -0.3, 0, Math.PI * 2);
    ctx.fill();
    // Soft thoracic / abdominal tissue gradient block.
    ctx.fillStyle = 'rgba(120,126,134,0.03)';
    ctx.beginPath();
    ctx.ellipse(CX, CY - 30, 320, 230, 0, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

// --- devices (follow the curved spline) ------------------------------------

function drawDevice(
  ctx: CanvasRenderingContext2D,
  object: ProceduralObject,
  segment: VesselSegment,
  sp: Spline,
  cfg: PresetConfig,
): void {
  const lenFrac = clamp(object.lengthMm / Math.max(segment.lengthMm, 1), 0.04, 0.95);
  const isWire = object.objectType === 'guidewire';
  const t1 = isWire ? 0 : clamp(object.t - lenFrac / 2, 0, 1);
  const t2 = isWire ? object.t : clamp(object.t + lenFrac / 2, 0, 1);

  const path = (steps: number): Pt[] => {
    const out: Pt[] = [];
    for (let i = 0; i <= steps; i += 1) out.push(splineAt(sp, t1 + (t2 - t1) * (i / steps)));
    return out;
  };
  const stroke = (pts: Pt[], width: number, alpha = cfg.deviceAlpha) => {
    ctx.strokeStyle = `rgba(${cfg.device},${alpha})`;
    ctx.lineWidth = width;
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
  };
  const markerBand = (t: number, size: number) => {
    const c = splineAt(sp, clamp(t, 0, 1));
    const nrm = splineNormal(sp, clamp(t, 0, 1));
    ctx.strokeStyle = `rgba(${cfg.device},1)`;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(c.x + nrm.x * size, c.y + nrm.y * size);
    ctx.lineTo(c.x - nrm.x * size, c.y - nrm.y * size);
    ctx.stroke();
  };

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (object.objectType === 'guidewire') {
    stroke(path(26), 1.2);
    stroke([splineAt(sp, clamp(t2 - 0.05, 0, 1)), splineAt(sp, t2)], 1.8);
    const tip = splineAt(sp, t2);
    ctx.fillStyle = `rgba(${cfg.device},1)`;
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 1.9, 0, Math.PI * 2);
    ctx.fill();
  } else if (object.objectType === 'catheter') {
    stroke(path(24), 3, cfg.deviceAlpha * 0.9);
    markerBand(t2, 4);
  } else if (object.objectType === 'sheath') {
    stroke(path(20), 5.2, cfg.deviceAlpha * 0.85);
    stroke([splineAt(sp, (t1 + t2) / 2), splineAt(sp, t2)], 3.2, cfg.deviceAlpha * 0.9);
    const hub = splineAt(sp, t1);
    const nrm = splineNormal(sp, t1);
    ctx.save();
    ctx.translate(hub.x, hub.y);
    ctx.rotate(Math.atan2(-nrm.x, nrm.y));
    ctx.fillStyle = `rgba(${cfg.device},${cfg.deviceAlpha})`;
    ctx.fillRect(-2, -5, 11, 10);
    ctx.restore();
  } else if (object.objectType === 'balloon') {
    const inflated = object.state === 'deployed';
    stroke(path(20), 1.3, cfg.deviceAlpha * 0.85);
    const m = splineAt(sp, object.t);
    const nrm = splineNormal(sp, object.t);
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate(Math.atan2(nrm.y, nrm.x) + Math.PI / 2);
    ctx.fillStyle =
      cfg.vesselComposite === 'multiply'
        ? `rgba(70,74,82,${inflated ? 0.4 : 0.24})`
        : `rgba(206,222,236,${inflated ? 0.34 : 0.2})`;
    ctx.beginPath();
    ctx.ellipse(0, 0, inflated ? 24 : 13, inflated ? 8 : 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    markerBand(object.t - lenFrac * 0.4, 4.5);
    markerBand(object.t + lenFrac * 0.4, 4.5);
  } else if (object.objectType === 'stent' || object.objectType === 'stentGraft') {
    const isGraft = object.objectType === 'stentGraft';
    if (isGraft) {
      // Translucent graft body sitting within the vessel (not pasted on top).
      ctx.save();
      ctx.globalAlpha = cfg.vesselComposite === 'multiply' ? 0.42 : 0.34;
      ribbonPath(ctx, segment, sp, t1, t2, 0.92);
      ctx.fillStyle =
        cfg.vesselComposite === 'multiply' ? 'rgba(64,68,76,1)' : 'rgba(196,210,224,1)';
      ctx.fill();
      ctx.restore();
    }
    // Metallic strut zig-zag along the curved path.
    const cells = 11;
    ctx.strokeStyle = `rgba(${cfg.device},${cfg.deviceAlpha * 0.92})`;
    ctx.lineWidth = isGraft ? 1.5 : 1.3;
    for (const dir of [1, -1]) {
      ctx.beginPath();
      for (let i = 0; i <= cells; i += 1) {
        const t = t1 + (t2 - t1) * (i / cells);
        const c = splineAt(sp, t);
        const nrm = splineNormal(sp, t);
        const amp = clamp(baseHalf(segment, t) * 0.8, 3, 16) * (i % 2 === 0 ? dir : -dir);
        const x = c.x + nrm.x * amp;
        const y = c.y + nrm.y * amp;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    markerBand(t1, clamp(baseHalf(segment, t1) * 0.9, 4, 16));
    markerBand((t1 + t2) / 2, clamp(baseHalf(segment, (t1 + t2) / 2) * 0.5, 3, 10));
    markerBand(t2, clamp(baseHalf(segment, t2) * 0.9, 4, 16));
  }
  ctx.restore();
}

// --- film grain (cached texture) ------------------------------------------

let noisePattern: { canvas: HTMLCanvasElement; key: string } | null = null;

function noiseCanvas(amount: number): HTMLCanvasElement | null {
  const key = amount.toFixed(3);
  if (noisePattern && noisePattern.key === key) return noisePattern.canvas;
  const size = 220;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const nctx = c.getContext('2d');
  if (!nctx) return null;
  const img = nctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 128 + (Math.random() - 0.5) * 255;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = Math.random() * 255 * amount;
  }
  nctx.putImageData(img, 0, 0);
  noisePattern = { canvas: c, key };
  return c;
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

    // 1. Background field.
    const grad = ctx.createRadialGradient(CX, CY * 0.9, 60, CX, CY, ANGIO_WORKSPACE_WIDTH * 0.72);
    grad.addColorStop(0, cfg.bg[0]);
    grad.addColorStop(0.5, cfg.bg[1]);
    grad.addColorStop(1, cfg.bg[2]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, ANGIO_WORKSPACE_WIDTH, ANGIO_WORKSPACE_HEIGHT);

    // 2. Fluoro soft-tissue / bone silhouettes (kept faint).
    if (cfg.silhouettes) drawSilhouettes(ctx);

    // 3. Roadmap ghost (faint persistent prior contrast).
    if (cfg.roadmapGhost) {
      ctx.save();
      ctx.globalAlpha = 0.42;
      ctx.globalCompositeOperation = 'lighter';
      input.segments.forEach((s) => {
        const sp = splines.get(s.id);
        if (!sp) return;
        withFilter(ctx, 'blur(2.6px)', () => {
          ribbonPath(ctx, s, sp, 0, 1, 1.05);
          ctx.fillStyle = 'rgba(70,108,122,0.34)';
          ctx.fill();
        });
      });
      ctx.restore();
    }

    // 4. Vessels + junction pooling + pathology.
    ctx.save();
    ctx.globalCompositeOperation = cfg.vesselComposite;
    drawJunctions(ctx, input, cfg);
    input.segments.forEach((s) => {
      const sp = splines.get(s.id);
      if (sp) drawSegment(ctx, s, sp, cfg);
    });
    ctx.restore();

    // 5. Device radiopacity overlay.
    ctx.save();
    input.proceduralObjects.forEach((object) => {
      const seg = input.segments.find((s) => s.id === object.segmentId);
      const sp = seg && splines.get(seg.id);
      if (seg && sp) drawDevice(ctx, object, seg, sp, cfg);
    });
    input.devicePlacements.forEach((placement) => {
      const seg = input.segments.find((s) => s.id === placement.segmentId);
      const sp = seg && splines.get(seg.id);
      if (!seg || !sp) return;
      const p = splineAt(sp, clamp(placement.t, 0, 1));
      ctx.fillStyle = `rgba(${cfg.device},${cfg.deviceAlpha * 0.8})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();

    // 6. Selection highlight (follows the curved centerline).
    if (input.selectedId) {
      const seg = input.segments.find((s) => s.id === input.selectedId);
      const obj = input.proceduralObjects.find((o) => o.id === input.selectedId);
      ctx.save();
      ctx.strokeStyle = 'rgba(120,200,255,0.85)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      if (seg && splines.get(seg.id)) {
        const sp = splines.get(seg.id) as Spline;
        ctx.beginPath();
        for (let i = 0; i <= 24; i += 1) {
          const p = splineAt(sp, i / 24);
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      } else if (obj) {
        const oseg = input.segments.find((s) => s.id === obj.segmentId);
        const sp = oseg && splines.get(oseg.id);
        if (sp) {
          const p = splineAt(sp, clamp(obj.t, 0, 1));
          ctx.beginPath();
          ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // 7. Film grain.
    const nz = noiseCanvas(cfg.noise);
    if (nz) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      const pat = ctx.createPattern(nz, 'repeat');
      if (pat) {
        ctx.fillStyle = pat;
        ctx.fillRect(0, 0, ANGIO_WORKSPACE_WIDTH, ANGIO_WORKSPACE_HEIGHT);
      }
      ctx.restore();
    }

    // 8. Edge vignette (image-intensifier feel).
    const vig = ctx.createRadialGradient(
      CX,
      CY,
      ANGIO_WORKSPACE_HEIGHT * 0.32,
      CX,
      CY,
      ANGIO_WORKSPACE_WIDTH * 0.66,
    );
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, input.preset === 'dsa' ? 'rgba(40,44,48,0.46)' : 'rgba(0,0,0,0.6)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, ANGIO_WORKSPACE_WIDTH, ANGIO_WORKSPACE_HEIGHT);

    return true;
  } catch {
    return false;
  }
}
