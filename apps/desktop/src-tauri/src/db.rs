use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
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
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| format!("Cannot enable foreign keys: {e}"))?;
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

// ---------------------------------------------------------------------------
// Admin authoring commands (v0.7)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminCaseInput {
    pub slug: String,
    pub title: String,
    pub summary: String,
    pub category: String,
    pub volume_path: Option<String>,
    /// Extended payload (patient, learning objectives, tags, etc.). When omitted on
    /// create we generate a minimal default; on update we merge into the existing blob.
    pub data: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminQuestionInput {
    pub r#type: String,
    pub prompt: String,
    /// Type-specific payload (choices, correctValue, plane, tolerance, explanation, points, hints, …).
    pub data: Value,
    pub order_index: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaseWithQuestions {
    #[serde(flatten)]
    pub case: CaseRow,
    pub questions: Vec<QuestionRow>,
}

/// Ensure `data.volume.path` and `data.categoryId` mirror the row-level columns so the
/// frontend reconstruction (which prefers nested values) stays consistent with the DB.
fn merge_case_data(mut data: Value, volume_path: &Option<String>, category: &str) -> Value {
    if !data.is_object() {
        data = serde_json::json!({});
    }
    if let Some(obj) = data.as_object_mut() {
        // categoryId mirrors the top-level category column.
        obj.insert("categoryId".to_string(), Value::String(category.to_string()));

        // Ensure a volume object exists; sync its path with volume_path.
        let volume_entry = obj
            .entry("volume".to_string())
            .or_insert_with(|| {
                serde_json::json!({
                    "type": "nrrd",
                    "path": Value::Null,
                    "description": ""
                })
            });
        if let Some(vobj) = volume_entry.as_object_mut() {
            let path_val = match volume_path {
                Some(p) if !p.is_empty() => Value::String(p.clone()),
                _ => Value::Null,
            };
            vobj.insert("path".to_string(), path_val);
            vobj.entry("type".to_string())
                .or_insert_with(|| Value::String("nrrd".to_string()));
            vobj.entry("description".to_string())
                .or_insert_with(|| Value::String(String::new()));
        }
    }
    data
}

fn fetch_case_row(conn: &Connection, case_id: &str) -> Result<CaseRow, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, slug, title, summary, category, volume_path, data_json FROM cases WHERE id = ?1",
        )
        .map_err(|e| format!("fetch_case_row prepare failed: {e}"))?;
    let row = stmt
        .query_row(params![case_id], |row| {
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
        .map_err(|e| format!("fetch_case_row query failed: {e}"))?;
    parse_case_row(row.0, row.1, row.2, row.3, row.4, row.5, row.6)
}

fn fetch_question_row(conn: &Connection, question_id: &str) -> Result<QuestionRow, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, case_id, order_index, type, prompt, data_json FROM questions WHERE id = ?1",
        )
        .map_err(|e| format!("fetch_question_row prepare failed: {e}"))?;
    let row = stmt
        .query_row(params![question_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
            ))
        })
        .map_err(|e| format!("fetch_question_row query failed: {e}"))?;
    parse_question_row(row.0, row.1, row.2, row.3, row.4, row.5)
}

#[tauri::command]
pub fn admin_list_cases(state: State<DbState>) -> Result<Vec<CaseRow>, String> {
    list_cases(state)
}

#[tauri::command]
pub fn admin_get_case_with_questions(
    state: State<DbState>,
    case_id: String,
) -> Result<Option<CaseWithQuestions>, String> {
    let conn = state.conn.lock().map_err(|e| format!("Lock poisoned: {e}"))?;

    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM cases WHERE id = ?1",
            params![case_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("admin_get_case_with_questions exists check failed: {e}"))?;
    if exists == 0 {
        return Ok(None);
    }
    let case = fetch_case_row(&conn, &case_id)?;

    let mut stmt = conn
        .prepare(
            "SELECT id, case_id, order_index, type, prompt, data_json FROM questions WHERE case_id = ?1 ORDER BY order_index",
        )
        .map_err(|e| format!("admin_get_case_with_questions prepare failed: {e}"))?;
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
        .map_err(|e| format!("admin_get_case_with_questions query failed: {e}"))?;

    let mut questions = Vec::new();
    for row in rows {
        let (id, case_id, order_index, qtype, prompt, data_json) =
            row.map_err(|e| format!("admin_get_case_with_questions row failed: {e}"))?;
        questions.push(parse_question_row(id, case_id, order_index, qtype, prompt, data_json)?);
    }
    Ok(Some(CaseWithQuestions { case, questions }))
}

