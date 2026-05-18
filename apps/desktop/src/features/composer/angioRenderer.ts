// Advanced 2D synthetic angiogram renderer (Canvas 2D).
//
// This paints a believable grayscale DSA / fluoroscopy-style image from the
// existing vessel-composer data model. It is intentionally a pure module: the
// React layer owns interaction; this file only draws pixels. Everything is
// wrapped so a single failure makes the caller fall back to the legacy SVG.

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

/**
 * Project a workspace point. This is a deliberately simple 2D affine model:
 * horizontal compression/spread + a little shear per view. It is NOT claimed
 * to be geometrically exact — it just keeps vessel relationships readable
 * while making LAO/RAO/lateral feel meaningfully different from AP.
 */
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

// Lumen half-width (px) at parameter t, including pathology deformation.
function lumenHalfWidth(segment: VesselSegment, t: number): number {
  const prox = clamp(segment.proximalDiameterMm, 1.5, 30);
  const dist = clamp(segment.distalDiameterMm, 1.2, 30);
  // mm -> px scale tuned so an aorta reads as a fat contrast column.
  const base = (prox + (dist - prox) * t) * 1.55 + 3;
  const lesion = gaussian(t, 0.5, 0.13);
  switch (segment.pathologyType) {
    case 'stenosis': {
      const sev = clamp(segment.severityPercent ?? 65, 10, 95) / 100;
      return Math.max(1.4, (base * (1 - sev * 0.82 * lesion)) / 2);
    }
    case 'aneurysm':
      return (base * (1 + 1.35 * lesion)) / 2;
    case 'thrombus':
      return (base * (1 - 0.22 * lesion)) / 2;
    default:
      return base / 2;
  }
}

interface PresetConfig {
  bg: [string, string, string];
  vessel: string; // rgb without alpha, used as `rgba(r,g,b,A)`
  vesselComposite: GlobalCompositeOperation;
  vesselCoreAlpha: number;
  vesselSoftAlpha: number;
  device: string;
  deviceAlpha: number;
  noise: number;
  roadmapGhost: boolean;
}

