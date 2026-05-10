-- VascEdu v0.1 schema draft.
-- This is intentionally smaller than the old PyQt app schema.
-- Expand only after the core learning loop is stable.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  education_level TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS content_packs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  version TEXT NOT NULL,
  installed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  content_pack_id TEXT,
  category_id TEXT NOT NULL,
  title TEXT NOT NULL,
  diagnosis TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  estimated_minutes INTEGER NOT NULL,
  patient_json TEXT NOT NULL,
  objectives_json TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  volume_json TEXT NOT NULL,
  FOREIGN KEY (content_pack_id) REFERENCES content_packs(id)
);

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  question_type TEXT NOT NULL,
  prompt TEXT NOT NULL,
  points REAL NOT NULL,
  payload_json TEXT NOT NULL,
  explanation TEXT NOT NULL,
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  case_id TEXT NOT NULL,
  score REAL NOT NULL,
  max_score REAL NOT NULL,
  percent REAL NOT NULL,
  completed_at TEXT NOT NULL,
  FOREIGN KEY (case_id) REFERENCES cases(id)
);

CREATE TABLE IF NOT EXISTS question_responses (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  answer_json TEXT NOT NULL,
  correct INTEGER NOT NULL,
  awarded_points REAL NOT NULL,
  max_points REAL NOT NULL,
  hints_used INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (attempt_id) REFERENCES attempts(id) ON DELETE CASCADE,
  FOREIGN KEY (question_id) REFERENCES questions(id)
);

CREATE TABLE IF NOT EXISTS vessel_compositions (
  id TEXT PRIMARY KEY,
  case_id TEXT,
  name TEXT NOT NULL,
  data_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE SET NULL
);
