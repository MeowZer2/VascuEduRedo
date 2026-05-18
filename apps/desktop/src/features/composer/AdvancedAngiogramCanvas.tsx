// Advanced 2D angiogram surface.
//
// The synthetic grayscale image is painted to a <canvas> by angioRenderer.ts.
// A transparent SVG sits on top purely for interaction (selection + the
// projection/preset controls) so all existing composer behaviour is preserved.
// If the canvas renderer fails for any reason we render `renderFallback()`
// (the legacy SVG angiogram) instead, so the composer never breaks.
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import type {
  BifurcationNode,
  DevicePlacement,
  ProceduralObject,
  ProceduralStep,
  TreatmentMarker,
  VesselSegment,
} from '../../lib/vesselComposer';
import {
  ANGIO_WORKSPACE_HEIGHT,
  ANGIO_WORKSPACE_WIDTH,
  projectPoint,
  renderAngiogram,
  type AngioPreset,
  type AngioProjection,
} from './angioRenderer';

interface AdvancedAngiogramCanvasProps {
  projection: AngioProjection;
  onProjectionChange: (projection: AngioProjection) => void;
  visualPreset: AngioPreset;
  onVisualPresetChange: (preset: AngioPreset) => void;
  segments: VesselSegment[];
  bifurcations: BifurcationNode[];
  treatmentMarkers: TreatmentMarker[];
  devicePlacements: DevicePlacement[];
  proceduralObjects: ProceduralObject[];
  activeStep: ProceduralStep | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Legacy SVG renderer, used if the advanced canvas pipeline fails. */
  renderFallback: () => ReactNode;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a: { x: number; y: number }, b: { x: number; y: number }, t: number) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function projLabel(p: AngioProjection): string {
  return p === 'lao' ? 'LAO' : p === 'rao' ? 'RAO' : p === 'lateral' ? 'LAT' : 'AP';
}
function presetLabel(p: AngioPreset): string {
  return p === 'fluoro' ? 'Fluoro' : p === 'roadmap' ? 'Roadmap' : 'DSA';
}

