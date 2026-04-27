use base64::{engine::general_purpose, Engine as _};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

const SAMPLE_AAA_NRRD: &[u8] = include_bytes!("../../../../content/aaa/volumes/sample-aaa-001.nrrd");

#[derive(Default)]
pub struct VolumeCache {
    volumes: Mutex<HashMap<String, Volume>>,
}

#[derive(Debug, Clone)]
struct Volume {
    id: String,
    source_path: String,
    width: usize,
    height: usize,
    depth: usize,
    spacing: [f32; 3],
    min_hu: i16,
    max_hu: i16,
    voxels: Vec<i16>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VolumeInfo {
    id: String,
    source_path: String,
    dims: [usize; 3],
    spacing: [f32; 3],
    intensity_range: [i16; 2],
    axial_slice_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SliceImage {
    handle_id: String,
    plane: &'static str,
    slice_index: usize,
    width: usize,
    height: usize,
    window_width: f32,
    window_level: f32,
    bytes_base64: String,
}

#[tauri::command]
pub fn volume_load(path: String, cache: State<'_, VolumeCache>) -> Result<VolumeInfo, String> {
    let bytes = read_volume_bytes(&path)?;
    let mut volume = parse_nrrd(&bytes, path.clone())?;
    let id = make_volume_id();
    volume.id = id.clone();

    let info = volume.info();
    let mut volumes = cache
        .volumes
        .lock()
        .map_err(|_| "Volume cache lock was poisoned".to_string())?;
    volumes.insert(id, volume);
    Ok(info)
}

#[tauri::command]
pub fn volume_slice_axial(
    handle_id: String,
    slice_index: usize,
    window_width: f32,
    window_level: f32,
    cache: State<'_, VolumeCache>,
) -> Result<SliceImage, String> {
    let volumes = cache
        .volumes
        .lock()
        .map_err(|_| "Volume cache lock was poisoned".to_string())?;
    let volume = volumes
        .get(&handle_id)
        .ok_or_else(|| format!("Volume handle not found: {handle_id}"))?;

    let z = slice_index.min(volume.depth.saturating_sub(1));
    let mut pixels = Vec::with_capacity(volume.width * volume.height);
    let low = window_level - window_width / 2.0;
    let width = window_width.max(1.0);

    for y in 0..volume.height {
        for x in 0..volume.width {
            let idx = z * volume.width * volume.height + y * volume.width + x;
            let hu = volume.voxels[idx] as f32;
            let gray = (((hu - low) / width) * 255.0).clamp(0.0, 255.0).round() as u8;
            pixels.push(gray);
        }
    }

    Ok(SliceImage {
        handle_id,
        plane: "axial",
        slice_index: z,
        width: volume.width,
        height: volume.height,
        window_width,
        window_level,
        bytes_base64: general_purpose::STANDARD.encode(pixels),
    })
}

#[tauri::command]
pub fn volume_release(handle_id: String, cache: State<'_, VolumeCache>) -> Result<bool, String> {
    let mut volumes = cache
        .volumes
        .lock()
        .map_err(|_| "Volume cache lock was poisoned".to_string())?;
    Ok(volumes.remove(&handle_id).is_some())
}

impl Volume {
    fn info(&self) -> VolumeInfo {
        VolumeInfo {
            id: self.id.clone(),
            source_path: self.source_path.clone(),
            dims: [self.width, self.height, self.depth],
            spacing: self.spacing,
            intensity_range: [self.min_hu, self.max_hu],
            axial_slice_count: self.depth,
        }
    }
}

fn make_volume_id() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    format!("vol-{millis}")
}

fn read_volume_bytes(path: &str) -> Result<Vec<u8>, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() || trimmed == "sample" || trimmed.ends_with("sample-aaa-001.nrrd") {
        if let Some(candidate) = resolve_path(trimmed) {
            return fs::read(&candidate)
                .map_err(|error| format!("Failed to read {}: {error}", candidate.display()));
        }
        return Ok(SAMPLE_AAA_NRRD.to_vec());
    }

    if let Some(candidate) = resolve_path(trimmed) {
        return fs::read(&candidate)
            .map_err(|error| format!("Failed to read {}: {error}", candidate.display()));
    }

    Err(format!(
        "NRRD file not found: {trimmed}. Use an absolute path, a path relative to the project root, or 'sample'."
    ))
}

