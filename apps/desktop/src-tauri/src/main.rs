mod volume;

use serde::Serialize;
use volume::{volume_load, volume_release, volume_slice, volume_slice_axial, VolumeCache};

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
        .invoke_handler(tauri::generate_handler![
            app_info,
            validate_content_pack,
            volume_load,
            volume_slice,
            volume_slice_axial,
            volume_release
        ])
        .run(tauri::generate_context!())
        .expect("error while running VascEdu desktop app");
}
