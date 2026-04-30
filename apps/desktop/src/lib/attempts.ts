import type { UserAnswer } from '../types';
import { isTauriDesktop, safeInvoke } from './tauri';

export interface AttemptRow {
  id: string;
  caseId: string;
  startedAt: string;
  completedAt: string | null;
  score: number | null;
}

/**
 * Create a new attempt row for the given case. Returns null in browser mode (the caller
 * should treat that as "no persistent attempt id" and continue with in-memory scoring).
 */
export async function createAttempt(caseId: string): Promise<AttemptRow | null> {
  if (!isTauriDesktop()) return null;
  try {
    return await safeInvoke<AttemptRow>('create_attempt', { caseId });
  } catch (error) {
    console.error('createAttempt failed:', error);
    return null;
  }
}

export async function submitQuestionResponse(
  attemptId: string,
  questionId: string,
  answer: UserAnswer,
  isCorrect: boolean,
): Promise<void> {
  if (!isTauriDesktop()) return;
  try {
    await safeInvoke('submit_question_response', {
      attemptId,
      questionId,
      answerJson: answer,
      isCorrect,
    });
  } catch (error) {
    console.error('submitQuestionResponse failed:', error);
  }
}

export async function completeAttempt(attemptId: string, score: number): Promise<AttemptRow | null> {
  if (!isTauriDesktop()) return null;
  try {
    return await safeInvoke<AttemptRow>('complete_attempt', { attemptId, score });
  } catch (error) {
    console.error('completeAttempt failed:', error);
    return null;
  }
}

export async function listAttempts(caseId?: string): Promise<AttemptRow[]> {
  if (!isTauriDesktop()) return [];
  try {
    return (await safeInvoke<AttemptRow[]>('list_attempts', { caseId: caseId ?? null })) ?? [];
  } catch (error) {
    console.error('listAttempts failed:', error);
    return [];
  }
}
