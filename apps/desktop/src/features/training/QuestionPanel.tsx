import { useMemo, useState } from 'react';
import type { ViewerMeasurement } from '../../components/NrrdViewer';
import { completeAttempt, submitQuestionResponse } from '../../lib/attempts';
import { evaluateAnswer, newAttemptId } from '../../lib/quiz';
import type { AttemptResult, MeasurementQuestion, Question, QuestionResult, UserAnswer, VascCase } from '../../types';

interface QuestionPanelProps {
  vascCase: VascCase;
  /** SQLite attempt id created by `TrainingWorkspace`, or null in browser mode. */
  attemptId: string | null;
  latestMeasurement: ViewerMeasurement | null;
  onComplete: (attempt: AttemptResult) => void;
  onQuestionChange: (index: number) => void;
}

function defaultAnswer(question: Question): UserAnswer {
  if (question.type === 'multiSelect') return [];
  if (question.type === 'trueFalse') return null;
  if (question.type === 'numeric' || question.type === 'measurement') return null;
  return '';
}

export function QuestionPanel({ vascCase, attemptId, latestMeasurement, onComplete, onQuestionChange }: QuestionPanelProps) {
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState<UserAnswer>(defaultAnswer(vascCase.questions[0]));
  const [hintsUsed, setHintsUsed] = useState<Record<string, number>>({});
  const [results, setResults] = useState<QuestionResult[]>([]);
  const [submittedResult, setSubmittedResult] = useState<QuestionResult | null>(null);

  const question = vascCase.questions[index];
  const shownHints = hintsUsed[question.id] ?? 0;
  const isLast = index === vascCase.questions.length - 1;

  const totalPossible = useMemo(() => vascCase.questions.reduce((sum, item) => sum + item.points, 0), [vascCase.questions]);

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
    const result = evaluateAnswer(question, effectiveAnswer, shownHints);
    setSubmittedResult(result);
    // Persist the response in SQLite (no-op in browser mode).
    if (attemptId) {
      void submitQuestionResponse(attemptId, question.id, effectiveAnswer, result.correct);
    }
  }

  function next() {
    if (!submittedResult) return;
    const updatedResults = [...results, submittedResult];
    setResults(updatedResults);
    setSubmittedResult(null);

    if (isLast) {
      const score = updatedResults.reduce((sum, item) => sum + item.awardedPoints, 0);
      const attempt: AttemptResult = {
        id: attemptId ?? newAttemptId(),
        caseId: vascCase.id,
        caseTitle: vascCase.title,
        completedAt: new Date().toISOString(),
        score: Number(score.toFixed(2)),
        maxScore: totalPossible,
        percent: Number(((score / totalPossible) * 100).toFixed(1)),
        questionResults: updatedResults,
      };
      // Mark the SQLite attempt complete with the final score (no-op in browser mode).
      if (attemptId) {
        void completeAttempt(attemptId, attempt.score);
      }
      onComplete(attempt);
      return;
    }

    const nextIndex = index + 1;
    const nextQuestion = vascCase.questions[nextIndex];
    setIndex(nextIndex);
    setAnswer(defaultAnswer(nextQuestion));
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
        <p>Score: {submittedResult.awardedPoints} / {submittedResult.maxPoints}</p>
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
        measurementQuestion ? renderFeedback() : (
          <div className={submittedResult.correct ? 'result-box correct' : 'result-box incorrect'}>
            <strong>{submittedResult.correct ? 'Correct' : 'Not correct'}</strong>
            <p>Expected: {submittedResult.expected}</p>
            <p>{submittedResult.explanation}</p>
            <p>Score: {submittedResult.awardedPoints} / {submittedResult.maxPoints}</p>
          </div>
        )
      ) : null}

      <div className="question-actions">
        {!submittedResult ? (
          <button className="primary-button" onClick={submit} disabled={!canSubmit()}>
            Submit answer
          </button>
        ) : (
          <button className="primary-button" onClick={next}>
            {isLast ? 'Finish case' : 'Next question'}
          </button>
        )}
      </div>
    </section>
  );
}
