use base64::{engine::general_purpose, Engine as _};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

const SAMPLE_AAA_NRRD: &[u8] =
    include_bytes!("../../../../content/aaa/volumes/sample-aaa-001.nrrd");

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
    handle_id: String,
    source_path: String,
    dims: [usize; 3],
    spacing: [f32; 3],
    intensity_min: i16,
    intensity_max: i16,
    plane_slice_ranges: PlaneSliceRanges,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaneSliceRanges {
    axial: SliceRange,
    coronal: SliceRange,
    sagittal: SliceRange,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SliceRange {
    min: usize,
    max: usize,
    count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SliceImage {
    handle_id: String,
    plane: String,
    slice_index: usize,
    width: usize,
    height: usize,
    window_width: f32,
    window_level: f32,
    pixels_base64: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Plane {
    Axial,
    Coronal,
    Sagittal,
}

impl Plane {
    fn parse(raw: &str) -> Result<Self, String> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "axial" => Ok(Self::Axial),
            "coronal" => Ok(Self::Coronal),
            "sagittal" => Ok(Self::Sagittal),
            other => Err(format!(
                "Unsupported MPR plane '{other}'. Expected axial, coronal, or sagittal."
            )),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Axial => "axial",
            Self::Coronal => "coronal",
            Self::Sagittal => "sagittal",
        }
    }

    fn image_size(self, volume: &Volume) -> (usize, usize) {
        match self {
            Self::Axial => (volume.width, volume.height),
            Self::Coronal => (volume.width, volume.depth),
            Self::Sagittal => (volume.height, volume.depth),
        }
    }

    fn slice_count(self, volume: &Volume) -> usize {
        match self {
            Self::Axial => volume.depth,
            Self::Coronal => volume.height,
            Self::Sagittal => volume.width,
        }
    }
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
pub fn volume_slice(
    handle_id: String,
    plane: String,
    slice_index: usize,
    window_width: f32,
    window_level: f32,
    cache: State<'_, VolumeCache>,
) -> Result<SliceImage, String> {
    let plane = Plane::parse(&plane)?;
    let volumes = cache
        .volumes
        .lock()
        .map_err(|_| "Volume cache lock was poisoned".to_string())?;
    let volume = volumes
        .get(&handle_id)
        .ok_or_else(|| format!("Volume handle not found: {handle_id}"))?;

    render_slice(
        volume,
        handle_id,
        plane,
        slice_index,
        window_width,
        window_level,
    )
}

#[tauri::command]
pub fn volume_slice_axial(
    handle_id: String,
    slice_index: usize,
    window_width: f32,
    window_level: f32,
    cache: State<'_, VolumeCache>,
) -> Result<SliceImage, String> {
    volume_slice(
        handle_id,
        "axial".to_string(),
        slice_index,
        window_width,
        window_level,
        cache,
    )
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
            handle_id: self.id.clone(),
            source_path: self.source_path.clone(),
            dims: [self.width, self.height, self.depth],
            spacing: self.spacing,
            intensity_min: self.min_hu,
            intensity_max: self.max_hu,
            plane_slice_ranges: PlaneSliceRanges {
                axial: SliceRange::from_count(self.depth),
                coronal: SliceRange::from_count(self.height),
                sagittal: SliceRange::from_count(self.width),
            },
        }
    }

    fn voxel(&self, x: usize, y: usize, z: usize) -> Result<i16, String> {
        if x >= self.width || y >= self.height || z >= self.depth {
            return Err(format!(
                "Voxel coordinate out of range: x={x}, y={y}, z={z} for volume {} x {} x {}",
                self.width, self.height, self.depth
            ));
        }

        let plane_size = self
            .width
            .checked_mul(self.height)
            .ok_or_else(|| "Volume plane dimensions are too large".to_string())?;
        let z_offset = z
            .checked_mul(plane_size)
            .ok_or_else(|| "Volume Z offset is too large".to_string())?;
        let y_offset = y
            .checked_mul(self.width)
            .ok_or_else(|| "Volume Y offset is too large".to_string())?;
        let idx = z_offset
            .checked_add(y_offset)
            .and_then(|offset| offset.checked_add(x))
            .ok_or_else(|| "Volume voxel offset is too large".to_string())?;

        self.voxels
            .get(idx)
            .copied()
            .ok_or_else(|| format!("Volume data is missing voxel at offset {idx}"))
    }
}

impl SliceRange {
    fn from_count(count: usize) -> Self {
        Self {
            min: 0,
            max: count.saturating_sub(1),
            count,
        }
    }
}

