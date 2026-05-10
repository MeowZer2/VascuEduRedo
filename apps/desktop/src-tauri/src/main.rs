mod db;
mod volume;

use db::{
    admin_create_case, admin_create_question, admin_delete_case, admin_delete_question,
    admin_get_case_with_questions, admin_list_cases, admin_reorder_questions, admin_update_case,
    admin_update_question, complete_attempt, create_attempt, get_attempt_details, get_case,
    get_case_questions, get_recent_activity, list_attempts, list_cases, open_and_initialize,
    progress_by_case, progress_summary, submit_question_response, DbState,
};
use serde::Serialize;
use tauri::Manager;
use volume::{
    volume_load, volume_release, volume_sample, volume_slice, volume_slice_axial, VolumeCache,
};

#[derive(Serialize)]
struct AppInfo {
    name: &'static str,
    version: &'static str,
    backend: &'static str,
}

#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        name: "VascEdu",
        version: "0.1.0",
        backend: "Tauri/Rust command bridge active",
    }
}

#[tauri::command]
fn validate_content_pack(raw_json: String) -> Result<bool, String> {
    serde_json::from_str::<serde_json::Value>(&raw_json)
        .map(|_| true)
        .map_err(|error| format!("Invalid JSON: {error}"))
}

fn main() {
    tauri::Builder::default()
        .manage(VolumeCache::default())
        .setup(|app| {
            let conn = open_and_initialize(&app.handle())
                .map_err(|e| format!("Failed to initialize SQLite database: {e}"))?;
            app.manage(DbState::new(conn));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            validate_content_pack,
            volume_load,
            volume_sample,
            volume_slice,
            volume_slice_axial,
            volume_release,
            list_cases,
            get_case,
            get_case_questions,
            create_attempt,
            submit_question_response,
            complete_attempt,
            list_attempts,
            admin_list_cases,
            admin_get_case_with_questions,
            admin_create_case,
            admin_update_case,
            admin_delete_case,
            admin_create_question,
            admin_update_question,
            admin_delete_question,
            admin_reorder_questions,
            progress_summary,
            progress_by_case,
            get_recent_activity,
            get_attempt_details
        ])
        .run(tauri::generate_context!())
        .expect("error while running VascEdu desktop app");
}
