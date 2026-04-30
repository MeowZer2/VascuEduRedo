use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

/// Wrapper around a single SQLite connection guarded by a mutex.
pub struct DbState {
    conn: Mutex<Connection>,
}

impl DbState {
    pub fn new(conn: Connection) -> Self {
        Self {
            conn: Mutex::new(conn),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaseRow {
    pub id: String,
    pub slug: String,
    pub title: String,
    pub summary: String,
    pub category: String,
    pub volume_path: Option<String>,
    /// Extended case payload: patient, learning objectives, tags, etc. Mirrors the
    /// frontend `VascCase` shape so we don't lose data when round-tripping through SQLite.
    pub data: Value,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionRow {
    pub id: String,
    pub case_id: String,
    pub order_index: i64,
    pub r#type: String,
    pub prompt: String,
    /// Type-specific fields (choices, correctValue, plane, tolerance, etc.)
    pub data: Value,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttemptRow {
    pub id: String,
    pub case_id: String,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub score: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionResponseRow {
    pub id: String,
    pub attempt_id: String,
    pub question_id: String,
    pub answer: Value,
    pub is_correct: bool,
    pub submitted_at: String,
}

fn database_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Cannot create app data dir: {e}"))?;
    Ok(dir.join("vascedu.sqlite"))
}

pub fn open_and_initialize(app: &AppHandle) -> Result<Connection, String> {
    let path = database_path(app)?;
    let conn = Connection::open(&path).map_err(|e| format!("Cannot open SQLite at {path:?}: {e}"))?;
    initialize_schema(&conn)?;
    seed_if_empty(&conn)?;
    Ok(conn)
}

fn initialize_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS cases (
            id TEXT PRIMARY KEY,
            slug TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL,
            summary TEXT NOT NULL,
            category TEXT NOT NULL,
            volume_path TEXT,
            data_json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS questions (
            id TEXT PRIMARY KEY,
            case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
            order_index INTEGER NOT NULL,
            type TEXT NOT NULL,
            prompt TEXT NOT NULL,
            data_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_questions_case ON questions(case_id, order_index);

        CREATE TABLE IF NOT EXISTS attempts (
            id TEXT PRIMARY KEY,
            case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
            started_at TEXT NOT NULL,
            completed_at TEXT,
            score REAL
        );
        CREATE INDEX IF NOT EXISTS idx_attempts_case ON attempts(case_id, started_at);

        CREATE TABLE IF NOT EXISTS question_responses (
            id TEXT PRIMARY KEY,
            attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
            question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
            answer_json TEXT NOT NULL,
            is_correct INTEGER NOT NULL,
            submitted_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_responses_attempt ON question_responses(attempt_id);
        "#,
    )
    .map_err(|e| format!("Schema init failed: {e}"))?;
    Ok(())
}

fn seed_if_empty(conn: &Connection) -> Result<(), String> {
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM cases", [], |r| r.get(0))
        .map_err(|e| format!("Cannot count cases: {e}"))?;
    if count > 0 {
        return Ok(());
    }

    let seed: Value = serde_json::from_str(SEED_JSON)
        .map_err(|e| format!("Seed JSON is malformed: {e}"))?;
    let cases = seed
        .get("cases")
        .and_then(Value::as_array)
        .ok_or_else(|| "Seed JSON missing 'cases' array".to_string())?;

    for case in cases {
        let id = case
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| "Seed case missing id".to_string())?
            .to_string();
        let slug = case
            .get("slug")
            .and_then(Value::as_str)
            .unwrap_or(&id)
            .to_string();
        let title = case
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let summary = case
            .get("summary")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let category = case
            .get("category")
            .and_then(Value::as_str)
            .unwrap_or("uncategorized")
            .to_string();
        let volume_path = case
            .get("volumePath")
            .and_then(Value::as_str)
            .map(|s| s.to_string());
        let data_json = case
            .get("data")
            .map(|v| v.to_string())
            .unwrap_or_else(|| "{}".to_string());

        conn.execute(
            "INSERT INTO cases (id, slug, title, summary, category, volume_path, data_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, slug, title, summary, category, volume_path, data_json],
        )
        .map_err(|e| format!("Failed to insert seed case {id}: {e}"))?;

        let questions = case
            .get("questions")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for (index, q) in questions.iter().enumerate() {
            let qid = q
                .get("id")
                .and_then(Value::as_str)
                .map(|s| s.to_string())
                .unwrap_or_else(|| format!("{id}-q{index}"));
            let qtype = q
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or("multipleChoice")
                .to_string();
            let prompt = q
                .get("prompt")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            // Strip the structural fields and store the rest as the type-specific payload.
            let mut payload = q.clone();
            if let Some(obj) = payload.as_object_mut() {
                obj.remove("id");
                obj.remove("type");
                obj.remove("prompt");
            }
            let data_json = payload.to_string();

            conn.execute(
                "INSERT INTO questions (id, case_id, order_index, type, prompt, data_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![qid, id, index as i64, qtype, prompt, data_json],
            )
            .map_err(|e| format!("Failed to insert seed question {qid}: {e}"))?;
        }
    }

    Ok(())
}

fn parse_case_row(
    id: String,
    slug: String,
    title: String,
    summary: String,
    category: String,
    volume_path: Option<String>,
    data_json: String,
) -> Result<CaseRow, String> {
    let data: Value = serde_json::from_str(&data_json)
        .map_err(|e| format!("Cannot parse case data_json: {e}"))?;
    Ok(CaseRow {
        id,
        slug,
        title,
        summary,
        category,
        volume_path,
        data,
    })
}

fn parse_question_row(
    id: String,
    case_id: String,
    order_index: i64,
    r#type: String,
    prompt: String,
    data_json: String,
) -> Result<QuestionRow, String> {
    let data: Value = serde_json::from_str(&data_json)
        .map_err(|e| format!("Cannot parse question data_json: {e}"))?;
    Ok(QuestionRow {
        id,
        case_id,
        order_index,
        r#type,
        prompt,
        data,
    })
}

#[tauri::command]
pub fn list_cases(state: State<DbState>) -> Result<Vec<CaseRow>, String> {
    let conn = state.conn.lock().map_err(|e| format!("Lock poisoned: {e}"))?;
    let mut stmt = conn
        .prepare("SELECT id, slug, title, summary, category, volume_path, data_json FROM cases ORDER BY title")
        .map_err(|e| format!("list_cases prepare failed: {e}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, String>(6)?,
            ))
        })
        .map_err(|e| format!("list_cases query failed: {e}"))?;

    let mut out = Vec::new();
    for row in rows {
        let (id, slug, title, summary, category, volume_path, data_json) =
            row.map_err(|e| format!("list_cases row failed: {e}"))?;
        out.push(parse_case_row(id, slug, title, summary, category, volume_path, data_json)?);
    }
    Ok(out)
}

#[tauri::command]
pub fn get_case(state: State<DbState>, identifier: String) -> Result<Option<CaseRow>, String> {
    let conn = state.conn.lock().map_err(|e| format!("Lock poisoned: {e}"))?;
    let mut stmt = conn
        .prepare(
            "SELECT id, slug, title, summary, category, volume_path, data_json FROM cases WHERE id = ?1 OR slug = ?1 LIMIT 1",
        )
        .map_err(|e| format!("get_case prepare failed: {e}"))?;
    let mut rows = stmt
        .query(params![identifier])
        .map_err(|e| format!("get_case query failed: {e}"))?;
    if let Some(row) = rows.next().map_err(|e| format!("get_case next failed: {e}"))? {
        let id: String = row.get(0).map_err(|e| e.to_string())?;
        let slug: String = row.get(1).map_err(|e| e.to_string())?;
        let title: String = row.get(2).map_err(|e| e.to_string())?;
        let summary: String = row.get(3).map_err(|e| e.to_string())?;
        let category: String = row.get(4).map_err(|e| e.to_string())?;
        let volume_path: Option<String> = row.get(5).map_err(|e| e.to_string())?;
        let data_json: String = row.get(6).map_err(|e| e.to_string())?;
        Ok(Some(parse_case_row(
            id,
            slug,
            title,
            summary,
            category,
            volume_path,
            data_json,
        )?))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub fn get_case_questions(
    state: State<DbState>,
    case_id: String,
) -> Result<Vec<QuestionRow>, String> {
    let conn = state.conn.lock().map_err(|e| format!("Lock poisoned: {e}"))?;
    let mut stmt = conn
        .prepare(
            "SELECT id, case_id, order_index, type, prompt, data_json FROM questions WHERE case_id = ?1 ORDER BY order_index",
        )
        .map_err(|e| format!("get_case_questions prepare failed: {e}"))?;
    let rows = stmt
        .query_map(params![case_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
            ))
        })
        .map_err(|e| format!("get_case_questions query failed: {e}"))?;

    let mut out = Vec::new();
    for row in rows {
        let (id, case_id, order_index, qtype, prompt, data_json) =
            row.map_err(|e| format!("get_case_questions row failed: {e}"))?;
        out.push(parse_question_row(id, case_id, order_index, qtype, prompt, data_json)?);
    }
    Ok(out)
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[tauri::command]
pub fn create_attempt(state: State<DbState>, case_id: String) -> Result<AttemptRow, String> {
    let conn = state.conn.lock().map_err(|e| format!("Lock poisoned: {e}"))?;
    let id = Uuid::new_v4().to_string();
    let started_at = now_iso();
    conn.execute(
        "INSERT INTO attempts (id, case_id, started_at, completed_at, score) VALUES (?1, ?2, ?3, NULL, NULL)",
        params![id, case_id, started_at],
    )
    .map_err(|e| format!("create_attempt insert failed: {e}"))?;
    Ok(AttemptRow {
        id,
        case_id,
        started_at,
        completed_at: None,
        score: None,
    })
}

#[tauri::command]
pub fn submit_question_response(
    state: State<DbState>,
    attempt_id: String,
    question_id: String,
    answer_json: Value,
    is_correct: bool,
) -> Result<QuestionResponseRow, String> {
    let conn = state.conn.lock().map_err(|e| format!("Lock poisoned: {e}"))?;
    let id = Uuid::new_v4().to_string();
    let submitted_at = now_iso();
    let answer_str = answer_json.to_string();
    conn.execute(
        "INSERT INTO question_responses (id, attempt_id, question_id, answer_json, is_correct, submitted_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, attempt_id, question_id, answer_str, is_correct as i64, submitted_at],
    )
    .map_err(|e| format!("submit_question_response insert failed: {e}"))?;
    Ok(QuestionResponseRow {
        id,
        attempt_id,
        question_id,
        answer: answer_json,
        is_correct,
        submitted_at,
    })
}

#[tauri::command]
pub fn complete_attempt(
    state: State<DbState>,
    attempt_id: String,
    score: f64,
) -> Result<AttemptRow, String> {
    let conn = state.conn.lock().map_err(|e| format!("Lock poisoned: {e}"))?;
    let completed_at = now_iso();
    let updated = conn
        .execute(
            "UPDATE attempts SET completed_at = ?1, score = ?2 WHERE id = ?3",
            params![completed_at, score, attempt_id],
        )
        .map_err(|e| format!("complete_attempt update failed: {e}"))?;
    if updated == 0 {
        return Err(format!("No attempt found with id {attempt_id}"));
    }

    let mut stmt = conn
        .prepare("SELECT id, case_id, started_at, completed_at, score FROM attempts WHERE id = ?1")
        .map_err(|e| format!("complete_attempt select prepare failed: {e}"))?;
    let row = stmt
        .query_row(params![attempt_id], |row| {
            Ok(AttemptRow {
                id: row.get(0)?,
                case_id: row.get(1)?,
                started_at: row.get(2)?,
                completed_at: row.get(3)?,
                score: row.get(4)?,
            })
        })
        .map_err(|e| format!("complete_attempt select failed: {e}"))?;
    Ok(row)
}

#[tauri::command]
pub fn list_attempts(
    state: State<DbState>,
    case_id: Option<String>,
) -> Result<Vec<AttemptRow>, String> {
    let conn = state.conn.lock().map_err(|e| format!("Lock poisoned: {e}"))?;
    let mut out = Vec::new();
    if let Some(case_id) = case_id {
        let mut stmt = conn
            .prepare(
                "SELECT id, case_id, started_at, completed_at, score FROM attempts WHERE case_id = ?1 ORDER BY started_at DESC",
            )
            .map_err(|e| format!("list_attempts prepare failed: {e}"))?;
        let rows = stmt
            .query_map(params![case_id], |row| {
                Ok(AttemptRow {
                    id: row.get(0)?,
                    case_id: row.get(1)?,
                    started_at: row.get(2)?,
                    completed_at: row.get(3)?,
                    score: row.get(4)?,
                })
            })
            .map_err(|e| format!("list_attempts query failed: {e}"))?;
        for row in rows {
            out.push(row.map_err(|e| format!("list_attempts row failed: {e}"))?);
        }
    } else {
        let mut stmt = conn
            .prepare(
                "SELECT id, case_id, started_at, completed_at, score FROM attempts ORDER BY started_at DESC",
            )
            .map_err(|e| format!("list_attempts prepare failed: {e}"))?;
        let rows = stmt
            .query_map([], |row| {
                Ok(AttemptRow {
                    id: row.get(0)?,
                    case_id: row.get(1)?,
                    started_at: row.get(2)?,
                    completed_at: row.get(3)?,
                    score: row.get(4)?,
                })
            })
            .map_err(|e| format!("list_attempts query failed: {e}"))?;
        for row in rows {
            out.push(row.map_err(|e| format!("list_attempts row failed: {e}"))?);
        }
    }
    Ok(out)
}

const SEED_JSON: &str = include_str!("seed/aaa_seed.json");