function presetConfig(preset: AngioPreset): PresetConfig {
  switch (preset) {
    case 'dsa':
      // Subtracted look: pale field, dark contrast column (multiply).
      return {
        bg: ['#e9ebec', '#d3d6d8', '#b8bcbe'],
        vessel: '24,27,31',
        vesselComposite: 'multiply',
        vesselCoreAlpha: 0.92,
        vesselSoftAlpha: 0.32,
        device: '8,9,11',
        deviceAlpha: 0.96,
        noise: 0.05,
        roadmapGhost: false,
      };
    case 'roadmap':
      return {
        bg: ['#0c1622', '#070d15', '#03070c'],
        vessel: '150,210,225',
        vesselComposite: 'lighter',
        vesselCoreAlpha: 0.7,
        vesselSoftAlpha: 0.26,
        device: '244,248,252',
        deviceAlpha: 1,
        noise: 0.12,
        roadmapGhost: true,
      };
    case 'fluoro':
    default:
      return {
        bg: ['#10151b', '#080c11', '#030507'],
        vessel: '223,230,235',
        vesselComposite: 'lighter',
        vesselCoreAlpha: 0.62,
        vesselSoftAlpha: 0.24,
        device: '247,250,252',
        deviceAlpha: 1,
        noise: 0.16,
        roadmapGhost: false,
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

// Build the contrast ribbon polygon for a segment between t1..t2.
function ribbonPath(
  ctx: CanvasRenderingContext2D,
  segment: VesselSegment,
  projection: AngioProjection,
  t1: number,
  t2: number,
  widthScale: number,
): void {
  const samples = 14;
  const a = projectPoint(segment.start, projection);
  const b = projectPoint(segment.end, projection);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const fwd: Pt[] = [];
  const back: Pt[] = [];
  for (let i = 0; i < samples; i += 1) {
    const local = i / (samples - 1);
    const t = t1 + (t2 - t1) * local;
    const c = lerpPoint(a, b, t);
    const half = lumenHalfWidth(segment, t) * widthScale;
    fwd.push({ x: c.x + nx * half, y: c.y + ny * half });
    back.unshift({ x: c.x - nx * half, y: c.y - ny * half });
  }
  const pts = [...fwd, ...back];
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
}

function drawSegment(
  ctx: CanvasRenderingContext2D,
  segment: VesselSegment,
  projection: AngioProjection,
  cfg: PresetConfig,
): void {
  const a = projectPoint(segment.start, projection);
  const b = projectPoint(segment.end, projection);
  const occluded = segment.pathologyType === 'occlusion';
  const lumenEnd = occluded ? 0.66 : 1;

  // Soft halo pass (blurred, low alpha) → contrast bloom, not cartoon glow.
  withFilter(ctx, 'blur(3.2px)', () => {
    ribbonPath(ctx, segment, projection, 0, lumenEnd, 1.18);
    ctx.fillStyle = `rgba(${cfg.vessel},${cfg.vesselSoftAlpha})`;
    ctx.fill();
  });
  // Mid density pass.
  withFilter(ctx, 'blur(1.1px)', () => {
    ribbonPath(ctx, segment, projection, 0, lumenEnd, 1.0);
    ctx.fillStyle = `rgba(${cfg.vessel},${cfg.vesselCoreAlpha * 0.78})`;
    ctx.fill();
  });
  // Bright lumen core.
  ribbonPath(ctx, segment, projection, 0, lumenEnd, 0.74);
  ctx.fillStyle = `rgba(${cfg.vessel},${cfg.vesselCoreAlpha})`;
  ctx.fill();

  if (occluded) {
    // Abrupt cut-off + faint, poorly opacified distal reconstitution.
    const cut = lerpPoint(a, b, 0.66);
    ctx.strokeStyle = `rgba(${cfg.vessel},${cfg.vesselCoreAlpha})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cut.x - 7, cut.y - 7);
    ctx.lineTo(cut.x + 7, cut.y + 7);
    ctx.stroke();
    withFilter(ctx, 'blur(2.4px)', () => {
      ribbonPath(ctx, segment, projection, 0.74, 1, 0.34);
      ctx.fillStyle = `rgba(${cfg.vessel},${cfg.vesselSoftAlpha * 0.7})`;
      ctx.fill();
    });
  }

  if (segment.pathologyType === 'aneurysm') {
    // Sac-like outpouching rather than a fat straight line.
    const mid = lerpPoint(a, b, 0.5);
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const half = lumenHalfWidth(segment, 0.5);
    ctx.save();
    ctx.translate(mid.x, mid.y);
    ctx.rotate(ang);
    withFilter(ctx, 'blur(2px)', () => {
      ctx.beginPath();
      ctx.ellipse(0, 0, half * 1.5, half * 2.15, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${cfg.vessel},${cfg.vesselCoreAlpha * 0.9})`;
      ctx.fill();
    });
    ctx.restore();
  }

  if (segment.pathologyType === 'thrombus') {
    // Filling defect: locally subtract contrast density.
    const mid = lerpPoint(a, b, 0.52);
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    withFilter(ctx, 'blur(2px)', () => {
      ctx.beginPath();
      ctx.ellipse(mid.x, mid.y, lumenHalfWidth(segment, 0.52) * 0.78, lumenHalfWidth(segment, 0.52) * 1.4, Math.atan2(b.y - a.y, b.x - a.x), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.66)';
      ctx.fill();
    });
    ctx.restore();
  }

  if (segment.pathologyType === 'dissection') {
    // Subtle intimal flap line within the lumen.
    const f1 = lerpPoint(a, b, 0.2);
    const f2 = lerpPoint(a, b, 0.8);
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const offx = (-(b.y - a.y) / len) * lumenHalfWidth(segment, 0.5) * 0.35;
    const offy = ((b.x - a.x) / len) * lumenHalfWidth(segment, 0.5) * 0.35;
    ctx.strokeStyle =
      cfg.vesselComposite === 'multiply'
        ? 'rgba(120,124,128,0.7)'
        : 'rgba(10,14,20,0.55)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(f1.x + offx, f1.y + offy);
    ctx.lineTo(f2.x + offx, f2.y + offy);
    ctx.stroke();
  }
}

function segPoint(segment: VesselSegment, projection: AngioProjection, t: number): Pt {
  return lerpPoint(
    projectPoint(segment.start, projection),
    projectPoint(segment.end, projection),
    clamp(t, 0, 1),
  );
}

function drawDevice(
  ctx: CanvasRenderingContext2D,
  object: ProceduralObject,
  segment: VesselSegment,
  projection: AngioProjection,
  cfg: PresetConfig,
): void {
  const lenFrac = clamp(object.lengthMm / Math.max(segment.lengthMm, 1), 0.04, 0.95);
  const isWire = object.objectType === 'guidewire';
  const t1 = isWire ? 0 : clamp(object.t - lenFrac / 2, 0, 1);
  const t2 = isWire ? object.t : clamp(object.t + lenFrac / 2, 0, 1);
  const p1 = segPoint(segment, projection, t1);
  const p2 = segPoint(segment, projection, t2);
  const mid = segPoint(segment, projection, object.t);
  const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
  const col = `rgba(${cfg.device},${cfg.deviceAlpha})`;

  ctx.save();
  ctx.lineCap = 'round';

  const tick = (p: Pt, size: number) => {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(ang + Math.PI / 2);
    ctx.fillStyle = col;
    ctx.fillRect(-1.4, -size, 2.8, size * 2);
    ctx.restore();
  };

  if (object.objectType === 'guidewire') {
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    // brighter floppy tip
    const tip = segPoint(segment, projection, clamp(t2 - 0.05, 0, 1));
    ctx.lineWidth = 1.9;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(p2.x, p2.y, 2.1, 0, Math.PI * 2);
    ctx.fill();
  } else if (object.objectType === 'catheter') {
    ctx.strokeStyle = col;
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    tick(p2, 4); // tip marker
  } else if (object.objectType === 'sheath') {
    ctx.strokeStyle = col;
    ctx.lineWidth = 5.4;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(lerpPoint(p1, p2, 0.7).x, lerpPoint(p1, p2, 0.7).y);
    ctx.stroke();
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.moveTo(lerpPoint(p1, p2, 0.7).x, lerpPoint(p1, p2, 0.7).y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    // radiopaque hub block near access
    ctx.save();
    ctx.translate(p1.x, p1.y);
    ctx.rotate(ang);
    ctx.fillStyle = col;
    ctx.fillRect(-2, -5, 12, 10);
    ctx.restore();
  } else if (object.objectType === 'balloon') {
    const inflated = object.state === 'deployed';
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    ctx.save();
    ctx.translate(mid.x, mid.y);
    ctx.rotate(ang);
    ctx.fillStyle =
      cfg.vesselComposite === 'multiply'
        ? `rgba(80,84,90,${inflated ? 0.5 : 0.32})`
        : `rgba(210,224,236,${inflated ? 0.42 : 0.26})`;
    ctx.beginPath();
    ctx.ellipse(0, 0, inflated ? 26 : 15, inflated ? 9 : 5.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    tick(segPoint(segment, projection, clamp(object.t - lenFrac * 0.4, 0, 1)), 4.5);
    tick(segPoint(segment, projection, clamp(object.t + lenFrac * 0.4, 0, 1)), 4.5);
  } else if (object.objectType === 'stent' || object.objectType === 'stentGraft') {
    const isGraft = object.objectType === 'stentGraft';
    if (isGraft) {
      // graft tube body
      ctx.save();
      ctx.translate(mid.x, mid.y);
      ctx.rotate(ang);
      const half = Math.hypot(p2.x - p1.x, p2.y - p1.y) / 2;
      const gw = clamp(lumenHalfWidth(segment, object.t) * 1.15, 5, 26);
      ctx.fillStyle =
        cfg.vesselComposite === 'multiply'
          ? 'rgba(70,74,80,0.45)'
          : 'rgba(198,212,226,0.4)';
      ctx.fillRect(-half, -gw, half * 2, gw * 2);
      ctx.restore();
    }
    // metallic strut zig-zag (not a plain bar)
    ctx.strokeStyle = col;
    ctx.lineWidth = isGraft ? 1.6 : 1.4;
    const cells = 9;
    const len = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
    const ux = (p2.x - p1.x) / len;
    const uy = (p2.y - p1.y) / len;
    const nx = -uy;
    const ny = ux;
    const amp = clamp(lumenHalfWidth(segment, object.t) * 0.82, 3, 16);
    ctx.beginPath();
    for (let i = 0; i <= cells; i += 1) {
      const f = i / cells;
      const cpt = lerpPoint(p1, p2, f);
      const s = (i % 2 === 0 ? 1 : -1) * amp;
      const x = cpt.x + nx * s;
      const y = cpt.y + ny * s;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // mirrored strut wall
    ctx.beginPath();
    for (let i = 0; i <= cells; i += 1) {
      const f = i / cells;
      const cpt = lerpPoint(p1, p2, f);
      const s = (i % 2 === 0 ? -1 : 1) * amp;
      const x = cpt.x + nx * s;
      const y = cpt.y + ny * s;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // radiopaque end / mid ring markers
    ctx.fillStyle = col;
    [0, 0.5, 1].forEach((f) => {
      const rp = lerpPoint(p1, p2, f);
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, isGraft ? 2.6 : 2, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  ctx.restore();
}

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

/**
 * Render the full synthetic angiogram. Returns false if anything went wrong
 * (the React layer then falls back to the legacy SVG renderer).
 */
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
    // Map workspace coords -> device pixels.
    ctx.scale(pxW / ANGIO_WORKSPACE_WIDTH, pxH / ANGIO_WORKSPACE_HEIGHT);

    const cfg = presetConfig(input.preset);

    // 1. Background field + vignette.
    const grad = ctx.createRadialGradient(CX, CY * 0.9, 60, CX, CY, ANGIO_WORKSPACE_WIDTH * 0.72);
    grad.addColorStop(0, cfg.bg[0]);
    grad.addColorStop(0.5, cfg.bg[1]);
    grad.addColorStop(1, cfg.bg[2]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, ANGIO_WORKSPACE_WIDTH, ANGIO_WORKSPACE_HEIGHT);

    // 2. Roadmap ghost (faint persistent prior contrast).
    if (cfg.roadmapGhost) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.globalCompositeOperation = 'lighter';
      input.segments.forEach((s) => {
        withFilter(ctx, 'blur(2.6px)', () => {
          ribbonPath(ctx, s, input.projection, 0, 1, 1.05);
          ctx.fillStyle = 'rgba(70,120,140,0.4)';
          ctx.fill();
        });
      });
      ctx.restore();
    }

    // 3. Vessel density + pathology.
    ctx.save();
    ctx.globalCompositeOperation = cfg.vesselComposite;
    input.segments.forEach((s) => drawSegment(ctx, s, input.projection, cfg));
    ctx.restore();

    // 4. Device radiopacity overlay.
    ctx.save();
    input.proceduralObjects.forEach((object) => {
      const seg = input.segments.find((s) => s.id === object.segmentId);
      if (seg) drawDevice(ctx, object, seg, input.projection, cfg);
    });
    // Catalog device placements as small radiopaque blooms.
    input.devicePlacements.forEach((placement) => {
      const seg = input.segments.find((s) => s.id === placement.segmentId);
      if (!seg) return;
      const p = segPoint(seg, input.projection, placement.t);
      ctx.fillStyle = `rgba(${cfg.device},${cfg.deviceAlpha * 0.85})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();

    // 5. Selection highlight (kept here so it survives Canvas compositing).
    if (input.selectedId) {
      const seg = input.segments.find((s) => s.id === input.selectedId);
      const obj = input.proceduralObjects.find((o) => o.id === input.selectedId);
      ctx.save();
      ctx.strokeStyle = 'rgba(120,200,255,0.85)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      if (seg) {
        const a = projectPoint(seg.start, input.projection);
        const b = projectPoint(seg.end, input.projection);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      } else if (obj) {
        const oseg = input.segments.find((s) => s.id === obj.segmentId);
        if (oseg) {
          const p = segPoint(oseg, input.projection, obj.t);
          ctx.beginPath();
          ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // 6. Noise / grain.
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

    // 7. Edge vignette for the image-intensifier feel.
    const vig = ctx.createRadialGradient(CX, CY, ANGIO_WORKSPACE_HEIGHT * 0.32, CX, CY, ANGIO_WORKSPACE_WIDTH * 0.66);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, input.preset === 'dsa' ? 'rgba(40,44,48,0.5)' : 'rgba(0,0,0,0.62)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, ANGIO_WORKSPACE_WIDTH, ANGIO_WORKSPACE_HEIGHT);

    return true;
  } catch {
    return false;
  }
}
