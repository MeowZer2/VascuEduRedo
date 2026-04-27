import type { Question, QuestionResult, UserAnswer } from '../types';

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function arraysEqualAsSets(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const aSet = new Set(a);
  return b.every((item) => aSet.has(item));
}

export function expectedAnswerLabel(question: Question): string {
  switch (question.type) {
    case 'multipleChoice':
      return question.choices.find((choice) => choice.id === question.correctChoiceId)?.label ?? question.correctChoiceId;
    case 'multiSelect':
      return question.choices
        .filter((choice) => question.correctChoiceIds.includes(choice.id))
        .map((choice) => choice.label)
        .join(', ');
    case 'trueFalse':
      return question.correct ? 'True' : 'False';
    case 'numeric':
      return `${question.correctValue} ${question.unit ?? ''}`.trim();
    case 'measurement':
      return `${question.correctValue} ${question.unit}`;
    case 'shortText':
      return `Any of: ${question.requiredKeywords.join(', ')}`;
  }
}

export function evaluateAnswer(question: Question, answer: UserAnswer, hintsUsed = 0): QuestionResult {
  let correct = false;

  switch (question.type) {
    case 'multipleChoice':
      correct = answer === question.correctChoiceId;
      break;
    case 'multiSelect':
      correct = Array.isArray(answer) && arraysEqualAsSets(answer, question.correctChoiceIds);
      break;
    case 'trueFalse':
      correct = answer === question.correct;
      break;
    case 'numeric':
      correct = typeof answer === 'number' && Math.abs(answer - question.correctValue) <= question.tolerance;
      break;
    case 'measurement':
      correct = typeof answer === 'number' && Math.abs(answer - question.correctValue) <= question.tolerance;
      break;
    case 'shortText': {
      if (typeof answer === 'string') {
        const normalized = normalize(answer);
        correct = question.requiredKeywords.some((keyword) => normalized.includes(normalize(keyword)));
      }
      break;
    }
  }

  const hintPenalty = Math.min(hintsUsed * 0.15, 0.45);
  const awardedPoints = correct ? Math.max(0, question.points * (1 - hintPenalty)) : 0;

  return {
    questionId: question.id,
    prompt: question.prompt,
    correct,
    awardedPoints: Number(awardedPoints.toFixed(2)),
    maxPoints: question.points,
    answer,
    expected: expectedAnswerLabel(question),
    explanation: question.explanation,
    hintsUsed,
  };
}

export function newAttemptId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `attempt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
