export type Difficulty = 'beginner' | 'intermediate' | 'advanced';

export type EducationLevel = 'medical_student' | 'resident' | 'fellow' | 'attending';

export interface Category {
  id: string;
  title: string;
  emoji: string;
  description: string;
  color: string;
}

export interface PatientInfo {
  age: number;
  sex: 'male' | 'female' | 'other';
  presentation: string;
  history: string[];
  vitals?: string[];
}

export interface VascCase {
  id: string;
  categoryId: string;
  title: string;
  diagnosis: string;
  difficulty: Difficulty;
  estimatedMinutes: number;
  tags: string[];
  patient: PatientInfo;
  learningObjectives: string[];
  volume: {
    type: 'mock' | 'nrrd';
    path?: string;
    description: string;
  };
  questions: Question[];
}

export type QuestionType =
  | 'multipleChoice'
  | 'multiSelect'
  | 'trueFalse'
  | 'numeric'
  | 'shortText'
  | 'measurement';

export interface QuestionBase {
  id: string;
  type: QuestionType;
  prompt: string;
  explanation: string;
  points: number;
  hints?: string[];
  learningObjectiveId?: string;
}

export interface Choice {
  id: string;
  label: string;
}

export interface MultipleChoiceQuestion extends QuestionBase {
  type: 'multipleChoice';
  choices: Choice[];
  correctChoiceId: string;
}

export interface MultiSelectQuestion extends QuestionBase {
  type: 'multiSelect';
  choices: Choice[];
  correctChoiceIds: string[];
}

export interface TrueFalseQuestion extends QuestionBase {
  type: 'trueFalse';
  correct: boolean;
}

export interface NumericQuestion extends QuestionBase {
  type: 'numeric';
  correctValue: number;
  tolerance: number;
  unit?: string;
}

export interface ShortTextQuestion extends QuestionBase {
  type: 'shortText';
  requiredKeywords: string[];
}

export interface MeasurementQuestion extends QuestionBase {
  type: 'measurement';
  target: string;
  correctValue: number;
  tolerance: number;
  unit: string;
}

export type Question =
  | MultipleChoiceQuestion
  | MultiSelectQuestion
  | TrueFalseQuestion
  | NumericQuestion
  | ShortTextQuestion
  | MeasurementQuestion;

export type UserAnswer = string | string[] | boolean | number | null;

export interface QuestionResult {
  questionId: string;
  prompt: string;
  correct: boolean;
  awardedPoints: number;
  maxPoints: number;
  answer: UserAnswer;
  expected: string;
  explanation: string;
  hintsUsed: number;
}

export interface AttemptResult {
  id: string;
  caseId: string;
  caseTitle: string;
  completedAt: string;
  score: number;
  maxScore: number;
  percent: number;
  questionResults: QuestionResult[];
}
