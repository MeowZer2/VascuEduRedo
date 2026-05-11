import type { ProceduralObject, VesselCompositionRow, VesselSegment } from '../lib/vesselComposer';

interface ProceduralPlanViewerProps {
  plan: VesselCompositionRow;
  activeStepId: string;
  selectedObjectId?: string | null;
  compact?: boolean;
  onStepChange?: (stepId: string) => void;
}

const WIDTH = 1000;
const HEIGHT = 620;

export function ProceduralPlanViewer({
  plan,
  activeStepId,
  selectedObjectId,
  compact = false,
  onStepChange,
}: ProceduralPlanViewerProps) {
  const steps = plan.data.proceduralSteps.slice().sort((a, b) => a.orderIndex - b.orderIndex);
  const activeStep = steps.find((step) => step.id === activeStepId) ?? steps[0] ?? null;
  const objects = plan.data.proceduralObjects.filter(
    (object) => !activeStep || !object.stepId || object.stepId === activeStep.id,
  );

  return (
    <div className={compact ? 'procedure-viewer compact' : 'procedure-viewer'}>
      {!compact && (
        <div className="procedure-viewer-steps" aria-label="Procedural steps">
          {steps.map((step) => (
            <button
              key={step.id}
              type="button"
              className={step.id === activeStep?.id ? 'active' : ''}
              onClick={() => onStepChange?.(step.id)}
            >
              {step.label}
            </button>
          ))}
        </div>
      )}
      <svg className="procedure-viewer-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Procedural angiogram context">
        <defs>
          <radialGradient id="learner-angio-bg" cx="50%" cy="42%" r="72%">
            <stop offset="0%" stopColor="#171d24" />
            <stop offset="58%" stopColor="#070a0e" />
            <stop offset="100%" stopColor="#020304" />
          </radialGradient>
        </defs>
        <rect className="procedure-viewer-bg" width={WIDTH} height={HEIGHT} />
        <text className="procedure-viewer-label" x="24" y="36">{activeStep?.label ?? plan.name}</text>
        {plan.data.segments.map((segment) => (
          <LearnerSegment key={segment.id} segment={segment} />
        ))}
        {plan.data.treatmentMarkers
          .filter((marker) => marker.markerType === 'proximalLandingZone' || marker.markerType === 'distalLandingZone' || marker.markerType === 'targetLesion')
          .map((marker) => {
            const segment = plan.data.segments.find((item) => item.id === marker.segmentId);
            if (!segment) return null;
            const point = interpolate(segment, marker.t);
            return <line key={marker.id} className="procedure-viewer-marker" x1={point.x} y1={point.y - 14} x2={point.x} y2={point.y + 14} />;
          })}
        {objects.map((object) => {
          const segment = plan.data.segments.find((item) => item.id === object.segmentId);
          if (!segment) return null;
          return (
            <LearnerObject
              key={object.id}
              object={object}
              segment={segment}
              selected={selectedObjectId === object.id}
            />
          );
        })}
      </svg>
      {!compact && (
        <div className="procedure-viewer-context">
          <strong>{activeStep?.label ?? 'Procedural context'}</strong>
          <span>
            {objects.length === 0
              ? 'No procedural objects assigned to this step.'
              : objects.map((object) => `${object.label} (${object.state})`).join(' / ')}
          </span>
        </div>
      )}
    </div>
  );
}

function LearnerSegment({ segment }: { segment: VesselSegment }) {
  const width = Math.max(4, Math.min(24, (segment.proximalDiameterMm + segment.distalDiameterMm) / 2));
  const mid = interpolate(segment, 0.5);
  return (
    <g className={`procedure-viewer-segment pathology-${segment.pathologyType}`}>
      <line x1={segment.start.x} y1={segment.start.y} x2={segment.end.x} y2={segment.end.y} strokeWidth={width} />
      {segment.pathologyType === 'stenosis' ? (
        <line className="stenosis-core" x1={interpolate(segment, 0.43).x} y1={interpolate(segment, 0.43).y} x2={interpolate(segment, 0.57).x} y2={interpolate(segment, 0.57).y} strokeWidth={Math.max(2, width * 0.35)} />
      ) : null}
      {segment.pathologyType === 'occlusion' ? <circle className="occlusion-dot" cx={interpolate(segment, 0.68).x} cy={interpolate(segment, 0.68).y} r="8" /> : null}
      {segment.pathologyType === 'aneurysm' ? <ellipse className="aneurysm-sac" cx={mid.x} cy={mid.y} rx={width * 1.25} ry={width * 1.8} /> : null}
      {segment.pathologyType !== 'normal' ? <text x={mid.x + 10} y={mid.y - 12}>{segment.pathologyType}</text> : null}
    </g>
  );
}

function LearnerObject({
  object,
  segment,
  selected,
}: {
  object: ProceduralObject;
  segment: VesselSegment;
  selected: boolean;
}) {
  const lengthFraction = Math.max(0.04, Math.min(0.9, object.lengthMm / Math.max(segment.lengthMm, 1)));
  const startT = object.objectType === 'guidewire' ? 0 : Math.max(0, object.t - lengthFraction / 2);
  const endT = object.objectType === 'guidewire' ? object.t : Math.min(1, object.t + lengthFraction / 2);
  const start = interpolate(segment, startT);
  const end = interpolate(segment, endT);
  const center = interpolate(segment, object.t);
  return (
    <g className={`procedure-viewer-object object-${object.objectType} state-${object.state}${selected ? ' selected' : ''}`}>
      <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
      {object.objectType === 'balloon' ? <ellipse cx={center.x} cy={center.y} rx={object.state === 'deployed' ? 22 : 12} ry={object.state === 'deployed' ? 8 : 5} /> : null}
      {(object.objectType === 'stent' || object.objectType === 'stentGraft') ? <rect x={center.x - 22} y={center.y - 6} width="44" height="12" rx="3" /> : null}
      <text x={end.x + 10} y={end.y + 4}>{object.label}</text>
    </g>
  );
}

function interpolate(segment: VesselSegment, t: number) {
  return {
    x: segment.start.x + (segment.end.x - segment.start.x) * t,
    y: segment.start.y + (segment.end.y - segment.start.y) * t,
  };
}
