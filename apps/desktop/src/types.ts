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
  /** v0.9 — optional richer authoring metadata. */
  teachingPoints?: string[];
  references?: string[];
  author?: string;
  reviewer?: string;
  /** ISO 8601 date (YYYY-MM-DD or full timestamp). */
  lastReviewedAt?: string;
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
  | 'measurement'
  | 'deviceSelection';

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
  plane: 'axial' | 'coronal' | 'sagittal';
  correctValue: number;
  tolerance: number;
  unit: string;
}

/**
 * v0.12 device-selection question. The learner picks one device from the
 * catalog (optionally filtered by category) and is correct if the chosen
 * device id matches `correctDeviceId`.
 */
export interface DeviceSelectionQuestion extends QuestionBase {
  type: 'deviceSelection';
  correctDeviceId: string;
  /** Optional category filter — when set, only devices in this category are shown. */
  allowedCategory?: string;
  /** Optional explicit whitelist of device ids to choose from. */
  allowedDeviceIds?: string[];
}

export type Question =
  | MultipleChoiceQuestion
  | MultiSelectQuestion
  | TrueFalseQuestion
  | NumericQuestion
  | ShortTextQuestion
  | MeasurementQuestion
  | DeviceSelectionQuestion;

export type UserAnswer = string | string[] | boolean | number | null;

export interface QuestionResult {
  questionId: string;
  prompt: string;
  type: QuestionType;
  correct: boolean;
  awardedPoints: number;
  maxPoints: number;
  penaltyPoints: number;
  hintPenaltyPercent: number;
  answer: UserAnswer;
  expected: string;
  explanation: string;
  hintsUsed: number;
  elapsedMs: number;
}

export interface AttemptResult {
  id: string;
  caseId: string;
  caseTitle: string;
  completedAt: string;
  score: number;
  maxScore: number;
  percent: number;
  correctCount: number;
  totalHintsUsed: number;
  totalElapsedMs: number;
  questionResults: QuestionResult[];
}
