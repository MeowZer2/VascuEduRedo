mod db;
mod volume;

use db::{
    admin_create_case, admin_create_device, admin_create_question, admin_delete_case,
    admin_delete_device, admin_delete_question, admin_export_case, admin_get_case_with_questions,
    admin_import_case, admin_list_cases, admin_reorder_questions, admin_update_case,
    admin_update_device, admin_update_question, admin_validate_case, admin_validate_case_payload,
    complete_attempt, create_attempt, delete_case_bookmark, get_attempt_details, get_case,
    export_app_backup, get_case_questions, get_device, get_recent_activity, get_vessel_composition,
    list_attempts, list_case_bookmarks, list_cases, list_device_categories, list_devices,
    list_vessel_compositions, open_and_initialize, progress_by_case, progress_summary,
    reassign_attempts_profile, reorder_case_bookmarks,
    save_case_bookmark, save_vessel_composition, submit_question_response, DbState,
};
use serde::Serialize;
use tauri::Manager;
use volume::{
    dicom_discover_folder, volume_load, volume_load_dicom_series, volume_release, volume_sample,
    volume_slice, volume_slice_axial, volume_slice_raw, VolumeCache,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    name: &'static str,
    version: &'static str,
    backend: &'static str,
    build: &'static str,
    data_location: Option<String>,
}

#[tauri::command]
fn app_info(app: tauri::AppHandle) -> AppInfo {
    let data_location = app
        .path()
        .app_data_dir()
        .ok()
        .map(|path| path.display().to_string());
    AppInfo {
        name: "VascEdu",
        version: env!("CARGO_PKG_VERSION"),
        backend: "Tauri/Rust command bridge active",
        build: "local desktop",
        data_location,
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
        .plugin(tauri_plugin_dialog::init())
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
            export_app_backup,
            dicom_discover_folder,
            volume_load,
            volume_load_dicom_series,
            volume_sample,
            volume_slice,
            volume_slice_raw,
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
            get_attempt_details,
            reassign_attempts_profile,
            admin_validate_case,
            admin_validate_case_payload,
            admin_export_case,
            admin_import_case,
            list_devices,
            get_device,
            list_device_categories,
            admin_create_device,
            admin_update_device,
            admin_delete_device,
            list_vessel_compositions,
            get_vessel_composition,
            save_vessel_composition,
            list_case_bookmarks,
            save_case_bookmark,
            delete_case_bookmark,
            reorder_case_bookmarks
        ])
        .run(tauri::generate_context!())
        .expect("error while running VascEdu desktop app");
}
