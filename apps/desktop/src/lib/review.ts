import { isTauriDesktop, safeInvoke } from './tauri';

export interface ProgressSummary {
  totalAttempts: number;
  completedAttempts: number;
  casesCompleted: number;
  totalQuestionsAnswered: number;
  correctAnswers: number;
  accuracyPercent: number;
  averageScore: number;
  bestScore: number;
  averagePercent: number;
  bestPercent: number;
  measurementQuestionsAnswered: number;
  averageMeasurementError: number | null;
}

export interface CaseProgress {
  caseId: string;
  caseTitle: string;
  category: string;
  maxScore: number;
  attempts: number;
  completed: number;
  bestScore: number | null;
  latestScore: number | null;
  averageScore: number | null;
  bestPercent: number | null;
  latestPercent: number | null;
  averagePercent: number | null;
  lastAttemptAt: string | null;
}

export interface AttemptSummary {
  id: string;
  caseId: string;
  caseTitle: string;
  startedAt: string;
  completedAt: string | null;
  score: number | null;
  maxScore: number;
  percent: number | null;
}

export interface MeasurementDetail {
  plane: string;
  unit: string;
  correctValue: number;
  tolerance: number;
  submittedValue: number | null;
  difference: number | null;
  withinTolerance: boolean | null;
}

export interface AttemptQuestionDetail {
  responseId: string | null;
  questionId: string;
  orderIndex: number;
  type: string;
  prompt: string;
  points: number;
  questionData: Record<string, unknown>;
  /** Submitted answer (parsed JSON). Possible types: string, number, boolean, string[], null. */
  answer: unknown;
  isCorrect: boolean | null;
  submittedAt: string | null;
  measurement: MeasurementDetail | null;
}

export interface AttemptDetails {
  attempt: AttemptSummary;
  questions: AttemptQuestionDetail[];
}

export const EMPTY_PROGRESS_SUMMARY: ProgressSummary = {
  totalAttempts: 0,
  completedAttempts: 0,
  casesCompleted: 0,
  totalQuestionsAnswered: 0,
  correctAnswers: 0,
  accuracyPercent: 0,
  averageScore: 0,
  bestScore: 0,
  averagePercent: 0,
  bestPercent: 0,
  measurementQuestionsAnswered: 0,
  averageMeasurementError: null,
};

export function isReviewAvailable(): boolean {
  return isTauriDesktop();
}

export async function fetchProgressSummary(): Promise<ProgressSummary | null> {
  if (!isTauriDesktop()) return null;
  try {
    return (await safeInvoke<ProgressSummary>('progress_summary')) ?? null;
  } catch (error) {
    console.error('progress_summary failed:', error);
    return null;
  }
}

export async function fetchProgressByCase(): Promise<CaseProgress[]> {
  if (!isTauriDesktop()) return [];
  try {
    return (await safeInvoke<CaseProgress[]>('progress_by_case')) ?? [];
  } catch (error) {
    console.error('progress_by_case failed:', error);
    return [];
  }
}

export async function fetchRecentActivity(limit = 10): Promise<AttemptSummary[]> {
  if (!isTauriDesktop()) return [];
  try {
    return (await safeInvoke<AttemptSummary[]>('get_recent_activity', { limit })) ?? [];
  } catch (error) {
    console.error('get_recent_activity failed:', error);
    return [];
  }
}

export async function fetchAttemptDetails(attemptId: string): Promise<AttemptDetails | null> {
  if (!isTauriDesktop()) return null;
  try {
    return (await safeInvoke<AttemptDetails | null>('get_attempt_details', { attemptId })) ?? null;
  } catch (error) {
    console.error('get_attempt_details failed:', error);
    return null;
  }
}

interface Choice {
  id: string;
  label: string;
}

function asChoices(value: unknown): Choice[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (entry && typeof entry === 'object') {
      const id = (entry as Record<string, unknown>).id;
      const label = (entry as Record<string, unknown>).label;
      if (typeof id === 'string' && typeof label === 'string') return [{ id, label }];
    }
    return [];
  });
}

