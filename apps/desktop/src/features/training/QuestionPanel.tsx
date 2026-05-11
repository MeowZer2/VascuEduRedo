import { useEffect, useMemo, useState } from 'react';
import type { ViewerMeasurement } from '../../components/NrrdViewer';
import { completeAttempt, submitQuestionResponse } from '../../lib/attempts';
import { listDevices, type Device } from '../../lib/devices';
import { evaluateAnswer, newAttemptId } from '../../lib/quiz';
import type { VesselCompositionRow } from '../../lib/vesselComposer';
import type {
  AttemptResult,
  CaseBookmark,
  DeviceSelectionQuestion,
  MeasurementQuestion,
  Question,
  QuestionResult,
  UserAnswer,
  VascCase,
} from '../../types';

interface QuestionPanelProps {
  vascCase: VascCase;
  /** SQLite attempt id created by `TrainingWorkspace`, or null in browser mode. */
  attemptId: string | null;
  latestMeasurement: ViewerMeasurement | null;
  onComplete: (attempt: AttemptResult) => void;
  onQuestionChange: (index: number) => void;
  bookmarks: CaseBookmark[];
  onJumpToBookmark: (bookmark: CaseBookmark) => void;
  proceduralPlan?: VesselCompositionRow | null;
  activeProceduralStepId?: string;
  onJumpToProceduralStep?: (stepId: string) => void;
}

function defaultAnswer(question: Question): UserAnswer {
  if (question.type === 'multiSelect') return [];
  if (question.type === 'trueFalse') return null;
  if (question.type === 'numeric' || question.type === 'measurement') return null;
  if (question.type === 'deviceSelection') return '';
  return '';
}

