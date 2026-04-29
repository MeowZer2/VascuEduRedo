import { useState } from 'react';
import { NrrdViewer, type ViewerMeasurement } from '../../components/NrrdViewer';
import { saveAttempt } from '../../lib/progress';
import type { AttemptResult, MeasurementQuestion, VascCase } from '../../types';
import { QuestionPanel } from './QuestionPanel';

interface TrainingWorkspaceProps {
  vascCase: VascCase;
  onFinish: () => void;
  onChooseCase: () => void;
}

export function TrainingWorkspace({ vascCase, onFinish, onChooseCase }: TrainingWorkspaceProps) {
  const [latestMeasurement, setLatestMeasurement] = useState<ViewerMeasurement | null>(null);
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);

  const activeQuestion = vascCase.questions[activeQuestionIndex];
  const isMeasurementQuestion = activeQuestion?.type === 'measurement';
  const requestedTool = isMeasurementQuestion ? 'distance' as const : undefined;
  const requiredPlane = isMeasurementQuestion ? (activeQuestion as MeasurementQuestion).plane : undefined;

  function handleComplete(attempt: AttemptResult) {
    saveAttempt(attempt);
    onFinish();
  }

  return (
    <div className="training-layout">
      <section className="training-main">
        <div className="workspace-header">
          <div>
            <p className="eyebrow">Training workspace</p>
            <h2>{vascCase.title}</h2>
          </div>
          <button className="secondary-button" onClick={onChooseCase}>Change case</button>
        </div>
        {isMeasurementQuestion && requiredPlane ? (
          <div className="measurement-question-banner">
            <span className="measurement-question-banner-icon">📏</span>
            <span>
              Switch to the <strong>{requiredPlane.charAt(0).toUpperCase() + requiredPlane.slice(1)}</strong> plane and use
              the <strong>Distance</strong> tool to measure — then submit from the question panel.
            </span>
          </div>
        ) : null}
        <NrrdViewer
          volumePath={vascCase.volume.path ?? 'sample'}
          description={vascCase.volume.description}
          requestedTool={requestedTool}
          onLatestMeasurementChange={setLatestMeasurement}
        />
      </section>
      <aside className="training-aside">
        <QuestionPanel
          vascCase={vascCase}
          latestMeasurement={latestMeasurement}
          onComplete={handleComplete}
          onQuestionChange={setActiveQuestionIndex}
        />
      </aside>
    </div>
  );
}
