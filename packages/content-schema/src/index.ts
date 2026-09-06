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
  points: z.number().finite().positive(),
  hints: z.array(z.string()).optional(),
  learningObjectiveId: z.string().optional(),
});

const choiceSchema = z.object({ id: z.string().trim().min(1), label: z.string().trim().min(1) });

const questionSchemaBase = z.discriminatedUnion('type', [
  questionBaseSchema.extend({
    type: z.literal('multipleChoice'),
    choices: z.array(choiceSchema).min(2),
    correctChoiceId: z.string().trim().min(1),
  }),
  questionBaseSchema.extend({
    type: z.literal('multiSelect'),
    choices: z.array(choiceSchema).min(2),
    correctChoiceIds: z.array(z.string().trim().min(1)).min(1),
  }),
  questionBaseSchema.extend({
    type: z.literal('trueFalse'),
    correct: z.boolean(),
  }),
  questionBaseSchema.extend({
    type: z.literal('numeric'),
    correctValue: z.number().finite(),
    tolerance: z.number().finite().nonnegative(),
    unit: z.string().optional(),
  }),
  questionBaseSchema.extend({
    type: z.literal('shortText'),
    requiredKeywords: z.array(z.string().trim().min(1)).min(1),
  }),
  questionBaseSchema.extend({
    type: z.literal('measurement'),
    target: z.string().min(1),
    plane: z.enum(['axial', 'coronal', 'sagittal']),
    correctValue: z.number().finite(),
    tolerance: z.number().finite().nonnegative(),
    unit: z.enum(['mm', 'cm']),
  }),
  questionBaseSchema.extend({
    type: z.literal('deviceSelection'),
    correctDeviceId: z.string().trim().min(1),
    allowedCategory: z.string().optional(),
    allowedDeviceIds: z.array(z.string().trim().min(1)).optional(),
  }),
]);

export const questionSchema = questionSchemaBase.superRefine((question, context) => {
  if (question.type === 'multipleChoice') {
    validateChoiceReferences(question.choices, [question.correctChoiceId], context);
  } else if (question.type === 'multiSelect') {
    validateChoiceReferences(question.choices, question.correctChoiceIds, context);
  }
});

function validateChoiceReferences(
  choices: Array<{ id: string }>,
  correctIds: string[],
  context: z.RefinementCtx,
) {
  const ids = choices.map((choice) => choice.id);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['choices'], message: 'Choice ids must be unique.' });
  }
  const available = new Set(ids);
  for (const correctId of correctIds) {
    if (!available.has(correctId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['correctChoiceId'], message: `Correct choice '${correctId}' does not exist.` });
    }
  }
}

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