#[tauri::command]
pub fn admin_create_case(state: State<DbState>, input: AdminCaseInput) -> Result<CaseRow, String> {
    let conn = state.conn.lock().map_err(|e| format!("Lock poisoned: {e}"))?;
    let id = Uuid::new_v4().to_string();
    let data = merge_case_data(
        input.data.unwrap_or_else(|| serde_json::json!({})),
        &input.volume_path,
        &input.category,
    );
    let data_json = data.to_string();
    conn.execute(
        "INSERT INTO cases (id, slug, title, summary, category, volume_path, data_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, input.slug, input.title, input.summary, input.category, input.volume_path, data_json],
    )
    .map_err(|e| format!("admin_create_case insert failed: {e}"))?;
    fetch_case_row(&conn, &id)
}

#[tauri::command]
pub fn admin_update_case(
    state: State<DbState>,
    case_id: String,
    input: AdminCaseInput,
) -> Result<CaseRow, String> {
    let conn = state.conn.lock().map_err(|e| format!("Lock poisoned: {e}"))?;

    // If caller didn't supply data, preserve the existing blob and only patch the
    // mirrored volume.path / categoryId fields.
    let base_data = match input.data {
        Some(d) => d,
        None => {
            let mut stmt = conn
                .prepare("SELECT data_json FROM cases WHERE id = ?1")
                .map_err(|e| format!("admin_update_case prepare failed: {e}"))?;
            let data_json: String = stmt
                .query_row(params![case_id], |row| row.get::<_, String>(0))
                .map_err(|e| format!("admin_update_case existing data fetch failed: {e}"))?;
            serde_json::from_str(&data_json).unwrap_or_else(|_| serde_json::json!({}))
        }
    };
    let data = merge_case_data(base_data, &input.volume_path, &input.category);
    let data_json = data.to_string();

    let updated = conn
        .execute(
            "UPDATE cases SET slug = ?1, title = ?2, summary = ?3, category = ?4, volume_path = ?5, data_json = ?6 WHERE id = ?7",
            params![input.slug, input.title, input.summary, input.category, input.volume_path, data_json, case_id],
        )
        .map_err(|e| format!("admin_update_case update failed: {e}"))?;
    if updated == 0 {
        return Err(format!("No case found with id {case_id}"));
    }
    fetch_case_row(&conn, &case_id)
}

#[tauri::command]
pub fn admin_delete_case(state: State<DbState>, case_id: String) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| format!("Lock poisoned: {e}"))?;
    // Manual cascade so this works even if foreign_keys pragma was missed.
    conn.execute("DELETE FROM question_responses WHERE attempt_id IN (SELECT id FROM attempts WHERE case_id = ?1)", params![case_id])
        .map_err(|e| format!("admin_delete_case responses failed: {e}"))?;
    conn.execute("DELETE FROM attempts WHERE case_id = ?1", params![case_id])
        .map_err(|e| format!("admin_delete_case attempts failed: {e}"))?;
    conn.execute("DELETE FROM questions WHERE case_id = ?1", params![case_id])
        .map_err(|e| format!("admin_delete_case questions failed: {e}"))?;
    let removed = conn
        .execute("DELETE FROM cases WHERE id = ?1", params![case_id])
        .map_err(|e| format!("admin_delete_case case failed: {e}"))?;
    if removed == 0 {
        return Err(format!("No case found with id {case_id}"));
    }
    Ok(())
}

fn next_question_order_index(conn: &Connection, case_id: &str) -> Result<i64, String> {
    let mut stmt = conn
        .prepare("SELECT COALESCE(MAX(order_index), -1) + 1 FROM questions WHERE case_id = ?1")
        .map_err(|e| format!("next_question_order_index prepare failed: {e}"))?;
    let next: i64 = stmt
        .query_row(params![case_id], |row| row.get::<_, i64>(0))
        .map_err(|e| format!("next_question_order_index query failed: {e}"))?;
    Ok(next)
}