fn render_slice(
    volume: &Volume,
    handle_id: String,
    plane: Plane,
    slice_index: usize,
    window_width: f32,
    window_level: f32,
) -> Result<SliceImage, String> {
    validate_volume_dimensions(volume)?;
    validate_window(window_width, window_level)?;

    let slice_count = plane.slice_count(volume);
    if slice_index >= slice_count {
        return Err(format!(
            "{} slice index {slice_index} is out of range. Valid range is 0 to {}.",
            plane.as_str(),
            slice_count.saturating_sub(1)
        ));
    }

    let (width, height) = plane.image_size(volume);
    let pixel_count = width
        .checked_mul(height)
        .ok_or_else(|| "MPR slice dimensions are too large".to_string())?;
    let mut pixels = Vec::with_capacity(pixel_count);

    match plane {
        Plane::Axial => {
            let z = slice_index;
            for y in 0..volume.height {
                for x in 0..volume.width {
                    pixels.push(window_voxel(
                        volume.voxel(x, y, z)?,
                        window_width,
                        window_level,
                    ));
                }
            }
        }
        Plane::Coronal => {
            let y = slice_index;
            for z in 0..volume.depth {
                for x in 0..volume.width {
                    pixels.push(window_voxel(
                        volume.voxel(x, y, z)?,
                        window_width,
                        window_level,
                    ));
                }
            }
        }
        Plane::Sagittal => {
            let x = slice_index;
            for z in 0..volume.depth {
                for y in 0..volume.height {
                    pixels.push(window_voxel(
                        volume.voxel(x, y, z)?,
                        window_width,
                        window_level,
                    ));
                }
            }
        }
    }

    Ok(SliceImage {
        handle_id,
        plane: plane.as_str().to_string(),
        slice_index,
        width,
        height,
        window_width,
        window_level,
        pixels_base64: general_purpose::STANDARD.encode(pixels),
    })
}

fn validate_volume_dimensions(volume: &Volume) -> Result<(), String> {
    if volume.width == 0 || volume.height == 0 || volume.depth == 0 {
        return Err("Volume has invalid zero dimensions".to_string());
    }
    Ok(())
}

fn validate_window(window_width: f32, window_level: f32) -> Result<(), String> {
    if !window_width.is_finite() || window_width <= 0.0 {
        return Err(format!(
            "Window width must be a positive number; got {window_width}"
        ));
    }
    if !window_level.is_finite() {
        return Err(format!(
            "Window level must be a finite number; got {window_level}"
        ));
    }
    Ok(())
}