/** Optional device-name lookup for `deviceSelection` formatting. Keeps review.ts decoupled from the catalog. */
export type DeviceNameLookup = (id: string) => string | null;

/**
 * Format the submitted answer for display in the review UI. Mirrors the live training
 * feedback formatting so the review screen reads the same way.
 */
export function formatAnswer(
  type: string,
  questionData: Record<string, unknown>,
  answer: unknown,
  deviceNameLookup?: DeviceNameLookup,
): string {
  if (answer === null || answer === undefined) return '— (no answer recorded)';
  switch (type) {
    case 'multipleChoice': {
      if (typeof answer !== 'string') return String(answer);
      const choice = asChoices(questionData.choices).find((c) => c.id === answer);
      return choice?.label ?? answer;
    }
    case 'multiSelect': {
      if (!Array.isArray(answer)) return String(answer);
      const labels = asChoices(questionData.choices)
        .filter((c) => answer.includes(c.id))
        .map((c) => c.label);
      return labels.length > 0 ? labels.join(', ') : '(none)';
    }
    case 'trueFalse':
      return answer === true ? 'True' : answer === false ? 'False' : String(answer);
    case 'numeric': {
      const unit = (questionData.unit as string | undefined) ?? '';
      return typeof answer === 'number' ? `${answer} ${unit}`.trim() : String(answer);
    }
    case 'measurement': {
      const unit = (questionData.unit as string | undefined) ?? 'mm';
      return typeof answer === 'number' ? `${answer.toFixed(2)} ${unit}` : String(answer);
    }
    case 'shortText':
      return typeof answer === 'string' ? (answer.trim() || '(empty)') : String(answer);
    case 'deviceSelection': {
      if (typeof answer !== 'string' || !answer) return '—';
      const name = deviceNameLookup?.(answer);
      return name ?? answer;
    }
    default:
      return JSON.stringify(answer);
  }
}

export function formatExpected(
  type: string,
  questionData: Record<string, unknown>,
  deviceNameLookup?: DeviceNameLookup,
): string {
  switch (type) {
    case 'multipleChoice': {
      const choices = asChoices(questionData.choices);
      const correctId = questionData.correctChoiceId as string | undefined;
      return choices.find((c) => c.id === correctId)?.label ?? correctId ?? '—';
    }
    case 'multiSelect': {
      const choices = asChoices(questionData.choices);
      const correct = (questionData.correctChoiceIds as string[] | undefined) ?? [];
      const labels = choices.filter((c) => correct.includes(c.id)).map((c) => c.label);
      return labels.length > 0 ? labels.join(', ') : '—';
    }
    case 'trueFalse':
      return questionData.correct === true ? 'True' : 'False';
    case 'numeric': {
      const value = questionData.correctValue;
      const tol = questionData.tolerance;
      const unit = (questionData.unit as string | undefined) ?? '';
      if (typeof value !== 'number') return '—';
      const tolerance = typeof tol === 'number' && tol > 0 ? ` ± ${tol}` : '';
      return `${value}${tolerance} ${unit}`.trim();
    }
    case 'measurement': {
      const value = questionData.correctValue;
      const tol = questionData.tolerance;
      const unit = (questionData.unit as string | undefined) ?? 'mm';
      if (typeof value !== 'number') return '—';
      const tolerance = typeof tol === 'number' ? ` ± ${tol}` : '';
      return `${value}${tolerance} ${unit}`;
    }
    case 'shortText': {
      const keywords = (questionData.requiredKeywords as string[] | undefined) ?? [];
      return keywords.length > 0 ? `Any of: ${keywords.join(', ')}` : '—';
    }
    case 'deviceSelection': {
      const id = questionData.correctDeviceId as string | undefined;
      if (!id) return '—';
      const name = deviceNameLookup?.(id);
      return name ?? id;
    }
    default:
      return '—';
  }
}