#[tauri::command]
pub fn admin_create_question(
    state: State<DbState>,
    case_id: String,
    input: AdminQuestionInput,
) -> Result<QuestionRow, String> {
    let conn = state.conn.lock().map_err(|e| format!("Lock poisoned: {e}"))?;
    let id = Uuid::new_v4().to_string();
    let order_index = match input.order_index {
        Some(i) => i,
        None => next_question_order_index(&conn, &case_id)?,
    };
    let data_json = input.data.to_string();
    conn.execute(
        "INSERT INTO questions (id, case_id, order_index, type, prompt, data_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, case_id, order_index, input.r#type, input.prompt, data_json],
    )
    .map_err(|e| format!("admin_create_question insert failed: {e}"))?;
    fetch_question_row(&conn, &id)
}

#[tauri::command]
pub fn admin_update_question(
    state: State<DbState>,
    question_id: String,
    input: AdminQuestionInput,
) -> Result<QuestionRow, String> {
    let conn = state.conn.lock().map_err(|e| format!("Lock poisoned: {e}"))?;
    let data_json = input.data.to_string();

    let updated = if let Some(order_index) = input.order_index {
        conn.execute(
            "UPDATE questions SET type = ?1, prompt = ?2, data_json = ?3, order_index = ?4 WHERE id = ?5",
            params![input.r#type, input.prompt, data_json, order_index, question_id],
        )
    } else {
        conn.execute(
            "UPDATE questions SET type = ?1, prompt = ?2, data_json = ?3 WHERE id = ?4",
            params![input.r#type, input.prompt, data_json, question_id],
        )
    }
    .map_err(|e| format!("admin_update_question update failed: {e}"))?;
    if updated == 0 {
        return Err(format!("No question found with id {question_id}"));
    }
    fetch_question_row(&conn, &question_id)
}

#[tauri::command]
pub fn admin_delete_question(state: State<DbState>, question_id: String) -> Result<(), String> {
    let conn = state.conn.lock().map_err(|e| format!("Lock poisoned: {e}"))?;
    let removed = conn
        .execute("DELETE FROM questions WHERE id = ?1", params![question_id])
        .map_err(|e| format!("admin_delete_question failed: {e}"))?;
    if removed == 0 {
        return Err(format!("No question found with id {question_id}"));
    }
    Ok(())
}

#[tauri::command]
pub fn admin_reorder_questions(
    state: State<DbState>,
    case_id: String,
    ordered_question_ids: Vec<String>,
) -> Result<(), String> {
    let mut conn = state.conn.lock().map_err(|e| format!("Lock poisoned: {e}"))?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("admin_reorder_questions begin failed: {e}"))?;

    // Two-phase update keeps the (case_id, order_index) values unique even though there
    // is no explicit UNIQUE constraint, and guards against partial reorderings.
    for (index, qid) in ordered_question_ids.iter().enumerate() {
        let bumped = -1 - index as i64;
        let updated = tx
            .execute(
                "UPDATE questions SET order_index = ?1 WHERE id = ?2 AND case_id = ?3",
                params![bumped, qid, case_id],
            )
            .map_err(|e| format!("admin_reorder_questions phase1 failed: {e}"))?;
        if updated == 0 {
            return Err(format!(
                "Question {qid} does not belong to case {case_id} (or was deleted)"
            ));
        }
    }
    for (index, qid) in ordered_question_ids.iter().enumerate() {
        tx.execute(
            "UPDATE questions SET order_index = ?1 WHERE id = ?2 AND case_id = ?3",
            params![index as i64, qid, case_id],
        )
        .map_err(|e| format!("admin_reorder_questions phase2 failed: {e}"))?;
    }

    tx.commit()
        .map_err(|e| format!("admin_reorder_questions commit failed: {e}"))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Progress + attempt review (v0.8)
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressSummary {
    pub total_attempts: i64,
    pub completed_attempts: i64,
    pub cases_completed: i64,
    pub total_questions_answered: i64,
    pub correct_answers: i64,
    pub accuracy_percent: f64,
    pub average_score: f64,
    pub best_score: f64,
    pub average_percent: f64,
    pub best_percent: f64,
    pub measurement_questions_answered: i64,
    pub average_measurement_error: Option<f64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaseProgress {
    pub case_id: String,
    pub case_title: String,
    pub category: String,
    pub max_score: f64,
    pub attempts: i64,
    pub completed: i64,
    pub best_score: Option<f64>,
    pub latest_score: Option<f64>,
    pub average_score: Option<f64>,
    pub best_percent: Option<f64>,
    pub latest_percent: Option<f64>,
    pub average_percent: Option<f64>,
    pub last_attempt_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttemptSummary {
    pub id: String,
    pub case_id: String,
    pub case_title: String,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub score: Option<f64>,
    pub max_score: f64,
    pub percent: Option<f64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeasurementDetail {
    pub plane: String,
    pub unit: String,
    pub correct_value: f64,
    pub tolerance: f64,
    pub submitted_value: Option<f64>,
    pub difference: Option<f64>,
    pub within_tolerance: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttemptQuestionDetail {
    pub response_id: Option<String>,
    pub question_id: String,
    pub order_index: i64,
    pub r#type: String,
    pub prompt: String,
    pub points: f64,
    /// Full question data_json so the frontend can render expected answers etc.
    pub question_data: Value,
    /// The submitted answer (parsed JSON). `Value::Null` if the learner skipped this one.
    pub answer: Value,
    pub is_correct: Option<bool>,
    pub submitted_at: Option<String>,
    /// Pre-computed comparison for measurement questions (mirrors the training feedback box).
    pub measurement: Option<MeasurementDetail>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttemptDetails {
    pub attempt: AttemptSummary,
    pub questions: Vec<AttemptQuestionDetail>,
}

struct QuestionMeta {
    case_id: String,
    qtype: String,
    points: f64,
    data: Value,
}

fn load_questions_meta(conn: &Connection) -> Result<HashMap<String, QuestionMeta>, String> {
    let mut stmt = conn
        .prepare("SELECT id, case_id, type, data_json FROM questions")
        .map_err(|e| format!("load_questions_meta prepare failed: {e}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(|e| format!("load_questions_meta query failed: {e}"))?;

    let mut map = HashMap::new();
    for r in rows {
        let (id, case_id, qtype, data_json) =
            r.map_err(|e| format!("load_questions_meta row failed: {e}"))?;
        let data: Value = serde_json::from_str(&data_json).unwrap_or(Value::Null);
        let points = data.get("points").and_then(Value::as_f64).unwrap_or(1.0);
        map.insert(
            id,
            QuestionMeta {
                case_id,
                qtype,
                points,
                data,
            },
        );
    }
    Ok(map)
}

/// Sum of `points` across all questions in each case.
fn case_max_scores_from(meta: &HashMap<String, QuestionMeta>) -> HashMap<String, f64> {
    let mut map: HashMap<String, f64> = HashMap::new();
    for q in meta.values() {
        *map.entry(q.case_id.clone()).or_insert(0.0) += q.points;
    }
    map
}

fn percent_of(score: f64, max: f64) -> Option<f64> {
    if max > 0.0 {
        Some(100.0 * score / max)
    } else {
        None
    }
}

fn build_measurement_detail(question_data: &Value, answer: &Value) -> Option<MeasurementDetail> {
    let plane = question_data
        .get("plane")
        .and_then(Value::as_str)
        .unwrap_or("axial")
        .to_string();
    let unit = question_data
        .get("unit")
        .and_then(Value::as_str)
        .unwrap_or("mm")
        .to_string();
    let correct_value = question_data.get("correctValue").and_then(Value::as_f64)?;
    let tolerance = question_data
        .get("tolerance")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let submitted_value = answer.as_f64();
    let difference = submitted_value.map(|v| (v - correct_value).abs());
    let within_tolerance = difference.map(|d| d <= tolerance);
    Some(MeasurementDetail {
        plane,
        unit,
        correct_value,
        tolerance,
        submitted_value,
        difference,
        within_tolerance,
    })
}

#[tauri::command]
pub fn progress_summary(state: State<DbState>) -> Result<ProgressSummary, String> {
    let conn = state.conn.lock().map_err(|e| format!("Lock poisoned: {e}"))?;

    let total_attempts: i64 = conn
        .query_row("SELECT COUNT(*) FROM attempts", [], |r| r.get(0))
        .map_err(|e| format!("progress_summary count attempts failed: {e}"))?;
    let completed_attempts: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM attempts WHERE completed_at IS NOT NULL",
            [],
            |r| r.get(0),
        )
        .map_err(|e| format!("progress_summary completed count failed: {e}"))?;
    let cases_completed: i64 = conn
        .query_row(
            "SELECT COUNT(DISTINCT case_id) FROM attempts WHERE completed_at IS NOT NULL",
            [],
            |r| r.get(0),
        )
        .map_err(|e| format!("progress_summary distinct cases failed: {e}"))?;

    let total_responses: i64 = conn
        .query_row("SELECT COUNT(*) FROM question_responses", [], |r| r.get(0))
        .map_err(|e| format!("progress_summary count responses failed: {e}"))?;
    let correct_responses: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM question_responses WHERE is_correct = 1",
            [],
            |r| r.get(0),
        )
        .map_err(|e| format!("progress_summary correct responses failed: {e}"))?;

    let accuracy_percent = if total_responses > 0 {
        100.0 * correct_responses as f64 / total_responses as f64
    } else {
        0.0
    };

    let questions_meta = load_questions_meta(&conn)?;
    let max_scores = case_max_scores_from(&questions_meta);

    let mut completed_scores: Vec<f64> = Vec::new();
    let mut completed_percents: Vec<f64> = Vec::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT case_id, score FROM attempts WHERE completed_at IS NOT NULL AND score IS NOT NULL",
            )
            .map_err(|e| format!("progress_summary scores prepare failed: {e}"))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?))
            })
            .map_err(|e| format!("progress_summary scores query failed: {e}"))?;
        for r in rows {
            let (case_id, score) = r.map_err(|e| format!("progress_summary scores row failed: {e}"))?;
            completed_scores.push(score);
            if let Some(max) = max_scores.get(&case_id).copied() {
                if let Some(p) = percent_of(score, max) {
                    completed_percents.push(p);
                }
            }
        }
    }
    let average_score = if !completed_scores.is_empty() {
        completed_scores.iter().sum::<f64>() / completed_scores.len() as f64
    } else {
        0.0
    };
    let best_score = completed_scores.iter().cloned().fold(0.0_f64, f64::max);
    let average_percent = if !completed_percents.is_empty() {
        completed_percents.iter().sum::<f64>() / completed_percents.len() as f64
    } else {
        0.0
    };
    let best_percent = completed_percents.iter().cloned().fold(0.0_f64, f64::max);

    // Measurement-specific aggregation: walk responses for measurement questions.
    let mut measurement_questions_answered: i64 = 0;
    let mut measurement_errors: Vec<f64> = Vec::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT question_id, answer_json FROM question_responses",
            )
            .map_err(|e| format!("progress_summary measurement prepare failed: {e}"))?;
        let rows = stmt
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
            .map_err(|e| format!("progress_summary measurement query failed: {e}"))?;
        for r in rows {
            let (qid, answer_json) =
                r.map_err(|e| format!("progress_summary measurement row failed: {e}"))?;
            let Some(meta) = questions_meta.get(&qid) else { continue };
            if meta.qtype != "measurement" {
                continue;
            }
            measurement_questions_answered += 1;
            let answer: Value = serde_json::from_str(&answer_json).unwrap_or(Value::Null);
            if let (Some(expected), Some(submitted)) = (
                meta.data.get("correctValue").and_then(Value::as_f64),
                answer.as_f64(),
            ) {
                measurement_errors.push((submitted - expected).abs());
            }
        }
    }
    let average_measurement_error = if !measurement_errors.is_empty() {
        Some(measurement_errors.iter().sum::<f64>() / measurement_errors.len() as f64)
    } else {
        None
    };

    Ok(ProgressSummary {
        total_attempts,
        completed_attempts,
        cases_completed,
        total_questions_answered: total_responses,
        correct_answers: correct_responses,
        accuracy_percent,
        average_score,
        best_score,
        average_percent,
        best_percent,
        measurement_questions_answered,
        average_measurement_error,
    })
}