fn window_voxel(value: i16, window_width: f32, window_level: f32) -> u8 {
    let low = window_level - window_width / 2.0;
    let hu = f32::from(value);
    (((hu - low) / window_width) * 255.0)
        .clamp(0.0, 255.0)
        .round() as u8
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
        if !trimmed.is_empty() && trimmed != "sample" {
            if let Some(candidate) = resolve_path(trimmed) {
                return fs::read(&candidate)
                    .map_err(|error| format!("Failed to read {}: {error}", candidate.display()));
            }
        }
        if trimmed == "sample" {
            return Ok(SAMPLE_AAA_NRRD.to_vec());
        }
        if let Some(candidate) = resolve_path("content/aaa/volumes/sample-aaa-001.nrrd") {
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
    let header_end =
        find_header_end(bytes).ok_or("Invalid NRRD: missing blank line after header")?;
    let header_text = std::str::from_utf8(&bytes[..header_end])
        .map_err(|_| "Invalid NRRD: header is not UTF-8".to_string())?;
    let data = &bytes[header_end..];

    if !header_text.starts_with("NRRD") {
        return Err("Invalid NRRD: missing NRRD magic header".to_string());
    }

    let fields = parse_header_fields(header_text);
    let dimension = get_field(&fields, "dimension")?
        .parse::<usize>()
        .map_err(|_| "Invalid NRRD: dimension must be a number".to_string())?;
    if dimension != 3 {
        return Err(format!(
            "Only 3D NRRD volumes are supported in this spike; got dimension {dimension}"
        ));
    }

    let sizes = parse_usize_list(get_field(&fields, "sizes")?)?;
    if sizes.len() != 3 {
        return Err("Invalid NRRD: sizes must contain exactly 3 values".to_string());
    }
    let dims = [sizes[0], sizes[1], sizes[2]];
    if dims.iter().any(|size| *size == 0) {
        return Err("Invalid NRRD: sizes must be greater than zero".to_string());
    }
    let voxel_count = checked_voxel_count(dims)?;

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

    let (min_hu, max_hu) = intensity_range(&voxels)?;
    let spacing = parse_spacing(
        fields.get("space directions").map(String::as_str),
        fields.get("spacings").map(String::as_str),
    );

    Ok(Volume {
        id: String::new(),
        source_path,
        width: dims[0],
        height: dims[1],
        depth: dims[2],
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

fn checked_voxel_count(dims: [usize; 3]) -> Result<usize, String> {
    dims[0]
        .checked_mul(dims[1])
        .and_then(|xy| xy.checked_mul(dims[2]))
        .ok_or_else(|| "Invalid NRRD: volume dimensions are too large".to_string())
}

fn intensity_range(voxels: &[i16]) -> Result<(i16, i16), String> {
    let first = *voxels
        .first()
        .ok_or_else(|| "Invalid NRRD: volume contains no voxels".to_string())?;
    let mut min_hu = first;
    let mut max_hu = first;

    for value in voxels.iter().copied().skip(1) {
        min_hu = min_hu.min(value);
        max_hu = max_hu.max(value);
    }

    Ok((min_hu, max_hu))
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
            voxels.extend(
                data.iter()
                    .take(voxel_count)
                    .map(|value| *value as i8 as i16),
            );
        }
        "uchar" | "unsigned char" | "uint8" | "uint8_t" => {
            ensure_len(data, voxel_count, 1)?;
            voxels.extend(data.iter().take(voxel_count).map(|value| *value as i16));
        }
        "short" | "short int" | "signed short" | "int16" | "int16_t" => {
            ensure_len(data, voxel_count, 2)?;
            for chunk in data.chunks_exact(2).take(voxel_count) {
                let arr = [chunk[0], chunk[1]];
                voxels.push(if little {
                    i16::from_le_bytes(arr)
                } else {
                    i16::from_be_bytes(arr)
                });
            }
        }
        "ushort" | "unsigned short" | "uint16" | "uint16_t" => {
            ensure_len(data, voxel_count, 2)?;
            for chunk in data.chunks_exact(2).take(voxel_count) {
                let arr = [chunk[0], chunk[1]];
                let value = if little {
                    u16::from_le_bytes(arr)
                } else {
                    u16::from_be_bytes(arr)
                };
                voxels.push(value.min(i16::MAX as u16) as i16);
            }
        }
        "int" | "signed int" | "int32" | "int32_t" => {
            ensure_len(data, voxel_count, 4)?;
            for chunk in data.chunks_exact(4).take(voxel_count) {
                let arr = [chunk[0], chunk[1], chunk[2], chunk[3]];
                let value = if little {
                    i32::from_le_bytes(arr)
                } else {
                    i32::from_be_bytes(arr)
                };
                voxels.push(value.clamp(i16::MIN as i32, i16::MAX as i32) as i16);
            }
        }
        "uint" | "unsigned int" | "uint32" | "uint32_t" => {
            ensure_len(data, voxel_count, 4)?;
            for chunk in data.chunks_exact(4).take(voxel_count) {
                let arr = [chunk[0], chunk[1], chunk[2], chunk[3]];
                let value = if little {
                    u32::from_le_bytes(arr)
                } else {
                    u32::from_be_bytes(arr)
                };
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
    let required = voxel_count
        .checked_mul(bytes_per_voxel)
        .ok_or_else(|| "Invalid NRRD: required data length is too large".to_string())?;
    if data.len() < required {
        return Err(format!(
            "Invalid NRRD: data too short, expected at least {required} bytes but found {}",
            data.len()
        ));
    }
    Ok(())
}

fn parse_spacing(space_directions: Option<&str>, spacings: Option<&str>) -> [f32; 3] {
    if let Some(raw) = space_directions {
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

        if vectors.len() == 3 {
            return [
                vector_length(vectors[0]),
                vector_length(vectors[1]),
                vector_length(vectors[2]),
            ];
        }
    }

    if let Some(raw) = spacings {
        let values: Vec<f32> = raw
            .split_whitespace()
            .filter_map(|value| value.trim().parse::<f32>().ok())
            .collect();
        if values.len() == 3 && values.iter().all(|value| value.is_finite() && *value > 0.0) {
            return [values[0], values[1], values[2]];
        }
    }

    [1.0, 1.0, 1.0]
}

fn vector_length(vector: [f32; 3]) -> f32 {
    (vector[0] * vector[0] + vector[1] * vector[1] + vector[2] * vector[2]).sqrt()
}
