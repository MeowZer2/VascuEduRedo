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
  computeAngioViewTransform,
  projectAngioPoint,
  renderAngiogram,
  type AngioPreset,
  type AngioProjection,
  type AngioViewTransform,
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

function projectedPoint(
  point: { x: number; y: number },
  projection: AngioProjection,
  view: AngioViewTransform,
) {
  return projectAngioPoint(point, projection, view);
}

function segmentPoint(
  segment: VesselSegment,
  t: number,
  projection: AngioProjection,
  view: AngioViewTransform,
) {
  return lerp(projectedPoint(segment.start, projection, view), projectedPoint(segment.end, projection, view), t);
}

function proceduralHitPoints(
  object: ProceduralObject,
  segments: VesselSegment[],
  projection: AngioProjection,
  view: AngioViewTransform,
) {
  const segment = segments.find((s) => s.id === object.segmentId);
  if (!segment) return [];
  const lengthFraction = clamp(object.lengthMm / Math.max(segment.lengthMm, 1), 0.04, 0.95);
  const startT = object.objectType === 'guidewire' ? 0 : clamp(object.t - lengthFraction / 2, 0, 1);
  const endT = object.objectType === 'guidewire' ? object.t : clamp(object.t + lengthFraction / 2, 0, 1);

  if (object.objectType === 'guidewire' || object.objectType === 'catheter' || object.objectType === 'sheath') {
    const ids = object.pathSegmentIds.length > 0 ? object.pathSegmentIds : [object.segmentId];
    const currentIndex = ids.indexOf(object.segmentId);
    if (currentIndex >= 0) {
      const points: Array<{ x: number; y: number }> = [];
      ids.slice(0, currentIndex + 1).forEach((id) => {
        const pathSegment = segments.find((s) => s.id === id);
        if (!pathSegment) return;
        if (points.length === 0) points.push(segmentPoint(pathSegment, 0, projection, view));
        points.push(segmentPoint(pathSegment, id === object.segmentId ? endT : 1, projection, view));
      });
      if (points.length >= 2) return points;
    }
  }

  return [
    segmentPoint(segment, startT, projection, view),
    segmentPoint(segment, endT, projection, view),
  ];
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
  const viewTransform = useMemo(
    () => computeAngioViewTransform({ segments, projection }),
    [segments, projection],
  );

  // Only re-render the image when something that affects pixels changes.
  const renderKey = useMemo(
    () =>
      JSON.stringify({
        s: segments.map((s) => [s.id, s.start, s.end, s.proximalDiameterMm, s.distalDiameterMm, s.pathologyType, s.severityPercent, s.lengthMm]),
        v: segments.map((s) => [s.id, s.label, s.vesselType, s.notes]),
        b: bifurcations.map((b) => [b.id, b.position, b.parentSegmentId, b.childSegmentIds]),
        d: proceduralObjects.map((o) => [o.id, o.objectType, o.segmentId, o.t, o.lengthMm, o.state, o.pathSegmentIds, o.branchSegmentId]),
        p: devicePlacements.map((p) => [p.id, p.segmentId, p.t]),
        proj: projection,
        preset: visualPreset,
        sel: selectedId,
      }),
    [segments, bifurcations, proceduralObjects, devicePlacements, projection, visualPreset, selectedId],
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
            const a = projectedPoint(segment.start, projection, viewTransform);
            const b = projectedPoint(segment.end, projection, viewTransform);
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
            const points = proceduralHitPoints(object, segments, projection, viewTransform);
            if (points.length < 2) return null;
            return (
              <polyline
                key={object.id}
                points={points.map((p) => `${p.x},${p.y}`).join(' ')}
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
            const p = segmentPoint(seg, clamp(marker.t, 0, 1), projection, viewTransform);
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
            const p = segmentPoint(seg, clamp(placement.t, 0, 1), projection, viewTransform);
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

        {sel ? <SelectedLabel sel={sel} segments={segments} projection={projection} viewTransform={viewTransform} /> : null}

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
  viewTransform,
}: {
  sel: VesselSegment | ProceduralObject | TreatmentMarker | DevicePlacement;
  segments: VesselSegment[];
  projection: AngioProjection;
  viewTransform: AngioViewTransform;
}) {
  let anchor = { x: ANGIO_WORKSPACE_WIDTH / 2, y: 40 };
  if ('start' in sel && 'end' in sel) {
    anchor = lerp(
      projectedPoint(sel.start, projection, viewTransform),
      projectedPoint(sel.end, projection, viewTransform),
      0.5,
    );
  } else if ('segmentId' in sel) {
    const seg = segments.find((s) => s.id === sel.segmentId);
    if (seg) {
      const t = 't' in sel ? clamp(sel.t as number, 0, 1) : 0.5;
      anchor = segmentPoint(seg, t, projection, viewTransform);
    }
  }
  return (
    <text className="angiogram-segment-label" x={anchor.x + 12} y={anchor.y - 12}>
      {sel.label}
    </text>
  );
}
