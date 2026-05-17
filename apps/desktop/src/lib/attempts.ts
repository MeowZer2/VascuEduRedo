import type { QuestionResult, UserAnswer } from '../types';
import { getActiveProfileId } from './profiles';
import { isTauriDesktop, safeInvoke } from './tauri';

// Must match `LEGACY_PROFILE_ID` in src-tauri/src/db.rs — the sentinel that
// pre-profile / unscoped SQLite attempt rows are backfilled with.
const SQLITE_LEGACY_PROFILE_ID = 'local-default';
const SQLITE_CLAIM_FLAG = 'vascedu.profiles.sqliteLegacyClaimed.v1';

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
    return await safeInvoke<AttemptRow>('create_attempt', {
      caseId,
      profileId: getActiveProfileId(),
    });
  } catch (error) {
    console.error('createAttempt failed:', error);
    return null;
  }
}

export async function submitQuestionResponse(
  attemptId: string,
  questionId: string,
  answer: UserAnswer,
  result: QuestionResult,
): Promise<void> {
  if (!isTauriDesktop()) return;
  try {
    await safeInvoke('submit_question_response', {
      attemptId,
      questionId,
      answerJson: answer,
      isCorrect: result.correct,
      awardedPoints: result.awardedPoints,
      maxPoints: result.maxPoints,
      hintsUsed: result.hintsUsed,
      elapsedMs: result.elapsedMs,
      penaltyPoints: result.penaltyPoints,
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
    return (
      (await safeInvoke<AttemptRow[]>('list_attempts', {
        caseId: caseId ?? null,
        profileId: getActiveProfileId(),
      })) ?? []
    );
  } catch (error) {
    console.error('listAttempts failed:', error);
    return [];
  }
}

/**
 * One-time, non-destructive migration: claim pre-profile / unscoped SQLite
 * attempt rows (sentinel `local-default`) for the given profile so existing
 * desktop progress/review is preserved under the default local profile.
 * Safe to call on every startup — guarded by a localStorage flag and a no-op
 * in browser mode.
 */
export async function claimLegacySqliteAttempts(profileId: string): Promise<void> {
  if (!isTauriDesktop()) return;
  if (typeof window !== 'undefined' && window.localStorage.getItem(SQLITE_CLAIM_FLAG)) return;
  try {
    if (profileId && profileId !== SQLITE_LEGACY_PROFILE_ID) {
      await safeInvoke<number>('reassign_attempts_profile', {
        fromProfileId: SQLITE_LEGACY_PROFILE_ID,
        toProfileId: profileId,
      });
    }
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(SQLITE_CLAIM_FLAG, '1');
    }
  } catch (error) {
    console.error('claimLegacySqliteAttempts failed:', error);
  }
}
