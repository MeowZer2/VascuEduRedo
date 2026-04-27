import { NrrdViewer } from '../../components/NrrdViewer';
import { saveAttempt } from '../../lib/progress';
import type { AttemptResult, VascCase } from '../../types';
import { QuestionPanel } from './QuestionPanel';

interface TrainingWorkspaceProps {
  vascCase: VascCase;
  onFinish: () => void;
  onChooseCase: () => void;
}

export function TrainingWorkspace({ vascCase, onFinish, onChooseCase }: TrainingWorkspaceProps) {
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
        <NrrdViewer volumePath={vascCase.volume.path ?? 'sample'} description={vascCase.volume.description} />
      </section>
      <aside className="training-aside">
        <QuestionPanel vascCase={vascCase} onComplete={handleComplete} />
      </aside>
    </div>
  );
}