export function QuestionPanel({
  vascCase,
  attemptId,
  latestMeasurement,
  onComplete,
  onQuestionChange,
  bookmarks,
  onJumpToBookmark,
  proceduralPlan,
  activeProceduralStepId,
  onJumpToProceduralStep,
}: QuestionPanelProps) {
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState<UserAnswer>(defaultAnswer(vascCase.questions[0]));
  const [hintsUsed, setHintsUsed] = useState<Record<string, number>>({});
  const [results, setResults] = useState<QuestionResult[]>([]);
  const [submittedResult, setSubmittedResult] = useState<QuestionResult | null>(null);
  const [questionStartedAt, setQuestionStartedAt] = useState(() => Date.now());

  const question = vascCase.questions[index];
  const referencedBookmark = question.bookmarkId
    ? bookmarks.find((bookmark) => bookmark.id === question.bookmarkId) ?? null
    : null;
  const referencedProceduralStep = question.proceduralStepId && proceduralPlan
    ? proceduralPlan.data.proceduralSteps.find((step) => step.id === question.proceduralStepId) ?? null
    : null;
  const proceduralStepLabel =
    referencedProceduralStep?.label ?? question.proceduralStepTitle ?? (question.proceduralStepId ? 'Procedural step' : '');
  const shownHints = hintsUsed[question.id] ?? 0;
  const isLast = index === vascCase.questions.length - 1;

  const totalPossible = useMemo(() => vascCase.questions.reduce((sum, item) => sum + item.points, 0), [vascCase.questions]);

  useEffect(() => {
    setQuestionStartedAt(Date.now());
  }, [question.id]);

  useEffect(() => {
    if (!question.proceduralStepId) return;
    onJumpToProceduralStep?.(question.proceduralStepId);
  }, [question.id, question.proceduralStepId, onJumpToProceduralStep]);

  // Device-selection question state: load the (filtered) catalog when the
  // current question is a deviceSelection. Cached in this component so each
  // device-selection question fetches only what it needs.
  const deviceQuestion =
    question.type === 'deviceSelection' ? (question as DeviceSelectionQuestion) : null;
  const [deviceOptions, setDeviceOptions] = useState<Device[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  useEffect(() => {
    if (!deviceQuestion) {
      setDeviceOptions([]);
      return;
    }
    let cancelled = false;
    setDevicesLoading(true);
    listDevices(
      deviceQuestion.allowedCategory ? { category: deviceQuestion.allowedCategory } : undefined,
    )
      .then((devs) => {
        if (cancelled) return;
        // If a whitelist is specified, intersect.
        if (deviceQuestion.allowedDeviceIds && deviceQuestion.allowedDeviceIds.length > 0) {
          const allowed = new Set(deviceQuestion.allowedDeviceIds);
          setDeviceOptions(devs.filter((d) => allowed.has(d.id)));
        } else {
          setDeviceOptions(devs);
        }
      })
      .finally(() => {
        if (!cancelled) setDevicesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [deviceQuestion?.id, deviceQuestion?.allowedCategory]);

  // For measurement questions, determine if the latest viewer measurement is on the right plane.
  const measurementQuestion = question.type === 'measurement' ? (question as MeasurementQuestion) : null;
  const measurementOnCorrectPlane = measurementQuestion && latestMeasurement?.plane === measurementQuestion.plane;
  // Convert mm to the question's unit (currently only mm and cm are expected).
  function convertToUnit(mm: number, unit: string): number {
    if (unit === 'cm') return mm / 10;
    return mm;
  }
  const selectedMeasurementValue =
    measurementQuestion && measurementOnCorrectPlane && latestMeasurement
      ? convertToUnit(latestMeasurement.distanceMm, measurementQuestion.unit)
      : null;

  function revealHint() {
    if (!question.hints || shownHints >= question.hints.length) return;
    setHintsUsed((current) => ({ ...current, [question.id]: shownHints + 1 }));
  }

  function submit() {
    const effectiveAnswer = measurementQuestion ? selectedMeasurementValue : answer;
    const elapsedMs = Math.max(0, Date.now() - questionStartedAt);
    const result = evaluateAnswer(question, effectiveAnswer, shownHints, elapsedMs);
    setSubmittedResult(result);
    // Persist the response in SQLite (no-op in browser mode).
    if (attemptId) {
      void submitQuestionResponse(attemptId, question.id, effectiveAnswer, result);
    }
  }

  async function next() {
    if (!submittedResult) return;
    const updatedResults = [...results, submittedResult];
    setResults(updatedResults);
    setSubmittedResult(null);

    if (isLast) {
      const score = updatedResults.reduce((sum, item) => sum + item.awardedPoints, 0);
      const totalHintsUsed = updatedResults.reduce((sum, item) => sum + item.hintsUsed, 0);
      const totalElapsedMs = updatedResults.reduce((sum, item) => sum + item.elapsedMs, 0);
      const attempt: AttemptResult = {
        id: attemptId ?? newAttemptId(),
        caseId: vascCase.id,
        caseTitle: vascCase.title,
        completedAt: new Date().toISOString(),
        score: Number(score.toFixed(2)),
        maxScore: totalPossible,
        percent: Number(((score / totalPossible) * 100).toFixed(1)),
        correctCount: updatedResults.filter((item) => item.correct).length,
        totalHintsUsed,
        totalElapsedMs,
        questionResults: updatedResults,
      };
      // Mark the SQLite attempt complete with the final score (no-op in browser mode).
      // Await before navigating so the Progress page's first refetch sees the completed row.
      if (attemptId) {
        await completeAttempt(attemptId, attempt.score);
      }
      onComplete(attempt);
      return;
    }

    const nextIndex = index + 1;
    const nextQuestion = vascCase.questions[nextIndex];
    setIndex(nextIndex);
    setAnswer(defaultAnswer(nextQuestion));
    setQuestionStartedAt(Date.now());
    onQuestionChange(nextIndex);
  }

  function renderAnswerInput() {
    switch (question.type) {
      case 'multipleChoice':
        return (
          <div className="choice-stack">
            {question.choices.map((choice) => (
              <label className="choice-option" key={choice.id}>
                <input
                  type="radio"
                  name={question.id}
                  checked={answer === choice.id}
                  onChange={() => setAnswer(choice.id)}
                  disabled={Boolean(submittedResult)}
                />
                <span>{choice.label}</span>
              </label>
            ))}
          </div>
        );
      case 'multiSelect':
        return (
          <div className="choice-stack">
            {question.choices.map((choice) => {
              const selected = Array.isArray(answer) && answer.includes(choice.id);
              return (
                <label className="choice-option" key={choice.id}>
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => {
                      const current = Array.isArray(answer) ? answer : [];
                      setAnswer(selected ? current.filter((item) => item !== choice.id) : [...current, choice.id]);
                    }}
                    disabled={Boolean(submittedResult)}
                  />
                  <span>{choice.label}</span>
                </label>
              );
            })}
          </div>
        );
      case 'trueFalse':
        return (
          <div className="binary-row">
            <button
              className={answer === true ? 'choice-button selected' : 'choice-button'}
              onClick={() => setAnswer(true)}
              disabled={Boolean(submittedResult)}
            >
              True
            </button>
            <button
              className={answer === false ? 'choice-button selected' : 'choice-button'}
              onClick={() => setAnswer(false)}
              disabled={Boolean(submittedResult)}
            >
              False
            </button>
          </div>
        );
      case 'numeric':
        return (
          <label className="field-label">
            Answer {question.unit ?? ''}
            <input
              className="text-input"
              type="number"
              step="0.1"
              value={typeof answer === 'number' ? answer : ''}
              onChange={(event) => setAnswer(event.target.value === '' ? null : Number(event.target.value))}
              disabled={Boolean(submittedResult)}
            />
          </label>
        );
      case 'measurement': {
        const mq = question as MeasurementQuestion;
        const planeName = mq.plane.charAt(0).toUpperCase() + mq.plane.slice(1);
        const wrongPlane = latestMeasurement && latestMeasurement.plane !== mq.plane;
        return (
          <div className="measurement-answer-panel">
            <div className="measurement-instructions">
              <p>
                Use the <strong>Distance</strong> tool on the{' '}
                <strong>{planeName}</strong> plane to measure: <em>{mq.target}</em>.
              </p>
              <p className="measurement-instructions-sub">
                The most recent measurement on the {planeName} plane will be submitted as your answer.
              </p>
            </div>
            {wrongPlane ? (
              <div className="measurement-plane-warning">
                Current measurement is on the{' '}
                <strong>{latestMeasurement.plane.charAt(0).toUpperCase() + latestMeasurement.plane.slice(1)}</strong> plane.
                Switch to <strong>{planeName}</strong> and draw a new measurement.
              </div>
            ) : null}
            <div className={`measurement-readout ${selectedMeasurementValue !== null ? 'has-value' : 'no-value'}`}>
              {selectedMeasurementValue !== null ? (
                <>
                  <span className="measurement-readout-label">Selected measurement</span>
                  <span className="measurement-readout-value">
                    {selectedMeasurementValue.toFixed(2)} {mq.unit}
                  </span>
                </>
              ) : (
                <span className="measurement-readout-empty">
                  No {planeName} measurement yet — draw one in the viewer.
                </span>
              )}
            </div>
          </div>
        );
      }
      case 'shortText':
        return (
          <label className="field-label">
            Short answer
            <textarea
              className="text-input textarea"
              value={typeof answer === 'string' ? answer : ''}
              onChange={(event) => setAnswer(event.target.value)}
              disabled={Boolean(submittedResult)}
              placeholder="Type your answer..."
            />
          </label>
        );
      case 'deviceSelection': {
        if (devicesLoading) {
          return <p className="muted">Loading device catalog…</p>;
        }
        if (deviceOptions.length === 0) {
          return (
            <p className="muted">
              No matching devices are available
              {deviceQuestion?.allowedCategory ? ' for this category' : ''}.
            </p>
          );
        }
        return (
          <div className="device-pick-list">
            {deviceOptions.map((device) => {
              const selected = answer === device.id;
              return (
                <label
                  key={device.id}
                  className={selected ? 'device-pick-row selected' : 'device-pick-row'}
                >
                  <input
                    type="radio"
                    name={question.id}
                    checked={selected}
                    onChange={() => setAnswer(device.id)}
                    disabled={Boolean(submittedResult)}
                  />
                  <span className="device-pick-body">
                    <strong>{device.name}</strong>
                    <span className="muted small">
                      {device.manufacturer} · {device.category}
                      {device.subtype ? ` · ${device.subtype}` : ''}
                    </span>
                    <span className="muted small device-pick-description">
                      {device.description}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        );
      }
    }
  }

  function canSubmit(): boolean {
    if (submittedResult) return false;
    if (measurementQuestion) return selectedMeasurementValue !== null;
    if (answer === null) return false;
    if (Array.isArray(answer) && answer.length === 0) return false;
    if (typeof answer === 'string' && answer.trim() === '') return false;
    return true;
  }

  function renderFeedback() {
    if (!submittedResult || !measurementQuestion) return null;
    const submitted = submittedResult.answer as number;
    const expected = measurementQuestion.correctValue;
    const diff = Math.abs(submitted - expected);
    return (
      <div className={submittedResult.correct ? 'result-box correct' : 'result-box incorrect'}>
        <strong>{submittedResult.correct ? 'Correct' : 'Not correct'}</strong>
        <p>Your measurement: {submitted.toFixed(2)} {measurementQuestion.unit}</p>
        <p>Expected: {expected} {measurementQuestion.unit} ± {measurementQuestion.tolerance} {measurementQuestion.unit}</p>
        <p>Difference: {diff.toFixed(2)} {measurementQuestion.unit}</p>
        <p>{submittedResult.explanation}</p>
        <ScoreDetails result={submittedResult} />
      </div>
    );
  }

  return (
    <section className="question-card">
      <div className="question-progress">
        <span>Question {index + 1} of {vascCase.questions.length}</span>
        <strong>{question.points} point{question.points === 1 ? '' : 's'}</strong>
      </div>
      <h3>{question.prompt}</h3>
      {referencedBookmark ? (
        <button
          type="button"
          className="secondary-button small"
          onClick={() => onJumpToBookmark(referencedBookmark)}
        >
          Jump to referenced finding
        </button>
      ) : null}
      {question.proceduralStepId ? (
        <div className="procedural-question-context">
          <div>
            <span className="muted small">Procedural step</span>
            <strong>{proceduralStepLabel}</strong>
          </div>
          <button
            type="button"
            className="secondary-button small"
            onClick={() => onJumpToProceduralStep?.(question.proceduralStepId!)}
            disabled={!referencedProceduralStep}
          >
            {activeProceduralStepId === question.proceduralStepId ? 'Viewing step' : 'Jump to procedural step'}
          </button>
        </div>
      ) : null}

      {!submittedResult ? renderAnswerInput() : null}

      {question.hints && question.hints.length > 0 ? (
        <div className="hint-box">
          <button
            className="secondary-button small"
            onClick={revealHint}
            disabled={shownHints >= question.hints.length || Boolean(submittedResult)}
          >
            Show hint
          </button>
          {question.hints.slice(0, shownHints).map((hint, hintIndex) => (
            <p key={hint}>Hint {hintIndex + 1}: {hint}</p>
          ))}
        </div>
      ) : null}

      {submittedResult ? (
        measurementQuestion ? (
          renderFeedback()
        ) : deviceQuestion ? (
          renderDeviceFeedback(submittedResult, deviceOptions, deviceQuestion.correctDeviceId)
        ) : (
          <div className={submittedResult.correct ? 'result-box correct' : 'result-box incorrect'}>
            <strong>{submittedResult.correct ? 'Correct' : 'Not correct'}</strong>
            <p>Your answer: {formatSubmittedAnswer(question, submittedResult.answer, deviceOptions)}</p>
            <p>Expected: {submittedResult.expected}</p>
            <p>{submittedResult.explanation}</p>
            <ScoreDetails result={submittedResult} />
          </div>
        )
      ) : null}

      <div className="question-actions">
        {!submittedResult ? (
          <button className="primary-button" onClick={submit} disabled={!canSubmit()}>
            Submit answer
          </button>
        ) : (
          <button className="primary-button" onClick={() => void next()}>
            {isLast ? 'Finish case' : 'Next question'}
          </button>
        )}
      </div>
    </section>
  );
}

function renderDeviceFeedback(
  result: QuestionResult,
  deviceOptions: Device[],
  correctDeviceId: string,
) {
  const submittedId = typeof result.answer === 'string' ? result.answer : '';
  const submitted = deviceOptions.find((d) => d.id === submittedId);
  const correct = deviceOptions.find((d) => d.id === correctDeviceId);
  return (
    <div className={result.correct ? 'result-box correct' : 'result-box incorrect'}>
      <strong>{result.correct ? 'Correct' : 'Not correct'}</strong>
      <p>
        <strong>Your pick:</strong> {submitted ? `${submitted.name} (${submitted.manufacturer})` : '— (no answer)'}
      </p>
      <p>
        <strong>Best answer:</strong>{' '}
        {correct ? `${correct.name} (${correct.manufacturer})` : correctDeviceId}
      </p>
      <p>{result.explanation}</p>
      <ScoreDetails result={result} />
    </div>
  );
}

function ScoreDetails({ result }: { result: QuestionResult }) {
  const penalty =
    result.hintsUsed > 0
      ? `${result.penaltyPoints.toFixed(2)} pt penalty (${result.hintsUsed} hint${result.hintsUsed === 1 ? '' : 's'}, ${result.hintPenaltyPercent}%)`
      : 'No hint penalty';
  return (
    <div className="result-score-details">
      <p>
        <strong>Score:</strong> {result.awardedPoints} / {result.maxPoints}
      </p>
      <p>
        <strong>Penalty:</strong> {penalty}
      </p>
      <p>
        <strong>Time:</strong> {formatDuration(result.elapsedMs)}
      </p>
    </div>
  );
}

function formatSubmittedAnswer(question: Question, answer: UserAnswer, devices: Device[]): string {
  if (answer === null || answer === undefined) return 'No answer';
  switch (question.type) {
    case 'multipleChoice':
      return typeof answer === 'string'
        ? question.choices.find((choice) => choice.id === answer)?.label ?? answer
        : String(answer);
    case 'multiSelect':
      if (!Array.isArray(answer)) return String(answer);
      return question.choices
        .filter((choice) => answer.includes(choice.id))
        .map((choice) => choice.label)
        .join(', ') || '(none)';
    case 'trueFalse':
      return answer === true ? 'True' : answer === false ? 'False' : String(answer);
    case 'numeric':
      return typeof answer === 'number' ? `${answer} ${question.unit ?? ''}`.trim() : String(answer);
    case 'measurement':
      return typeof answer === 'number' ? `${answer.toFixed(2)} ${question.unit}` : String(answer);
    case 'shortText':
      return typeof answer === 'string' ? answer.trim() || '(empty)' : String(answer);
    case 'deviceSelection': {
      if (typeof answer !== 'string') return String(answer);
      const device = devices.find((item) => item.id === answer);
      return device ? `${device.name} (${device.manufacturer})` : answer || 'No device selected';
    }
  }
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}
