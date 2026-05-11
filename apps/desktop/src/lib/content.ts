import { cases as sampleCases } from '../data/sampleContent';
import type { Question, VascCase } from '../types';
import { listCaseBookmarks } from './bookmarks';
import { isTauriDesktop, safeInvoke } from './tauri';

interface CaseRow {
  id: string;
  slug: string;
  title: string;
  summary: string;
  category: string;
  volumePath: string | null;
  data: Record<string, unknown>;
}

interface QuestionRow {
  id: string;
  caseId: string;
  orderIndex: number;
  type: string;
  prompt: string;
  data: Record<string, unknown>;
}

/**
 * Reconstruct a `VascCase` from a SQLite row + its questions. The `data` blob mirrors the
 * extra fields of the original `VascCase` shape (patient, learning objectives, tags, etc.).
 */
function rowToVascCase(row: CaseRow, questions: Question[], bookmarks: VascCase['bookmarks'] = []): VascCase {
  const extra = row.data ?? {};
  const patient = (extra as Record<string, unknown>).patient as VascCase['patient'] | undefined;
  const volume = (extra as Record<string, unknown>).volume as VascCase['volume'] | undefined;

  return {
    id: row.id,
    categoryId: (extra.categoryId as string | undefined) ?? row.category,
    title: row.title,
    diagnosis: (extra.diagnosis as string | undefined) ?? row.summary,
    difficulty: (extra.difficulty as VascCase['difficulty']) ?? 'intermediate',
    estimatedMinutes: (extra.estimatedMinutes as number | undefined) ?? 10,
    tags: (extra.tags as string[] | undefined) ?? [],
    patient: patient ?? {
      age: 0,
      sex: 'other',
      presentation: '',
      history: [],
    },
    learningObjectives: (extra.learningObjectives as string[] | undefined) ?? [],
    teachingPoints: (extra.teachingPoints as string[] | undefined) ?? undefined,
    references: (extra.references as string[] | undefined) ?? undefined,
    author: (extra.author as string | undefined) ?? undefined,
    reviewer: (extra.reviewer as string | undefined) ?? undefined,
    lastReviewedAt: (extra.lastReviewedAt as string | undefined) ?? undefined,
    volume: volume ?? {
      type: 'nrrd',
      path: row.volumePath ?? undefined,
      description: '',
    },
    bookmarks,
    questions,
  };
}

function rowToQuestion(row: QuestionRow): Question {
  return { id: row.id, type: row.type, prompt: row.prompt, ...row.data } as Question;
}

/**
 * Load all cases. In desktop mode, reads from SQLite via Tauri. In browser mode (or if the
 * backend call fails), falls back to the bundled sample data so the app still renders.
 */
export async function loadCases(): Promise<VascCase[]> {
  if (!isTauriDesktop()) {
    return sampleCases;
  }
  try {
    const rows = await safeInvoke<CaseRow[]>('list_cases');
    // safeInvoke returns null when not in Tauri / command unavailable — only then
    // do we fall back to bundled samples. An empty array from SQLite is a real
    // "all cases were deleted" state and should be respected.
    if (!rows) return sampleCases;
    const result: VascCase[] = [];
    for (const row of rows) {
      const questionRows = (await safeInvoke<QuestionRow[]>('get_case_questions', { caseId: row.id })) ?? [];
      const bookmarks = await listCaseBookmarks(row.id);
      result.push(rowToVascCase(row, questionRows.map(rowToQuestion), bookmarks));
    }
    return result;
  } catch (error) {
    console.error('loadCases failed, falling back to sample data:', error);
    return sampleCases;
  }
}

export async function loadCaseById(caseId: string): Promise<VascCase | undefined> {
  if (!isTauriDesktop()) {
    return sampleCases.find((c) => c.id === caseId);
  }
  try {
    const row = await safeInvoke<CaseRow | null>('get_case', { identifier: caseId });
    if (!row) return sampleCases.find((c) => c.id === caseId);
    const questionRows = (await safeInvoke<QuestionRow[]>('get_case_questions', { caseId: row.id })) ?? [];
    const bookmarks = await listCaseBookmarks(row.id);
    return rowToVascCase(row, questionRows.map(rowToQuestion), bookmarks);
  } catch (error) {
    console.error('loadCaseById failed, falling back to sample data:', error);
    return sampleCases.find((c) => c.id === caseId);
  }
}
