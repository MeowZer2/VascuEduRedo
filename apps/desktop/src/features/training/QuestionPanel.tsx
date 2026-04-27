import { useMemo, useState } from 'react';
import { evaluateAnswer, newAttemptId } from '../../lib/quiz';
import type { AttemptResult, Question, QuestionResult, UserAnswer, VascCase } from '../../types';

interface QuestionPanelProps {
  vascCase: VascCase;
  onComplete: (attempt: AttemptResult) => void;
}

function defaultAnswer(question: Question): UserAnswer {
  if (question.type === 'multiSelect') return [];
  if (question.type === 'trueFalse') return null;
  if (question.type === 'numeric' || question.type === 'measurement') return null;
  return '';
}

export function QuestionPanel({ vascCase, onComplete }: QuestionPanelProps) {
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState<UserAnswer>(defaultAnswer(vascCase.questions[0]));
  const [hintsUsed, setHintsUsed] = useState<Record<string, number>>({});
  const [results, setResults] = useState<QuestionResult[]>([]);
  const [submittedResult, setSubmittedResult] = useState<QuestionResult | null>(null);

  const question = vascCase.questions[index];
  const shownHints = hintsUsed[question.id] ?? 0;
  const isLast = index === vascCase.questions.length - 1;

  const totalPossible = useMemo(() => vascCase.questions.reduce((sum, item) => sum + item.points, 0), [vascCase.questions]);

  function revealHint() {
    if (!question.hints || shownHints >= question.hints.length) return;
    setHintsUsed((current) => ({ ...current, [question.id]: shownHints + 1 }));
  }

  function submit() {
    const result = evaluateAnswer(question, answer, shownHints);
    setSubmittedResult(result);
  }

  function next() {
    if (!submittedResult) return;
    const updatedResults = [...results, submittedResult];
    setResults(updatedResults);
    setSubmittedResult(null);

    if (isLast) {
      const score = updatedResults.reduce((sum, item) => sum + item.awardedPoints, 0);
      const attempt: AttemptResult = {
        id: newAttemptId(),
        caseId: vascCase.id,
        caseTitle: vascCase.title,
        completedAt: new Date().toISOString(),
        score: Number(score.toFixed(2)),
        maxScore: totalPossible,
        percent: Number(((score / totalPossible) * 100).toFixed(1)),
        questionResults: updatedResults,
      };
      onComplete(attempt);
      return;
    }

    const nextQuestion = vascCase.questions[index + 1];
    setIndex((current) => current + 1);
    setAnswer(defaultAnswer(nextQuestion));
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
            <button className={answer === true ? 'choice-button selected' : 'choice-button'} onClick={() => setAnswer(true)} disabled={Boolean(submittedResult)}>True</button>
            <button className={answer === false ? 'choice-button selected' : 'choice-button'} onClick={() => setAnswer(false)} disabled={Boolean(submittedResult)}>False</button>
          </div>
        );
      case 'numeric':
      case 'measurement':
        return (
          <label className="field-label">
            Answer {question.type === 'numeric' ? question.unit ?? '' : question.unit}
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

  return (
    <section className="question-card">
      <div className="question-progress">
        <span>Question {index + 1} of {vascCase.questions.length}</span>
        <strong>{question.points} point{question.points === 1 ? '' : 's'}</strong>
      </div>
      <h3>{question.prompt}</h3>

      {renderAnswerInput()}

      {question.hints && question.hints.length > 0 ? (
        <div className="hint-box">
          <button className="secondary-button small" onClick={revealHint} disabled={shownHints >= question.hints.length || Boolean(submittedResult)}>
            Show hint
          </button>
          {question.hints.slice(0, shownHints).map((hint, hintIndex) => (
            <p key={hint}>Hint {hintIndex + 1}: {hint}</p>
          ))}
        </div>
      ) : null}

      {submittedResult ? (
        <div className={submittedResult.correct ? 'result-box correct' : 'result-box incorrect'}>
          <strong>{submittedResult.correct ? 'Correct' : 'Not correct'}</strong>
          <p>Expected: {submittedResult.expected}</p>
          <p>{submittedResult.explanation}</p>
          <p>Score: {submittedResult.awardedPoints} / {submittedResult.maxPoints}</p>
        </div>
      ) : null}

      <div className="question-actions">
        {!submittedResult ? (
          <button className="primary-button" onClick={submit}>Submit answer</button>
        ) : (
          <button className="primary-button" onClick={next}>{isLast ? 'Finish case' : 'Next question'}</button>
        )}
      </div>
    </section>
  );
}
