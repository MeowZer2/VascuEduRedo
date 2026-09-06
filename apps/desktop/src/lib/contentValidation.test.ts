import { describe, expect, it } from 'vitest';
import { caseSchema, questionSchema } from '@vascedu/content-schema';

const base = { id: 'q', prompt: 'Prompt', explanation: 'Why', points: 1 };

describe('frontend question schema', () => {
  it('rejects invalid numeric definitions', () => {
    expect(questionSchema.safeParse({ ...base, type: 'numeric', correctValue: 2, tolerance: -1 }).success).toBe(false);
    expect(questionSchema.safeParse({ ...base, type: 'numeric', correctValue: 2 }).success).toBe(false);
  });

  it('rejects duplicate/missing choice references and invalid measurement units', () => {
    expect(questionSchema.safeParse({ ...base, type: 'multipleChoice', choices: [{ id: 'a', label: 'A' }, { id: 'a', label: 'Again' }], correctChoiceId: 'missing' }).success).toBe(false);
    expect(questionSchema.safeParse({ ...base, type: 'measurement', target: 'Aorta', plane: 'axial', correctValue: 10, tolerance: 1, unit: 'inch' }).success).toBe(false);
  });

  it('blocks zero-question training-ready cases', () => {
    const result = caseSchema.safeParse({ id: 'c', categoryId: 'cat', title: 'T', diagnosis: 'D', difficulty: 'beginner', estimatedMinutes: 5, tags: [], patient: { age: 20, sex: 'other', presentation: 'P', history: [] }, learningObjectives: ['O'], volume: { type: 'mock', description: '' }, questions: [] });
    expect(result.success).toBe(false);
  });
});
