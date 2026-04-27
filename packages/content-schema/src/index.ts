import { z } from 'zod';

export const difficultySchema = z.enum(['beginner', 'intermediate', 'advanced']);

export const categorySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  emoji: z.string().min(1),
  description: z.string().min(1),
});

export const patientInfoSchema = z.object({
  age: z.number().int().positive(),
  sex: z.enum(['male', 'female', 'other']),
  presentation: z.string().min(1),
  history: z.array(z.string().min(1)),
  vitals: z.array(z.string()).optional(),
});

const questionBaseSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  explanation: z.string().min(1),
  points: z.number().positive(),
  hints: z.array(z.string()).optional(),
  learningObjectiveId: z.string().optional(),
});

export const questionSchema = z.discriminatedUnion('type', [
  questionBaseSchema.extend({
    type: z.literal('multipleChoice'),
    choices: z.array(z.object({ id: z.string(), label: z.string() })).min(2),
    correctChoiceId: z.string(),
  }),
  questionBaseSchema.extend({
    type: z.literal('multiSelect'),
    choices: z.array(z.object({ id: z.string(), label: z.string() })).min(2),
    correctChoiceIds: z.array(z.string()).min(1),
  }),
  questionBaseSchema.extend({
    type: z.literal('trueFalse'),
    correct: z.boolean(),
  }),
  questionBaseSchema.extend({
    type: z.literal('numeric'),
    correctValue: z.number(),
    tolerance: z.number().nonnegative(),
    unit: z.string().optional(),
  }),
  questionBaseSchema.extend({
    type: z.literal('shortText'),
    requiredKeywords: z.array(z.string()).min(1),
  }),
  questionBaseSchema.extend({
    type: z.literal('measurement'),
    target: z.string().min(1),
    correctValue: z.number(),
    tolerance: z.number().nonnegative(),
    unit: z.string().min(1),
  }),
]);

export const caseSchema = z.object({
  id: z.string().min(1),
  categoryId: z.string().min(1),
  title: z.string().min(1),
  diagnosis: z.string().min(1),
  difficulty: difficultySchema,
  estimatedMinutes: z.number().int().positive(),
  tags: z.array(z.string()),
  patient: patientInfoSchema,
  learningObjectives: z.array(z.string().min(1)).min(1),
  volume: z.object({
    type: z.enum(['mock', 'nrrd']),
    path: z.string().optional(),
    description: z.string(),
  }),
  questions: z.array(questionSchema).min(1),
});

export const contentPackSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  version: z.string().min(1),
  vascularDomain: z.string().min(1),
  categories: z.array(categorySchema),
  cases: z.array(caseSchema),
});

export type ContentPack = z.infer<typeof contentPackSchema>;
