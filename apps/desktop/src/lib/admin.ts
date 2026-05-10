import { isTauriDesktop, safeInvoke } from './tauri';

export interface AdminCaseRow {
  id: string;
  slug: string;
  title: string;
  summary: string;
  category: string;
  volumePath: string | null;
  data: Record<string, unknown>;
}

export interface AdminQuestionRow {
  id: string;
  caseId: string;
  orderIndex: number;
  type: string;
  prompt: string;
  data: Record<string, unknown>;
}

export interface AdminCaseInput {
  slug: string;
  title: string;
  summary: string;
  category: string;
  volumePath: string | null;
  /** Optional extended payload — when omitted on update, the existing blob is preserved. */
  data?: Record<string, unknown>;
}

export interface AdminQuestionInput {
  type: string;
  prompt: string;
  data: Record<string, unknown>;
  orderIndex?: number;
}

export interface AdminCaseWithQuestions extends AdminCaseRow {
  questions: AdminQuestionRow[];
}

class AdminUnavailableError extends Error {
  constructor() {
    super('Admin authoring requires Tauri desktop mode (run `pnpm dev`).');
    this.name = 'AdminUnavailableError';
  }
}

function ensureDesktop() {
  if (!isTauriDesktop()) throw new AdminUnavailableError();
}

export function isAdminAvailable(): boolean {
  return isTauriDesktop();
}

export async function adminListCases(): Promise<AdminCaseRow[]> {
  ensureDesktop();
  return (await safeInvoke<AdminCaseRow[]>('admin_list_cases')) ?? [];
}

export async function adminGetCaseWithQuestions(
  caseId: string,
): Promise<AdminCaseWithQuestions | null> {
  ensureDesktop();
  return (await safeInvoke<AdminCaseWithQuestions | null>('admin_get_case_with_questions', {
    caseId,
  })) ?? null;
}

export async function adminCreateCase(input: AdminCaseInput): Promise<AdminCaseRow> {
  ensureDesktop();
  const row = await safeInvoke<AdminCaseRow>('admin_create_case', { input });
  if (!row) throw new Error('admin_create_case returned no row');
  return row;
}

export async function adminUpdateCase(
  caseId: string,
  input: AdminCaseInput,
): Promise<AdminCaseRow> {
  ensureDesktop();
  const row = await safeInvoke<AdminCaseRow>('admin_update_case', { caseId, input });
  if (!row) throw new Error('admin_update_case returned no row');
  return row;
}

export async function adminDeleteCase(caseId: string): Promise<void> {
  ensureDesktop();
  await safeInvoke<void>('admin_delete_case', { caseId });
}

export async function adminCreateQuestion(
  caseId: string,
  input: AdminQuestionInput,
): Promise<AdminQuestionRow> {
  ensureDesktop();
  const row = await safeInvoke<AdminQuestionRow>('admin_create_question', { caseId, input });
  if (!row) throw new Error('admin_create_question returned no row');
  return row;
}

export async function adminUpdateQuestion(
  questionId: string,
  input: AdminQuestionInput,
): Promise<AdminQuestionRow> {
  ensureDesktop();
  const row = await safeInvoke<AdminQuestionRow>('admin_update_question', { questionId, input });
  if (!row) throw new Error('admin_update_question returned no row');
  return row;
}

export async function adminDeleteQuestion(questionId: string): Promise<void> {
  ensureDesktop();
  await safeInvoke<void>('admin_delete_question', { questionId });
}

export async function adminReorderQuestions(
  caseId: string,
  orderedQuestionIds: string[],
): Promise<void> {
  ensureDesktop();
  await safeInvoke<void>('admin_reorder_questions', { caseId, orderedQuestionIds });
}

// ---------------------------------------------------------------------------
// v0.9 — validation, import, export
// ---------------------------------------------------------------------------

export interface ValidationIssue {
  severity: 'error' | 'warning';
  field: string;
  message: string;
  questionId: string | null;
}

export interface ValidationReport {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export interface ImportCaseInput {
  slug: string;
  title: string;
  summary: string;
  category: string;
  volumePath: string | null;
  data?: Record<string, unknown>;
}

export interface ImportQuestionInput {
  type: string;
  prompt: string;
  orderIndex?: number;
  data: Record<string, unknown>;
}

export interface CaseImportPayload {
  version?: string;
  case: ImportCaseInput;
  questions: ImportQuestionInput[];
}

export interface CaseExportPayload extends CaseImportPayload {
  version: string;
  exportedAt: string;
  questions: Array<ImportQuestionInput & { orderIndex: number }>;
}

export interface ImportOptions {
  /** "error" (default) rejects on slug collision, "rename" auto-suffixes the slug. */
  slugStrategy?: 'error' | 'rename';
}

export async function adminValidateCase(caseId: string): Promise<ValidationReport | null> {
  ensureDesktop();
  return (await safeInvoke<ValidationReport>('admin_validate_case', { caseId })) ?? null;
}

export async function adminValidateCasePayload(
  payload: CaseImportPayload,
): Promise<ValidationReport | null> {
  ensureDesktop();
  return (
    (await safeInvoke<ValidationReport>('admin_validate_case_payload', { payload })) ?? null
  );
}

export async function adminExportCase(caseId: string): Promise<CaseExportPayload | null> {
  ensureDesktop();
  return (await safeInvoke<CaseExportPayload>('admin_export_case', { caseId })) ?? null;
}

export async function adminImportCase(
  payload: CaseImportPayload,
  options?: ImportOptions,
): Promise<AdminCaseRow> {
  ensureDesktop();
  const row = await safeInvoke<AdminCaseRow>('admin_import_case', {
    payload,
    options: options ?? {},
  });
  if (!row) throw new Error('admin_import_case returned no row');
  return row;
}
