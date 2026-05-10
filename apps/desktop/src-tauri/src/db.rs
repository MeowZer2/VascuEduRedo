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