#[tauri::command]
pub fn progress_by_case(state: State<DbState>) -> Result<Vec<CaseProgress>, String> {
    let conn = state.conn.lock().map_err(|e| format!("Lock poisoned: {e}"))?;
    let questions_meta = load_questions_meta(&conn)?;
    let max_scores = case_max_scores_from(&questions_meta);

    // Pull all attempts joined with case info.
    let mut stmt = conn
        .prepare(
            r#"
            SELECT a.case_id, c.title, c.category, a.started_at, a.completed_at, a.score
            FROM attempts a
            INNER JOIN cases c ON c.id = a.case_id
            ORDER BY a.case_id ASC, a.started_at DESC
            "#,
        )
        .map_err(|e| format!("progress_by_case prepare failed: {e}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<f64>>(5)?,
            ))
        })
        .map_err(|e| format!("progress_by_case query failed: {e}"))?;

    struct Bucket {
        case_id: String,
        case_title: String,
        category: String,
        max_score: f64,
        attempts: i64,
        completed: i64,
        best_score: Option<f64>,
        latest_score: Option<f64>,
        scores: Vec<f64>,
        last_attempt_at: Option<String>,
    }
    let mut buckets: HashMap<String, Bucket> = HashMap::new();

    for r in rows {
        let (case_id, title, category, started_at, completed_at, score) =
            r.map_err(|e| format!("progress_by_case row failed: {e}"))?;
        let max_score = max_scores.get(&case_id).copied().unwrap_or(0.0);
        let bucket = buckets.entry(case_id.clone()).or_insert_with(|| Bucket {
            case_id: case_id.clone(),
            case_title: title,
            category,
            max_score,
            attempts: 0,
            completed: 0,
            best_score: None,
            latest_score: None,
            scores: Vec::new(),
            last_attempt_at: None,
        });
        bucket.attempts += 1;
        // Rows are ordered by started_at DESC, so the first row we see per case is the latest.
        if bucket.last_attempt_at.is_none() {
            bucket.last_attempt_at = Some(started_at);
            bucket.latest_score = score;
        }
        if completed_at.is_some() {
            bucket.completed += 1;
        }
        if let Some(s) = score {
            bucket.scores.push(s);
            bucket.best_score = Some(bucket.best_score.map_or(s, |b| b.max(s)));
        }
    }

    let mut out: Vec<CaseProgress> = buckets
        .into_values()
        .map(|b| {
            let average_score = if !b.scores.is_empty() {
                Some(b.scores.iter().sum::<f64>() / b.scores.len() as f64)
            } else {
                None
            };
            let best_percent = b.best_score.and_then(|s| percent_of(s, b.max_score));
            let latest_percent = b.latest_score.and_then(|s| percent_of(s, b.max_score));
            let average_percent = average_score.and_then(|s| percent_of(s, b.max_score));
            CaseProgress {
                case_id: b.case_id,
                case_title: b.case_title,
                category: b.category,
                max_score: b.max_score,
                attempts: b.attempts,
                completed: b.completed,
                best_score: b.best_score,
                latest_score: b.latest_score,
                average_score,
                best_percent,
                latest_percent,
                average_percent,
                last_attempt_at: b.last_attempt_at,
            }
        })
        .collect();

    out.sort_by(|a, b| b.last_attempt_at.cmp(&a.last_attempt_at));
    Ok(out)
}