fn resolve_path(input: &str) -> Option<PathBuf> {
    let input_path = Path::new(input);
    if input_path.is_absolute() && input_path.exists() {
        return Some(input_path.to_path_buf());
    }

    let cwd = std::env::current_dir().ok()?;
    let mut candidates = vec![cwd.join(input_path)];

    let mut cursor = cwd.as_path();
    for _ in 0..6 {
        if let Some(parent) = cursor.parent() {
            candidates.push(parent.join(input_path));
            cursor = parent;
        }
    }

    // Common dev path from apps/desktop/src-tauri to repo-level content folder.
    candidates.push(cwd.join("../../../").join(input_path));

    candidates.into_iter().find(|candidate| candidate.exists())
}

fn parse_nrrd(bytes: &[u8], source_path: String) -> Result<Volume, String> {
    let header_end = find_header_end(bytes).ok_or("Invalid NRRD: missing blank line after header")?;
    let header_text = std::str::from_utf8(&bytes[..header_end])
        .map_err(|_| "Invalid NRRD: header is not UTF-8".to_string())?;
    let data = &bytes[header_end..];

    if !header_text.starts_with("NRRD") {
        return Err("Invalid NRRD: missing NRRD magic header".to_string());
    }

    let fields = parse_header_fields(header_text);
    let dimension = get_field(&fields, "dimension")?.parse::<usize>()
        .map_err(|_| "Invalid NRRD: dimension must be a number".to_string())?;
    if dimension != 3 {
        return Err(format!("Only 3D NRRD volumes are supported in this spike; got dimension {dimension}"));
    }

    let sizes = parse_usize_list(get_field(&fields, "sizes")?)?;
    if sizes.len() != 3 {
        return Err("Invalid NRRD: sizes must contain exactly 3 values".to_string());
    }
    let voxel_count = sizes[0] * sizes[1] * sizes[2];

    let encoding = fields
        .get("encoding")
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_else(|| "raw".to_string());
    let nrrd_type = get_field(&fields, "type")?.to_ascii_lowercase();
    let endian = fields
        .get("endian")
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_else(|| "little".to_string());

    let voxels = match encoding.as_str() {
        "raw" => parse_raw_voxels(data, &nrrd_type, &endian, voxel_count)?,
        "ascii" | "text" | "txt" => parse_ascii_voxels(data, voxel_count)?,
        other => {
            return Err(format!(
                "Unsupported NRRD encoding '{other}'. This spike supports raw and ascii/text only."
            ))
        }
    };

    let min_hu = *voxels.iter().min().unwrap_or(&0);
    let max_hu = *voxels.iter().max().unwrap_or(&0);
    let spacing = parse_spacing(fields.get("space directions").map(String::as_str));

    Ok(Volume {
        id: String::new(),
        source_path,
        width: sizes[0],
        height: sizes[1],
        depth: sizes[2],
        spacing,
        min_hu,
        max_hu,
        voxels,
    })
}

fn find_header_end(bytes: &[u8]) -> Option<usize> {
    for i in 0..bytes.len().saturating_sub(1) {
        if bytes[i] == b'\n' && bytes[i + 1] == b'\n' {
            return Some(i + 2);
        }
        if i + 3 < bytes.len()
            && bytes[i] == b'\r'
            && bytes[i + 1] == b'\n'
            && bytes[i + 2] == b'\r'
            && bytes[i + 3] == b'\n'
        {
            return Some(i + 4);
        }
    }
    None
}

fn parse_header_fields(header: &str) -> HashMap<String, String> {
    let mut fields = HashMap::new();
    for line in header.lines().skip(1) {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((key, value)) = line.split_once(':') {
            fields.insert(key.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }
    fields
}

fn get_field<'a>(fields: &'a HashMap<String, String>, key: &str) -> Result<&'a str, String> {
    fields
        .get(&key.to_ascii_lowercase())
        .map(String::as_str)
        .ok_or_else(|| format!("Invalid NRRD: missing '{key}' field"))
}

fn parse_usize_list(raw: &str) -> Result<Vec<usize>, String> {
    raw.split_whitespace()
        .map(|part| {
            part.parse::<usize>()
                .map_err(|_| format!("Invalid NRRD size value: {part}"))
        })
        .collect()
}

