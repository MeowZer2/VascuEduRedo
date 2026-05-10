use base64::{engine::general_purpose, Engine as _};
use flate2::read::GzDecoder;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::Read;
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
    raw_dims: [usize; 3],
    width: usize,
    height: usize,
    depth: usize,
    spacing: [f32; 3],
    orientation: OrientationTransform,
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
    orientation: VolumeOrientationInfo,
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VolumeSample {
    handle_id: String,
    plane: String,
    slice_index: usize,
    x: usize,
    y: usize,
    intensity: i16,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VolumeOrientationInfo {
    status: String,
    canonical: String,
    space: Option<String>,
    space_origin: Option<[f32; 3]>,
    kinds: Vec<String>,
    ijk_to_ras: [[f32; 4]; 4],
    warnings: Vec<String>,
    plane_labels: PlaneOrientationLabelSet,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaneOrientationLabelSet {
    axial: PlaneOrientationLabels,
    coronal: PlaneOrientationLabels,
    sagittal: PlaneOrientationLabels,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaneOrientationLabels {
    left: String,
    right: String,
    top: String,
    bottom: String,
}

#[derive(Debug, Clone, Copy)]
struct AxisMapping {
    raw_axis: usize,
    sign: i8,
}

#[derive(Debug, Clone)]
struct OrientationTransform {
    canonical_to_raw: [AxisMapping; 3],
    info: VolumeOrientationInfo,
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

    fn sample_voxel(
        self,
        volume: &Volume,
        slice_index: usize,
        x: usize,
        y: usize,
    ) -> Result<i16, String> {
        let [cx, cy, cz] = self.display_to_canonical(volume, slice_index, x, y)?;
        volume.voxel(cx, cy, cz)
    }

    fn display_to_canonical(
        self,
        volume: &Volume,
        slice_index: usize,
        x: usize,
        y: usize,
    ) -> Result<[usize; 3], String> {
        let [max_x, max_y, max_z] = [
            volume.width.saturating_sub(1),
            volume.height.saturating_sub(1),
            volume.depth.saturating_sub(1),
        ];
        match self {
            Self::Axial => {
                if x > max_x || y > max_y || slice_index > max_z {
                    return Err("Axial display coordinate is out of range".to_string());
                }
                Ok([x, y, slice_index])
            }
            Self::Coronal => {
                if x > max_x || y > max_z || slice_index > max_y {
                    return Err("Coronal display coordinate is out of range".to_string());
                }
                Ok([x, slice_index, max_z - y])
            }
            Self::Sagittal => {
                if x > max_y || y > max_z || slice_index > max_x {
                    return Err("Sagittal display coordinate is out of range".to_string());
                }
                Ok([slice_index, x, max_z - y])
            }
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
pub fn volume_sample(
    handle_id: String,
    plane: String,
    slice_index: usize,
    x: f32,
    y: f32,
    cache: State<'_, VolumeCache>,
) -> Result<VolumeSample, String> {
    let plane = Plane::parse(&plane)?;
    let volumes = cache
        .volumes
        .lock()
        .map_err(|_| "Volume cache lock was poisoned".to_string())?;
    let volume = volumes
        .get(&handle_id)
        .ok_or_else(|| format!("Volume handle not found: {handle_id}"))?;

    validate_volume_dimensions(volume)?;
    let slice_count = plane.slice_count(volume);
    if slice_index >= slice_count {
        return Err(format!(
            "{} slice index {slice_index} is out of range. Valid range is 0 to {}.",
            plane.as_str(),
            slice_count.saturating_sub(1)
        ));
    }

    let (image_width, image_height) = plane.image_size(volume);
    let x_index = image_coordinate_to_index(x, image_width, "x")?;
    let y_index = image_coordinate_to_index(y, image_height, "y")?;
    let intensity = plane.sample_voxel(volume, slice_index, x_index, y_index)?;

    Ok(VolumeSample {
        handle_id,
        plane: plane.as_str().to_string(),
        slice_index,
        x: x_index,
        y: y_index,
        intensity,
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
            handle_id: self.id.clone(),
            source_path: self.source_path.clone(),
            dims: [self.width, self.height, self.depth],
            spacing: self.spacing,
            orientation: self.orientation.info.clone(),
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
        let raw = self.orientation.canonical_to_raw([x, y, z], self.raw_dims)?;
        self.raw_voxel(raw[0], raw[1], raw[2])
    }

    fn raw_voxel(&self, x: usize, y: usize, z: usize) -> Result<i16, String> {
        if x >= self.raw_dims[0] || y >= self.raw_dims[1] || z >= self.raw_dims[2] {
            return Err(format!(
                "Raw voxel coordinate out of range: i={x}, j={y}, k={z} for volume {} x {} x {}",
                self.raw_dims[0], self.raw_dims[1], self.raw_dims[2]
            ));
        }
        let plane_size = self
            .raw_dims[0]
            .checked_mul(self.raw_dims[1])
            .ok_or_else(|| "Volume plane dimensions are too large".to_string())?;
        let z_offset = z
            .checked_mul(plane_size)
            .ok_or_else(|| "Volume Z offset is too large".to_string())?;
        let y_offset = y
            .checked_mul(self.raw_dims[0])
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

    for y in 0..height {
        for x in 0..width {
            pixels.push(window_voxel(
                plane.sample_voxel(volume, slice_index, x, y)?,
                window_width,
                window_level,
            ));
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

fn image_coordinate_to_index(value: f32, limit: usize, axis: &str) -> Result<usize, String> {
    if !value.is_finite() {
        return Err(format!(
            "Sample {axis} coordinate must be finite; got {value}"
        ));
    }
    if limit == 0 {
        return Err(format!(
            "Cannot sample {axis} coordinate from an empty image axis"
        ));
    }
    if value < 0.0 || value >= limit as f32 {
        return Err(format!(
            "Sample {axis} coordinate {value} is out of range. Valid range is 0 to {}.",
            limit.saturating_sub(1)
        ));
    }

    Ok(value.floor() as usize)
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
        "gzip" | "gz" => {
            let decoded = decode_gzip_payload(data)?;
            parse_raw_voxels(&decoded, &nrrd_type, &endian, voxel_count)?
        }
        other => {
            return Err(format!(
                "Unsupported NRRD encoding '{other}'. Supported encodings are raw, ascii/text, and gzip."
            ))
        }
    };

    let (min_hu, max_hu) = intensity_range(&voxels)?;
    let raw_spacing = parse_spacing(
        fields.get("space directions").map(String::as_str),
        fields.get("spacings").map(String::as_str),
    );
    let orientation = build_orientation_transform(&fields, dims, raw_spacing)?;
    let canonical_dims = orientation.canonical_dims(dims);
    let spacing = orientation.canonical_spacing(raw_spacing);

    Ok(Volume {
        id: String::new(),
        source_path,
        raw_dims: dims,
        width: canonical_dims[0],
        height: canonical_dims[1],
        depth: canonical_dims[2],
        spacing,
        orientation,
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

fn decode_gzip_payload(data: &[u8]) -> Result<Vec<u8>, String> {
    let mut decoder = GzDecoder::new(data);
    let mut decoded = Vec::new();
    decoder
        .read_to_end(&mut decoded)
        .map_err(|e| format!("Invalid NRRD: gzip payload could not be decompressed: {e}"))?;
    if decoded.is_empty() {
        return Err("Invalid NRRD: gzip payload decompressed to no data".to_string());
    }
    Ok(decoded)
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

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::{write::GzEncoder, Compression};
    use std::io::Write;

    #[test]
    fn parses_gzip_encoded_nrrd_payload() {
        let raw_voxels = [1_i16, -2, 300, -400]
            .into_iter()
            .flat_map(i16::to_le_bytes)
            .collect::<Vec<u8>>();
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(&raw_voxels).unwrap();
        let compressed = encoder.finish().unwrap();

        let mut bytes = b"NRRD0005\ntype: short\ndimension: 3\nsizes: 2 2 1\nencoding: gzip\nendian: little\n\n".to_vec();
        bytes.extend_from_slice(&compressed);

        let volume = parse_nrrd(&bytes, "fixture.nrrd".to_string()).unwrap();
        assert_eq!((volume.width, volume.height, volume.depth), (2, 2, 1));
        assert_eq!(volume.voxels, vec![1, -2, 300, -400]);
        assert_eq!(volume.min_hu, -400);
        assert_eq!(volume.max_hu, 300);
    }

    #[test]
    fn malformed_gzip_returns_readable_error() {
        let bytes =
            b"NRRD0005\ntype: short\ndimension: 3\nsizes: 2 2 1\nencoding: gzip\nendian: little\n\nnot gzip";
        let error = parse_nrrd(bytes, "bad.nrrd".to_string()).unwrap_err();
        assert!(error.contains("gzip payload could not be decompressed"));
    }

    #[test]
    #[ignore = "Uses optional local uploaded CTA fixture when present."]
    fn parse_uploaded_cta_nrrd_when_available() {
        let path = Path::new("../../../content/aaa/volumes/CTA.nrrd");
        if !path.exists() {
            return;
        }

        let bytes = fs::read(path).unwrap();
        let volume = parse_nrrd(&bytes, path.display().to_string()).unwrap();
        assert!(volume.width > 0);
        assert!(volume.height > 0);
        assert!(volume.depth > 0);
        assert_eq!(volume.voxels.len(), volume.width * volume.height * volume.depth);
        println!(
            "loaded CTA fixture: {}x{}x{}, HU {}..{}",
            volume.width, volume.height, volume.depth, volume.min_hu, volume.max_hu
        );
    }
}

impl OrientationTransform {
    fn canonical_to_raw(
        &self,
        canonical: [usize; 3],
        raw_dims: [usize; 3],
    ) -> Result<[usize; 3], String> {
        let mut raw = [0_usize; 3];
        for (canonical_axis, value) in canonical.into_iter().enumerate() {
            let mapping = self.canonical_to_raw[canonical_axis];
            let raw_len = raw_dims
                .get(mapping.raw_axis)
                .copied()
                .ok_or_else(|| "Invalid orientation mapping axis".to_string())?;
            raw[mapping.raw_axis] = if mapping.sign >= 0 {
                value
            } else {
                raw_len
                    .checked_sub(1)
                    .and_then(|max| max.checked_sub(value))
                    .ok_or_else(|| "Invalid orientation flip coordinate".to_string())?
            };
        }
        Ok(raw)
    }

    fn canonical_dims(&self, raw_dims: [usize; 3]) -> [usize; 3] {
        let mut out = [0_usize; 3];
        for canonical_axis in 0..3 {
            let mapping = self.canonical_to_raw[canonical_axis];
            out[canonical_axis] = raw_dims[mapping.raw_axis];
        }
        out
    }

    fn canonical_spacing(&self, raw_spacing: [f32; 3]) -> [f32; 3] {
        let mut out = [1.0_f32; 3];
        for canonical_axis in 0..3 {
            let mapping = self.canonical_to_raw[canonical_axis];
            out[canonical_axis] = raw_spacing[mapping.raw_axis];
        }
        out
    }
}

const IDENTITY_AXIS_MAPPING: [AxisMapping; 3] = [
    AxisMapping { raw_axis: 0, sign: 1 },
    AxisMapping { raw_axis: 1, sign: 1 },
    AxisMapping { raw_axis: 2, sign: 1 },
];

fn identity_matrix(spacing: [f32; 3], origin: [f32; 3]) -> [[f32; 4]; 4] {
    [
        [spacing[0], 0.0, 0.0, origin[0]],
        [0.0, spacing[1], 0.0, origin[1]],
        [0.0, 0.0, spacing[2], origin[2]],
        [0.0, 0.0, 0.0, 1.0],
    ]
}

/// Plane labels assume canonical RAS storage and the display mapping used in
/// `Plane::display_to_canonical` (axial: identity; coronal/sagittal flip Y so
/// superior is at the top of the displayed image).
fn canonical_plane_labels() -> PlaneOrientationLabelSet {
    PlaneOrientationLabelSet {
        axial: PlaneOrientationLabels {
            left: "L".to_string(),
            right: "R".to_string(),
            top: "P".to_string(),
            bottom: "A".to_string(),
        },
        coronal: PlaneOrientationLabels {
            left: "L".to_string(),
            right: "R".to_string(),
            top: "S".to_string(),
            bottom: "I".to_string(),
        },
        sagittal: PlaneOrientationLabels {
            left: "P".to_string(),
            right: "A".to_string(),
            top: "S".to_string(),
            bottom: "I".to_string(),
        },
    }
}

fn uncertain_plane_labels() -> PlaneOrientationLabelSet {
    let unknown = PlaneOrientationLabels {
        left: "?".to_string(),
        right: "?".to_string(),
        top: "?".to_string(),
        bottom: "?".to_string(),
    };
    PlaneOrientationLabelSet {
        axial: unknown.clone(),
        coronal: unknown.clone(),
        sagittal: unknown,
    }
}

fn build_orientation_transform(
    fields: &HashMap<String, String>,
    _raw_dims: [usize; 3],
    raw_spacing: [f32; 3],
) -> Result<OrientationTransform, String> {
    let space_field = fields.get("space").map(String::as_str);
    let space_directions_field = fields.get("space directions").map(String::as_str);
    let space_origin_field = fields.get("space origin").map(String::as_str);
    let kinds_field = fields.get("kinds").map(String::as_str);

    let kinds: Vec<String> = kinds_field
        .map(|raw| {
            raw.split_whitespace()
                .map(|part| part.to_string())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let raw_origin = parse_space_origin_vec(space_origin_field);
    let raw_directions = space_directions_field.and_then(parse_space_directions);
    let space_kind = space_field.and_then(parse_space_kind);

    let mut warnings: Vec<String> = Vec::new();

    if let Some(raw) = space_field {
        if space_kind.is_none() {
            warnings.push(format!(
                "Unrecognised NRRD 'space' value '{raw}'; orientation may be approximate."
            ));
        }
    }

    let space_signs = space_kind.map(ras_signs_for_space).unwrap_or([1.0, 1.0, 1.0]);

    // Convert each raw IJK direction vector into RAS coordinates so we can
    // compare against canonical axes regardless of whether the file is stored
    // in LPS, RAS, scanner-XYZ, etc.
    let ras_directions = raw_directions.map(|dirs| {
        let mut converted = [[0.0_f32; 3]; 3];
        for axis in 0..3 {
            for component in 0..3 {
                converted[axis][component] = dirs[axis][component] * space_signs[component];
            }
        }
        converted
    });

    let ras_origin = raw_origin.map(|origin| {
        [
            origin[0] * space_signs[0],
            origin[1] * space_signs[1],
            origin[2] * space_signs[2],
        ]
    });

    let mut status = "trusted".to_string();
    let canonical_to_raw_mapping = match ras_directions.as_ref() {
        Some(dirs) => match derive_axis_mapping(dirs, &mut warnings) {
            Some(mapping) => mapping,
            None => {
                status = "uncertain".to_string();
                warnings.push(
                    "NRRD orientation is not orthogonal enough to canonicalize; falling back to raw IJK axes.".to_string(),
                );
                IDENTITY_AXIS_MAPPING
            }
        },
        None => {
            if space_directions_field.is_some() {
                warnings.push(
                    "NRRD 'space directions' field could not be parsed as 3D vectors; assuming raw IJK matches RAS.".to_string(),
                );
            } else {
                warnings.push(
                    "NRRD orientation metadata is missing; assuming raw IJK matches canonical RAS.".to_string(),
                );
            }
            status = "uncertain".to_string();
            IDENTITY_AXIS_MAPPING
        }
    };

    let plane_labels = if status == "uncertain" {
        uncertain_plane_labels()
    } else {
        canonical_plane_labels()
    };

    let ijk_to_ras = build_ijk_to_ras_matrix(
        ras_directions.as_ref(),
        ras_origin,
        raw_spacing,
    );

    let info = VolumeOrientationInfo {
        status,
        canonical: "RAS".to_string(),
        space: space_field.map(|raw| raw.to_string()),
        space_origin: ras_origin,
        kinds,
        ijk_to_ras,
        warnings,
        plane_labels,
    };

    Ok(OrientationTransform {
        canonical_to_raw: canonical_to_raw_mapping,
        info,
    })
}

fn parse_space_directions(raw: &str) -> Option<[[f32; 3]; 3]> {
    let mut vectors: Vec<[f32; 3]> = Vec::new();
    for part in raw.split(')') {
        let Some(start) = part.find('(') else {
            continue;
        };
        let nums: Vec<f32> = part[start + 1..]
            .split(',')
            .filter_map(|value| value.trim().parse::<f32>().ok())
            .collect();
        if nums.len() == 3 {
            vectors.push([nums[0], nums[1], nums[2]]);
        }
    }
    if vectors.len() == 3 {
        Some([vectors[0], vectors[1], vectors[2]])
    } else {
        None
    }
}

fn parse_space_origin_vec(raw: Option<&str>) -> Option<[f32; 3]> {
    let raw = raw?;
    let trimmed = raw.trim();
    let inside = trimmed.trim_start_matches('(').trim_end_matches(')');
    let nums: Vec<f32> = inside
        .split(',')
        .filter_map(|value| value.trim().parse::<f32>().ok())
        .collect();
    if nums.len() == 3 {
        Some([nums[0], nums[1], nums[2]])
    } else {
        None
    }
}

#[derive(Debug, Clone, Copy)]
enum SpaceKind {
    Ras,
    Lps,
    Las,
    Rps,
    Lai,
    Rai,
    Lpi,
    Rpi,
    ScannerXyz,
}

fn parse_space_kind(raw: &str) -> Option<SpaceKind> {
    let normalised = raw.trim().to_ascii_lowercase();
    match normalised.as_str() {
        "right-anterior-superior" | "ras" => Some(SpaceKind::Ras),
        "left-posterior-superior" | "lps" => Some(SpaceKind::Lps),
        "left-anterior-superior" | "las" => Some(SpaceKind::Las),
        "right-posterior-superior" | "rps" => Some(SpaceKind::Rps),
        "left-anterior-inferior" | "lai" => Some(SpaceKind::Lai),
        "right-anterior-inferior" | "rai" => Some(SpaceKind::Rai),
        "left-posterior-inferior" | "lpi" => Some(SpaceKind::Lpi),
        "right-posterior-inferior" | "rpi" => Some(SpaceKind::Rpi),
        "scanner-xyz" | "scanner-xyz-time" | "3d-right-handed" | "3d-left-handed" => {
            Some(SpaceKind::ScannerXyz)
        }
        _ => None,
    }
}

/// Returns per-component sign multipliers that convert a vector expressed in
/// the given space frame to the canonical RAS frame.
fn ras_signs_for_space(kind: SpaceKind) -> [f32; 3] {
    match kind {
        SpaceKind::Ras | SpaceKind::ScannerXyz => [1.0, 1.0, 1.0],
        SpaceKind::Lps => [-1.0, -1.0, 1.0],
        SpaceKind::Las => [-1.0, 1.0, 1.0],
        SpaceKind::Rps => [1.0, -1.0, 1.0],
        SpaceKind::Lai => [-1.0, 1.0, -1.0],
        SpaceKind::Rai => [1.0, 1.0, -1.0],
        SpaceKind::Lpi => [-1.0, -1.0, -1.0],
        SpaceKind::Rpi => [1.0, -1.0, -1.0],
    }
}

/// Choose, for each raw IJK axis, the canonical RAS axis it best aligns with
/// and the sign of the alignment. Returns `None` when the raw axes are not
/// orthogonal enough to be canonicalized via a permutation+flip alone.
fn derive_axis_mapping(
    ras_directions: &[[f32; 3]; 3],
    warnings: &mut Vec<String>,
) -> Option<[AxisMapping; 3]> {
    const DOMINANCE_THRESHOLD: f32 = 0.85;

    let mut raw_to_canonical: [(usize, i8); 3] = [(0, 1); 3];
    for raw_axis in 0..3 {
        let v = ras_directions[raw_axis];
        let length = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
        if !length.is_finite() || length <= 0.0 {
            return None;
        }
        let normalised = [v[0] / length, v[1] / length, v[2] / length];

        let mut best = 0usize;
        let mut best_abs = normalised[0].abs();
        for k in 1..3 {
            let component = normalised[k].abs();
            if component > best_abs {
                best = k;
                best_abs = component;
            }
        }

        if best_abs < DOMINANCE_THRESHOLD {
            warnings.push(format!(
                "Raw axis {raw_axis} aligns weakly with canonical axis {best} (cosine {best_abs:.2}); orientation may be approximate."
            ));
        }

        let sign: i8 = if normalised[best] >= 0.0 { 1 } else { -1 };
        raw_to_canonical[raw_axis] = (best, sign);
    }

    let mut used = [false; 3];
    for (canonical_axis, _) in raw_to_canonical.iter().copied() {
        if used[canonical_axis] {
            return None;
        }
        used[canonical_axis] = true;
    }

    let mut canonical_to_raw_arr = IDENTITY_AXIS_MAPPING;
    for (raw_axis, (canonical_axis, sign)) in raw_to_canonical.iter().copied().enumerate() {
        canonical_to_raw_arr[canonical_axis] = AxisMapping {
            raw_axis,
            sign,
        };
    }

    Some(canonical_to_raw_arr)
}

fn build_ijk_to_ras_matrix(
    ras_directions: Option<&[[f32; 3]; 3]>,
    ras_origin: Option<[f32; 3]>,
    raw_spacing: [f32; 3],
) -> [[f32; 4]; 4] {
    let origin = ras_origin.unwrap_or([0.0, 0.0, 0.0]);
    match ras_directions {
        Some(dirs) => [
            [dirs[0][0], dirs[1][0], dirs[2][0], origin[0]],
            [dirs[0][1], dirs[1][1], dirs[2][1], origin[1]],
            [dirs[0][2], dirs[1][2], dirs[2][2], origin[2]],
            [0.0, 0.0, 0.0, 1.0],
        ],
        None => identity_matrix(raw_spacing, origin),
    }
}