#[tauri::command]
pub fn get_recent_activity(
    state: State<DbState>,
    limit: Option<i64>,
) -> Result<Vec<AttemptSummary>, String> {
    let conn = state.conn.lock().map_err(|e| format!("Lock poisoned: {e}"))?;
    let limit = limit.unwrap_or(10).clamp(1, 200);
    let questions_meta = load_questions_meta(&conn)?;
    let max_scores = case_max_scores_from(&questions_meta);

    let mut stmt = conn
        .prepare(
            r#"
            SELECT a.id, a.case_id, c.title, a.started_at, a.completed_at, a.score
            FROM attempts a
            INNER JOIN cases c ON c.id = a.case_id
            ORDER BY a.started_at DESC
            LIMIT ?1
            "#,
        )
        .map_err(|e| format!("get_recent_activity prepare failed: {e}"))?;
    let rows = stmt
        .query_map(params![limit], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<f64>>(5)?,
            ))
        })
        .map_err(|e| format!("get_recent_activity query failed: {e}"))?;

    let mut out = Vec::new();
    for r in rows {
        let (id, case_id, case_title, started_at, completed_at, score) =
            r.map_err(|e| format!("get_recent_activity row failed: {e}"))?;
        let max_score = max_scores.get(&case_id).copied().unwrap_or(0.0);
        let percent = score.and_then(|s| percent_of(s, max_score));
        out.push(AttemptSummary {
            id,
            case_id,
            case_title,
            started_at,
            completed_at,
            score,
            max_score,
            percent,
        });
    }
    Ok(out)
}