fn parse_raw_voxels(
    data: &[u8],
    nrrd_type: &str,
    endian: &str,
    voxel_count: usize,
) -> Result<Vec<i16>, String> {
    let little = match endian {
        "little" | "littleendian" => true,
        "big" | "bigendian" => false,
        other => return Err(format!("Unsupported endian value '{other}'")),
    };

    let mut voxels = Vec::with_capacity(voxel_count);
    match nrrd_type {
        "signed char" | "int8" | "int8_t" => {
            ensure_len(data, voxel_count, 1)?;
            voxels.extend(data.iter().take(voxel_count).map(|value| *value as i8 as i16));
        }
        "uchar" | "unsigned char" | "uint8" | "uint8_t" => {
            ensure_len(data, voxel_count, 1)?;
            voxels.extend(data.iter().take(voxel_count).map(|value| *value as i16));
        }
        "short" | "short int" | "signed short" | "int16" | "int16_t" => {
            ensure_len(data, voxel_count, 2)?;
            for chunk in data.chunks_exact(2).take(voxel_count) {
                let arr = [chunk[0], chunk[1]];
                voxels.push(if little { i16::from_le_bytes(arr) } else { i16::from_be_bytes(arr) });
            }
        }
        "ushort" | "unsigned short" | "uint16" | "uint16_t" => {
            ensure_len(data, voxel_count, 2)?;
            for chunk in data.chunks_exact(2).take(voxel_count) {
                let arr = [chunk[0], chunk[1]];
                let value = if little { u16::from_le_bytes(arr) } else { u16::from_be_bytes(arr) };
                voxels.push(value.min(i16::MAX as u16) as i16);
            }
        }
        "int" | "signed int" | "int32" | "int32_t" => {
            ensure_len(data, voxel_count, 4)?;
            for chunk in data.chunks_exact(4).take(voxel_count) {
                let arr = [chunk[0], chunk[1], chunk[2], chunk[3]];
                let value = if little { i32::from_le_bytes(arr) } else { i32::from_be_bytes(arr) };
                voxels.push(value.clamp(i16::MIN as i32, i16::MAX as i32) as i16);
            }
        }
        "uint" | "unsigned int" | "uint32" | "uint32_t" => {
            ensure_len(data, voxel_count, 4)?;
            for chunk in data.chunks_exact(4).take(voxel_count) {
                let arr = [chunk[0], chunk[1], chunk[2], chunk[3]];
                let value = if little { u32::from_le_bytes(arr) } else { u32::from_be_bytes(arr) };
                voxels.push(value.min(i16::MAX as u32) as i16);
            }
        }
        other => return Err(format!("Unsupported raw NRRD type '{other}'")),
    }

    if voxels.len() != voxel_count {
        return Err(format!(
            "Invalid NRRD: expected {voxel_count} voxels but decoded {}",
            voxels.len()
        ));
    }

    Ok(voxels)
}

fn parse_ascii_voxels(data: &[u8], voxel_count: usize) -> Result<Vec<i16>, String> {
    let text = std::str::from_utf8(data)
        .map_err(|_| "Invalid NRRD: ASCII data is not valid UTF-8".to_string())?;
    let voxels: Result<Vec<i16>, String> = text
        .split_whitespace()
        .take(voxel_count)
        .map(|part| {
            part.parse::<f32>()
                .map(|value| value.round().clamp(i16::MIN as f32, i16::MAX as f32) as i16)
                .map_err(|_| format!("Invalid ASCII voxel value: {part}"))
        })
        .collect();
    let voxels = voxels?;
    if voxels.len() != voxel_count {
        return Err(format!(
            "Invalid NRRD: expected {voxel_count} voxels but decoded {}",
            voxels.len()
        ));
    }
    Ok(voxels)
}

fn ensure_len(data: &[u8], voxel_count: usize, bytes_per_voxel: usize) -> Result<(), String> {
    let required = voxel_count * bytes_per_voxel;
    if data.len() < required {
        return Err(format!(
            "Invalid NRRD: data too short, expected at least {required} bytes but found {}",
            data.len()
        ));
    }
    Ok(())
}

fn parse_spacing(space_directions: Option<&str>) -> [f32; 3] {
    let Some(raw) = space_directions else {
        return [1.0, 1.0, 1.0];
    };

    let vectors: Vec<[f32; 3]> = raw
        .split(')')
        .filter_map(|part| {
            let start = part.find('(')?;
            let nums: Vec<f32> = part[start + 1..]
                .split(',')
                .filter_map(|value| value.trim().parse::<f32>().ok())
                .collect();
            if nums.len() == 3 {
                Some([nums[0], nums[1], nums[2]])
            } else {
                None
            }
        })
        .collect();

    if vectors.len() != 3 {
        return [1.0, 1.0, 1.0];
    }

    [
        vector_length(vectors[0]),
        vector_length(vectors[1]),
        vector_length(vectors[2]),
    ]
}

fn vector_length(vector: [f32; 3]) -> f32 {
    (vector[0] * vector[0] + vector[1] * vector[1] + vector[2] * vector[2]).sqrt()
}
