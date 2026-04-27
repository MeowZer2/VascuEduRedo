import { cases, categories } from '../data/sampleContent';
import type { AttemptResult } from '../types';
import { readJson, writeJson } from './storage';

const ATTEMPTS_KEY = 'vascedu.attempts.v0';

export interface ProgressSummary {
  attempts: AttemptResult[];
  totalAttempts: number;
  averagePercent: number;
  completedCases: number;
  bestCase?: AttemptResult;
  categoryBreakdown: Array<{
    categoryId: string;
    categoryTitle: string;
    attempts: number;
    averagePercent: number;
  }>;
}

export function getAttempts(): AttemptResult[] {
  return readJson<AttemptResult[]>(ATTEMPTS_KEY, []);
}

export function saveAttempt(attempt: AttemptResult): void {
  const attempts = getAttempts();
  writeJson(ATTEMPTS_KEY, [attempt, ...attempts]);
}

export function clearAttempts(): void {
  writeJson(ATTEMPTS_KEY, []);
}

export function getProgressSummary(): ProgressSummary {
  const attempts = getAttempts();
  const averagePercent = attempts.length
    ? attempts.reduce((sum, attempt) => sum + attempt.percent, 0) / attempts.length
    : 0;

  const completedCases = new Set(attempts.map((attempt) => attempt.caseId)).size;
  const bestCase = attempts.reduce<AttemptResult | undefined>((best, attempt) => {
    if (!best || attempt.percent > best.percent) return attempt;
    return best;
  }, undefined);

  const categoryBreakdown = categories.map((category) => {
    const caseIds = cases.filter((item) => item.categoryId === category.id).map((item) => item.id);
    const categoryAttempts = attempts.filter((attempt) => caseIds.includes(attempt.caseId));
    const categoryAverage = categoryAttempts.length
      ? categoryAttempts.reduce((sum, attempt) => sum + attempt.percent, 0) / categoryAttempts.length
      : 0;
    return {
      categoryId: category.id,
      categoryTitle: category.title,
      attempts: categoryAttempts.length,
      averagePercent: categoryAverage,
    };
  });

  return {
    attempts,
    totalAttempts: attempts.length,
    averagePercent,
    completedCases,
    bestCase,
    categoryBreakdown,
  };
}