export function AdvancedAngiogramCanvas(props: AdvancedAngiogramCanvasProps) {
  const {
    projection,
    onProjectionChange,
    visualPreset,
    onVisualPresetChange,
    segments,
    bifurcations,
    treatmentMarkers,
    devicePlacements,
    proceduralObjects,
    activeStep,
    selectedId,
    onSelect,
    renderFallback,
  } = props;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  // Only re-render the image when something that affects pixels changes.
  const renderKey = useMemo(
    () =>
      JSON.stringify({
        s: segments.map((s) => [s.id, s.start, s.end, s.proximalDiameterMm, s.distalDiameterMm, s.pathologyType, s.severityPercent, s.lengthMm]),
        d: proceduralObjects.map((o) => [o.id, o.objectType, o.segmentId, o.t, o.lengthMm, o.state]),
        p: devicePlacements.map((p) => [p.id, p.segmentId, p.t]),
        proj: projection,
        preset: visualPreset,
        sel: selectedId,
      }),
    [segments, proceduralObjects, devicePlacements, projection, visualPreset, selectedId],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let raf = 0;
    const paint = () => {
      const ok = renderAngiogram(canvas, {
        segments,
        bifurcations,
        devicePlacements,
        proceduralObjects,
        projection,
        preset: visualPreset,
        selectedId,
      });
      setFailed(!ok);
    };
    raf = window.requestAnimationFrame(paint);

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && stageRef.current) {
      observer = new ResizeObserver(() => {
        window.cancelAnimationFrame(raf);
        raf = window.requestAnimationFrame(paint);
      });
      observer.observe(stageRef.current);
    }
    return () => {
      window.cancelAnimationFrame(raf);
      observer?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderKey]);

  if (failed) {
    return <>{renderFallback()}</>;
  }

  const sel = selectedId
    ? segments.find((s) => s.id === selectedId) ??
      proceduralObjects.find((o) => o.id === selectedId) ??
      treatmentMarkers.find((m) => m.id === selectedId) ??
      devicePlacements.find((d) => d.id === selectedId) ??
      null
    : null;

  return (
    <div ref={stageRef} className={`angio-stage angio-preset-${visualPreset}`}>
      <canvas ref={canvasRef} className="angio-advanced-canvas" aria-hidden="true" />
      <svg
        className="angio-overlay-svg"
        viewBox={`0 0 ${ANGIO_WORKSPACE_WIDTH} ${ANGIO_WORKSPACE_HEIGHT}`}
        role="img"
        aria-label={`${projLabel(projection)} synthetic procedural angiogram`}
        onPointerDown={() => onSelect(null)}
      >
        <rect
          className="angio-deselect"
          x="0"
          y="0"
          width={ANGIO_WORKSPACE_WIDTH}
          height={ANGIO_WORKSPACE_HEIGHT}
        />
        <text className="angiogram-projection-label" x="24" y="36">
          {projLabel(projection)}
        </text>
        <text className="angiogram-step-label" x="24" y="60">
          {activeStep?.label ?? 'Angiogram'}
        </text>

        <foreignObject x="664" y="18" width="314" height="78">
          <div className="angiogram-control-stack">
            <div className="angiogram-projection-tabs">
              {(['ap', 'lao', 'rao', 'lateral'] as AngioProjection[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={projection === item ? 'active' : ''}
                  onClick={() => onProjectionChange(item)}
                >
                  {projLabel(item)}
                </button>
              ))}
            </div>
            <div className="angiogram-projection-tabs angiogram-preset-tabs">
              {(['dsa', 'fluoro', 'roadmap'] as AngioPreset[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={visualPreset === item ? 'active' : ''}
                  onClick={() => onVisualPresetChange(item)}
                >
                  {presetLabel(item)}
                </button>
              ))}
            </div>
          </div>
        </foreignObject>

        {/* Transparent interaction hit targets (image is on the canvas). */}
        <g className="angio-hit-layer">
          {segments.map((segment) => {
            const a = projectPoint(segment.start, projection);
            const b = projectPoint(segment.end, projection);
            const w = clamp((segment.proximalDiameterMm + segment.distalDiameterMm) / 2, 4, 28);
            return (
              <line
                key={segment.id}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                strokeWidth={Math.max(w + 16, 26)}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  onSelect(segment.id);
                }}
              />
            );
          })}

          {proceduralObjects.map((object) => {
            const seg = segments.find((s) => s.id === object.segmentId);
            if (!seg) return null;
            const a = projectPoint(seg.start, projection);
            const b = projectPoint(seg.end, projection);
            const lenFrac = clamp(object.lengthMm / Math.max(seg.lengthMm, 1), 0.04, 0.95);
            const isWire = object.objectType === 'guidewire';
            const p1 = lerp(a, b, isWire ? 0 : clamp(object.t - lenFrac / 2, 0, 1));
            const p2 = lerp(a, b, isWire ? object.t : clamp(object.t + lenFrac / 2, 0, 1));
            return (
              <line
                key={object.id}
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                strokeWidth={22}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  onSelect(object.id);
                }}
              />
            );
          })}

          {treatmentMarkers.map((marker) => {
            const seg = segments.find((s) => s.id === marker.segmentId);
            if (!seg) return null;
            const p = lerp(
              projectPoint(seg.start, projection),
              projectPoint(seg.end, projection),
              clamp(marker.t, 0, 1),
            );
            return (
              <circle
                key={marker.id}
                cx={p.x}
                cy={p.y}
                r={14}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  onSelect(marker.id);
                }}
              />
            );
          })}

          {devicePlacements.map((placement) => {
            const seg = segments.find((s) => s.id === placement.segmentId);
            if (!seg) return null;
            const p = lerp(
              projectPoint(seg.start, projection),
              projectPoint(seg.end, projection),
              clamp(placement.t, 0, 1),
            );
            return (
              <circle
                key={placement.id}
                cx={p.x}
                cy={p.y}
                r={13}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  onSelect(placement.id);
                }}
              />
            );
          })}
        </g>

        {sel ? <SelectedLabel sel={sel} segments={segments} projection={projection} /> : null}

        {segments.length === 0 ? (
          <g className="angiogram-empty">
            <text x={ANGIO_WORKSPACE_WIDTH / 2} y={ANGIO_WORKSPACE_HEIGHT / 2} textAnchor="middle">
              Add vessel anatomy in Planning mode to generate an angiogram view
            </text>
          </g>
        ) : null}
      </svg>
    </div>
  );
}

function SelectedLabel({
  sel,
  segments,
  projection,
}: {
  sel: VesselSegment | ProceduralObject | TreatmentMarker | DevicePlacement;
  segments: VesselSegment[];
  projection: AngioProjection;
}) {
  let anchor = { x: ANGIO_WORKSPACE_WIDTH / 2, y: 40 };
  if ('start' in sel && 'end' in sel) {
    anchor = lerp(projectPoint(sel.start, projection), projectPoint(sel.end, projection), 0.5);
  } else if ('segmentId' in sel) {
    const seg = segments.find((s) => s.id === sel.segmentId);
    if (seg) {
      const t = 't' in sel ? clamp(sel.t as number, 0, 1) : 0.5;
      anchor = lerp(projectPoint(seg.start, projection), projectPoint(seg.end, projection), t);
    }
  }
  return (
    <text className="angiogram-segment-label" x={anchor.x + 12} y={anchor.y - 12}>
      {sel.label}
    </text>
  );
}