#[tauri::command]
pub fn get_attempt_details(
    state: State<DbState>,
    attempt_id: String,
) -> Result<Option<AttemptDetails>, String> {
    let conn = state.conn.lock().map_err(|e| format!("Lock poisoned: {e}"))?;

    let attempt_row = conn
        .query_row(
            r#"
            SELECT a.id, a.case_id, c.title, a.started_at, a.completed_at, a.score
            FROM attempts a
            INNER JOIN cases c ON c.id = a.case_id
            WHERE a.id = ?1
            LIMIT 1
            "#,
            params![attempt_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<f64>>(5)?,
                ))
            },
        )
        .ok();
    let Some((id, case_id, case_title, started_at, completed_at, score)) = attempt_row else {
        return Ok(None);
    };

    let questions_meta = load_questions_meta(&conn)?;
    let max_score = case_max_scores_from(&questions_meta)
        .get(&case_id)
        .copied()
        .unwrap_or(0.0);
    let percent = score.and_then(|s| percent_of(s, max_score));

    let attempt = AttemptSummary {
        id: id.clone(),
        case_id: case_id.clone(),
        case_title,
        started_at,
        completed_at,
        score,
        max_score,
        percent,
    };

    // Map question_id → response row (latest if duplicates).
    let mut response_map: HashMap<String, (String, Value, bool, String)> = HashMap::new();
    {
        let mut stmt = conn
            .prepare(
                "SELECT id, question_id, answer_json, is_correct, submitted_at FROM question_responses WHERE attempt_id = ?1 ORDER BY submitted_at ASC",
            )
            .map_err(|e| format!("get_attempt_details responses prepare failed: {e}"))?;
        let rows = stmt
            .query_map(params![id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, String>(4)?,
                ))
            })
            .map_err(|e| format!("get_attempt_details responses query failed: {e}"))?;
        for r in rows {
            let (response_id, qid, answer_json, is_correct, submitted_at) =
                r.map_err(|e| format!("get_attempt_details responses row failed: {e}"))?;
            let answer: Value = serde_json::from_str(&answer_json).unwrap_or(Value::Null);
            // Last write wins (rows are ordered ascending by submitted_at).
            response_map.insert(
                qid,
                (response_id, answer, is_correct != 0, submitted_at),
            );
        }
    }

    // Fetch the case's questions in order so the review respects authoring order even
    // when the learner skipped some or didn't reach the end.
    let mut stmt = conn
        .prepare(
            "SELECT id, order_index, type, prompt, data_json FROM questions WHERE case_id = ?1 ORDER BY order_index",
        )
        .map_err(|e| format!("get_attempt_details questions prepare failed: {e}"))?;
    let q_rows = stmt
        .query_map(params![case_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        })
        .map_err(|e| format!("get_attempt_details questions query failed: {e}"))?;

    let mut questions: Vec<AttemptQuestionDetail> = Vec::new();
    for r in q_rows {
        let (qid, order_index, qtype, prompt, data_json) =
            r.map_err(|e| format!("get_attempt_details questions row failed: {e}"))?;
        let question_data: Value = serde_json::from_str(&data_json).unwrap_or(Value::Null);
        let points = question_data
            .get("points")
            .and_then(Value::as_f64)
            .unwrap_or(1.0);
        let response = response_map.remove(&qid);
        let (response_id, answer, is_correct, submitted_at) = match response {
            Some((rid, ans, ok, ts)) => (Some(rid), ans, Some(ok), Some(ts)),
            None => (None, Value::Null, None, None),
        };
        let measurement = if qtype == "measurement" {
            build_measurement_detail(&question_data, &answer)
        } else {
            None
        };
        questions.push(AttemptQuestionDetail {
            response_id,
            question_id: qid,
            order_index,
            r#type: qtype,
            prompt,
            points,
            question_data,
            answer,
            is_correct,
            submitted_at,
            measurement,
        });
    }

    Ok(Some(AttemptDetails { attempt, questions }))
}
