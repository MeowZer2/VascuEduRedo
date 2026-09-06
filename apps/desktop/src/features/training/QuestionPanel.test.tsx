// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewerMeasurement } from '../../components/NrrdViewer';
import type { MeasurementQuestion, VascCase } from '../../types';
import { QuestionPanel, measurementMatchesQuestionContext } from './QuestionPanel';
import { completeAttempt, submitQuestionResponse } from '../../lib/attempts';

vi.mock('../../lib/attempts', () => ({
  submitQuestionResponse: vi.fn(),
  completeAttempt: vi.fn(),
}));

const caseWithQuestion: VascCase = {
  id: 'case-a', categoryId: 'cat', title: 'Case A', diagnosis: 'Dx', difficulty: 'beginner',
  estimatedMinutes: 5, tags: [], patient: { age: 50, sex: 'other', presentation: 'P', history: [] },
  learningObjectives: ['Objective'], volume: { type: 'mock', path: 'sample', description: 'sample' },
  questions: [{ id: 'q1', type: 'multipleChoice', prompt: 'Pick A', explanation: 'Because A', points: 1, hints: ['Think A'], choices: [{ id: 'a', label: 'Choice A' }, { id: 'b', label: 'Choice B' }], correctChoiceId: 'a' }],
};

const callbacks = {
  onComplete: vi.fn(), onQuestionChange: vi.fn(), onJumpToBookmark: vi.fn(),
};

function panel(overrides: Partial<React.ComponentProps<typeof QuestionPanel>> = {}) {
  return <QuestionPanel vascCase={caseWithQuestion} attemptId={null} sessionProfileId="profile-a" expectedMeasurementSourceKey="nrrd:sample" expectedMeasurementVolumeHandleId="handle-a" latestMeasurement={null} bookmarks={[]} {...callbacks} {...overrides} />;
}

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(submitQuestionResponse).mockResolvedValue(undefined);
  vi.mocked(completeAttempt).mockResolvedValue(null);
});

describe('training question durability and state', () => {
  it('is robust when a legacy case has zero questions', () => {
    render(panel({ vascCase: { ...caseWithQuestion, questions: [] } }));
    expect(screen.getByText('No usable questions')).toBeTruthy();
  });

  it('retains answer, hint, and feedback when its mounted panel is hidden and reopened', async () => {
    const { container } = render(<div>{panel()}</div>);
    fireEvent.click(screen.getByLabelText('Choice A'));
    fireEvent.click(screen.getByText('Show hint'));
    fireEvent.click(screen.getByText('Submit answer'));
    await screen.findByText('Correct');
    const host = container.firstElementChild as HTMLElement;
    host.hidden = true;
    host.hidden = false;
    expect(screen.getByText('Hint 1: Think A')).toBeTruthy();
    expect(screen.getByText('Your answer: Choice A')).toBeTruthy();
  });

  it('preserves the answer on write failure, retries idempotently, and pins ownership', async () => {
    vi.mocked(submitQuestionResponse).mockRejectedValueOnce(new Error('disk busy')).mockResolvedValueOnce(undefined);
    render(panel({ attemptId: 'attempt-a' }));
    fireEvent.click(screen.getByLabelText('Choice A'));
    fireEvent.click(screen.getByText('Submit answer'));
    await screen.findByText(/Your answer is still here/);
    expect((screen.getByLabelText('Choice A') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByText('Retry save'));
    await screen.findByText('Correct');
    expect(submitQuestionResponse).toHaveBeenCalledTimes(2);
    expect(submitQuestionResponse).toHaveBeenLastCalledWith('attempt-a', 'q1', 'a', expect.any(Object), 'profile-a', 'case-a');
  });

  it('keeps completion open on failure and allows retry', async () => {
    vi.mocked(completeAttempt).mockRejectedValueOnce(new Error('database unavailable')).mockResolvedValueOnce({ id: 'attempt-a', caseId: 'case-a', startedAt: '', completedAt: '', score: 1 });
    render(panel({ attemptId: 'attempt-a' }));
    fireEvent.click(screen.getByLabelText('Choice A'));
    fireEvent.click(screen.getByText('Submit answer'));
    await screen.findByText('Correct');
    fireEvent.click(screen.getByText('Finish case'));
    await screen.findByText(/Completion was not saved/);
    expect(callbacks.onComplete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Finish case'));
    await waitFor(() => expect(callbacks.onComplete).toHaveBeenCalledTimes(1));
    expect(completeAttempt).toHaveBeenLastCalledWith('attempt-a', 1, 'profile-a', 'case-a');
  });
});

describe('measurement context binding', () => {
  const question: MeasurementQuestion = { id: 'm', type: 'measurement', prompt: 'Measure', explanation: 'x', points: 1, target: 'vessel', plane: 'axial', correctValue: 10, tolerance: 1, unit: 'mm' };
  const measurement: ViewerMeasurement = { id: 'v', sourceKey: 'nrrd:case-a', volumeHandleId: 'handle-a', plane: 'axial', sliceIndex: 4, distanceMm: 10, unit: 'mm' };

  it('accepts only the expected study and plane with committed slice context', () => {
    expect(measurementMatchesQuestionContext(measurement, question, 'nrrd:case-a', 'handle-a')).toBe(true);
    expect(measurementMatchesQuestionContext({ ...measurement, sourceKey: 'nrrd:old-case' }, question, 'nrrd:case-a', 'handle-a')).toBe(false);
    expect(measurementMatchesQuestionContext({ ...measurement, volumeHandleId: 'stale-handle' }, question, 'nrrd:case-a', 'handle-a')).toBe(false);
    expect(measurementMatchesQuestionContext({ ...measurement, plane: 'coronal' }, question, 'nrrd:case-a', 'handle-a')).toBe(false);
    expect(measurementMatchesQuestionContext({ ...measurement, sliceIndex: 4.5 }, question, 'nrrd:case-a', 'handle-a')).toBe(false);
  });
});
