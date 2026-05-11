use base64::{engine::general_purpose, Engine as _};
use dicom_object::{open_file as open_dicom_file, DefaultDicomObject};
use flate2::read::GzDecoder;
use serde::Serialize;
use std::cmp::Ordering;
use std::collections::{HashMap, VecDeque};
use std::fs;
use std::io::Read;
use std::num::ParseIntError;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::{ipc::Response, State};

const SAMPLE_AAA_NRRD: &[u8] =
    include_bytes!("../../../../content/aaa/volumes/sample-aaa-001.nrrd");
const PREPARED_VOLUME_CACHE_CAPACITY: usize = 3;

#[derive(Default)]
pub struct VolumeCache {
    inner: Mutex<VolumeCacheInner>,
}

#[derive(Default)]
struct VolumeCacheInner {
    handles: HashMap<String, Arc<Volume>>,
    prepared: HashMap<String, Arc<Volume>>,
    lru: VecDeque<String>,
}

#[derive(Debug, Clone)]
struct Volume {
    id: String,
    source_path: String,
    width: usize,
    height: usize,
    depth: usize,
    spacing: [f32; 3],
    orientation: OrientationTransform,
    encoding: String,
    nrrd_type: String,
    min_hu: i16,
    max_hu: i16,
    voxels: Vec<i16>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VolumeInfo {
    handle_id: String,
    source_path: String,
    cache_status: String,
    cache_key: String,
    dims: [usize; 3],
    spacing: [f32; 3],
    orientation: VolumeOrientationInfo,
    encoding: String,
    voxel_type: String,
    intensity_min: i16,
    intensity_max: i16,
    plane_slice_ranges: PlaneSliceRanges,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DicomSeriesInfo {
    series_instance_uid: String,
    folder_path: String,
    series_folder_path: Option<String>,
    series_description: Option<String>,
    modality: Option<String>,
    study_description: Option<String>,
    slice_count: usize,
    warnings: Vec<String>,
    unsupported_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DicomDiscoveryResult {
    folder_path: String,
    dicom_file_count: usize,
    ignored_file_count: usize,
    series: Vec<DicomSeriesInfo>,
    warnings: Vec<String>,
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
    timings: SliceTimings,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SliceTimings {
    command_total_ms: f64,
    cache_lock_ms: f64,
    validation_ms: f64,
    orientation_mapping_ms: f64,
    slice_extraction_ms: f64,
    window_level_ms: f64,
    payload_encode_ms: f64,
}

struct SlicePixelsResult {
    handle_id: String,
    plane: Plane,
    slice_index: usize,
    width: usize,
    height: usize,
    window_width: f32,
    window_level: f32,
    pixels: Vec<u8>,
    timings: SliceTimings,
}

struct NrrdVolumeSource {
    bytes: Vec<u8>,
    source_path: String,
    cache_key: String,
}

struct DicomVolumeSource {
    folder: PathBuf,
    cache_key: String,
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
    let source = resolve_nrrd_source(&path)?;
    if let Some(info) = attach_cached_volume(&cache, &source.cache_key)? {
        return Ok(info);
    }

    let mut volume = parse_nrrd(&source.bytes, source.source_path)?;
    volume.id = String::new();
    let volume = Arc::new(volume);
    insert_prepared_volume(&cache, source.cache_key, volume, "cold")
}

#[tauri::command]
pub fn dicom_discover_folder(folder_path: String) -> Result<DicomDiscoveryResult, String> {
    discover_dicom_folder(&folder_path)
}

#[tauri::command]
pub fn volume_load_dicom_series(
    folder_path: String,
    series_instance_uid: String,
    cache: State<'_, VolumeCache>,
) -> Result<VolumeInfo, String> {
    let source = resolve_dicom_source(&folder_path, &series_instance_uid)?;
    if let Some(info) = attach_cached_volume(&cache, &source.cache_key)? {
        return Ok(info);
    }

    let mut volume = build_dicom_volume_from_folder(source.folder, &series_instance_uid)?;
    volume.id = String::new();
    let volume = Arc::new(volume);
    insert_prepared_volume(&cache, source.cache_key, volume, "cold")
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
    let command_started = Instant::now();
    let plane = Plane::parse(&plane)?;
    let lock_started = Instant::now();
    let volume = {
        let inner = cache
            .inner
            .lock()
            .map_err(|_| "Volume cache lock was poisoned".to_string())?;
        inner
            .handles
            .get(&handle_id)
            .cloned()
            .ok_or_else(|| format!("Volume handle not found: {handle_id}"))?
    };
    let cache_lock_ms = elapsed_ms(lock_started);

    let mut image = render_slice(
        &volume,
        handle_id,
        plane,
        slice_index,
        window_width,
        window_level,
    )?;
    image.timings.cache_lock_ms = cache_lock_ms;
    image.timings.command_total_ms = elapsed_ms(command_started);
    Ok(image)
}

#[tauri::command]
pub fn volume_slice_raw(
    handle_id: String,
    plane: String,
    slice_index: usize,
    window_width: f32,
    window_level: f32,
    cache: State<'_, VolumeCache>,
) -> Result<Response, String> {
    let command_started = Instant::now();
    let plane = Plane::parse(&plane)?;
    let lock_started = Instant::now();
    let volume = {
        let inner = cache
            .inner
            .lock()
            .map_err(|_| "Volume cache lock was poisoned".to_string())?;
        inner
            .handles
            .get(&handle_id)
            .cloned()
            .ok_or_else(|| format!("Volume handle not found: {handle_id}"))?
    };
    let cache_lock_ms = elapsed_ms(lock_started);
    let mut slice = render_slice_pixels(
        &volume,
        handle_id,
        plane,
        slice_index,
        window_width,
        window_level,
    )?;
    slice.timings.cache_lock_ms = cache_lock_ms;
    let pack_started = Instant::now();
    let mut payload = pack_slice_response(&slice)?;
    slice.timings.payload_encode_ms = elapsed_ms(pack_started);
    slice.timings.command_total_ms = elapsed_ms(command_started);
    write_f64_le(&mut payload, 24, slice.timings.command_total_ms)?;
    write_f64_le(&mut payload, 72, slice.timings.payload_encode_ms)?;
    Ok(Response::new(payload))
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
    let volume = {
        let inner = cache
            .inner
            .lock()
            .map_err(|_| "Volume cache lock was poisoned".to_string())?;
        inner
            .handles
            .get(&handle_id)
            .cloned()
            .ok_or_else(|| format!("Volume handle not found: {handle_id}"))?
    };

    validate_volume_dimensions(&volume)?;
    let slice_count = plane.slice_count(&volume);
    if slice_index >= slice_count {
        return Err(format!(
            "{} slice index {slice_index} is out of range. Valid range is 0 to {}.",
            plane.as_str(),
            slice_count.saturating_sub(1)
        ));
    }

    let (image_width, image_height) = plane.image_size(&volume);
    let x_index = image_coordinate_to_index(x, image_width, "x")?;
    let y_index = image_coordinate_to_index(y, image_height, "y")?;
    let intensity = plane.sample_voxel(&volume, slice_index, x_index, y_index)?;

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
    let mut inner = cache
        .inner
        .lock()
        .map_err(|_| "Volume cache lock was poisoned".to_string())?;
    Ok(inner.handles.remove(&handle_id).is_some())
}

impl Volume {
    fn info(&self, handle_id: String, cache_key: String, cache_status: &str) -> VolumeInfo {
        VolumeInfo {
            handle_id,
            source_path: self.source_path.clone(),
            cache_status: cache_status.to_string(),
            cache_key,
            dims: [self.width, self.height, self.depth],
            spacing: self.spacing,
            orientation: self.orientation.info.clone(),
            encoding: self.encoding.clone(),
            voxel_type: self.nrrd_type.clone(),
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
        Ok(self.voxels[self.canonical_offset(x, y, z)])
    }

    fn canonical_offset(&self, x: usize, y: usize, z: usize) -> usize {
        (z * self.height + y) * self.width + x
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
    let mut slice = render_slice_pixels(
        volume,
        handle_id,
        plane,
        slice_index,
        window_width,
        window_level,
    )?;
    let encode_started = Instant::now();
    let pixels_base64 = general_purpose::STANDARD.encode(slice.pixels);
    slice.timings.payload_encode_ms = elapsed_ms(encode_started);
    Ok(SliceImage {
        handle_id: slice.handle_id,
        plane: slice.plane.as_str().to_string(),
        slice_index: slice.slice_index,
        width: slice.width,
        height: slice.height,
        window_width: slice.window_width,
        window_level: slice.window_level,
        pixels_base64,
        timings: slice.timings,
    })
}

fn render_slice_pixels(
    volume: &Volume,
    handle_id: String,
    plane: Plane,
    slice_index: usize,
    window_width: f32,
    window_level: f32,
) -> Result<SlicePixelsResult, String> {
    let validation_started = Instant::now();
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
    let validation_ms = elapsed_ms(validation_started);

    let (width, height) = plane.image_size(volume);
    let pixel_count = width
        .checked_mul(height)
        .ok_or_else(|| "MPR slice dimensions are too large".to_string())?;

    let extraction_started = Instant::now();
    let mut intensities = Vec::with_capacity(pixel_count);
    match plane {
        Plane::Axial => {
            let start = slice_index
                .checked_mul(volume.width * volume.height)
                .ok_or_else(|| "Axial slice offset is too large".to_string())?;
            intensities.extend_from_slice(&volume.voxels[start..start + pixel_count]);
        }
        Plane::Coronal => {
            for y in 0..height {
                let z = volume.depth - 1 - y;
                let row_start = (z * volume.height + slice_index) * volume.width;
                intensities.extend_from_slice(&volume.voxels[row_start..row_start + width]);
            }
        }
        Plane::Sagittal => {
            for y in 0..height {
                let z = volume.depth - 1 - y;
                for x in 0..width {
                    let offset = (z * volume.height + x) * volume.width + slice_index;
                    intensities.push(volume.voxels[offset]);
                }
            }
        }
    }
    let slice_extraction_ms = elapsed_ms(extraction_started);

    let wl_started = Instant::now();
    let pixels: Vec<u8> = intensities
        .into_iter()
        .map(|voxel| window_voxel(voxel, window_width, window_level))
        .collect();
    let window_level_ms = elapsed_ms(wl_started);

    Ok(SlicePixelsResult {
        handle_id,
        plane,
        slice_index,
        width,
        height,
        window_width,
        window_level,
        pixels,
        timings: SliceTimings {
            command_total_ms: 0.0,
            cache_lock_ms: 0.0,
            validation_ms,
            orientation_mapping_ms: 0.0,
            slice_extraction_ms,
            window_level_ms,
            payload_encode_ms: 0.0,
        },
    })
}

fn elapsed_ms(started: Instant) -> f64 {
    started.elapsed().as_secs_f64() * 1000.0
}

fn pack_slice_response(slice: &SlicePixelsResult) -> Result<Vec<u8>, String> {
    let pixel_len = slice
        .width
        .checked_mul(slice.height)
        .ok_or_else(|| "MPR slice dimensions are too large".to_string())?;
    if slice.pixels.len() != pixel_len {
        return Err(format!(
            "Slice payload has {} pixels but expected {pixel_len}.",
            slice.pixels.len()
        ));
    }

    let header_len = 4 + 4 * 3 + 4 * 2 + 8 * 7;
    let mut out = Vec::with_capacity(header_len + slice.pixels.len());
    out.extend_from_slice(b"VSL1");
    out.extend_from_slice(&(slice.width as u32).to_le_bytes());
    out.extend_from_slice(&(slice.height as u32).to_le_bytes());
    out.extend_from_slice(&(slice.slice_index as u32).to_le_bytes());
    out.extend_from_slice(&slice.window_width.to_le_bytes());
    out.extend_from_slice(&slice.window_level.to_le_bytes());
    for value in [
        slice.timings.command_total_ms,
        slice.timings.cache_lock_ms,
        slice.timings.validation_ms,
        slice.timings.orientation_mapping_ms,
        slice.timings.slice_extraction_ms,
        slice.timings.window_level_ms,
        slice.timings.payload_encode_ms,
    ] {
        out.extend_from_slice(&value.to_le_bytes());
    }
    out.extend_from_slice(&slice.pixels);
    Ok(out)
}

fn write_f64_le(out: &mut [u8], offset: usize, value: f64) -> Result<(), String> {
    let end = offset
        .checked_add(8)
        .ok_or_else(|| "Slice timing offset is too large".to_string())?;
    let target = out
        .get_mut(offset..end)
        .ok_or_else(|| "Slice timing offset is out of range".to_string())?;
    target.copy_from_slice(&value.to_le_bytes());
    Ok(())
}

fn canonicalize_voxels(
    raw_voxels: Vec<i16>,
    raw_dims: [usize; 3],
    canonical_dims: [usize; 3],
    orientation: &OrientationTransform,
) -> Result<Vec<i16>, String> {
    let expected = checked_voxel_count(raw_dims)?;
    if raw_voxels.len() != expected {
        return Err(format!(
            "Malformed volume: expected {expected} voxels but decoded {}.",
            raw_voxels.len()
        ));
    }

    let canonical_count = checked_voxel_count(canonical_dims)?;
    let mut canonical = vec![0i16; canonical_count];
    let raw_plane = raw_dims[0]
        .checked_mul(raw_dims[1])
        .ok_or_else(|| "Raw volume plane dimensions are too large".to_string())?;
    for z in 0..canonical_dims[2] {
        for y in 0..canonical_dims[1] {
            for x in 0..canonical_dims[0] {
                let raw = orientation.canonical_to_raw([x, y, z], raw_dims)?;
                let raw_idx = (raw[2] * raw_dims[1] + raw[1]) * raw_dims[0] + raw[0];
                let canonical_idx = (z * canonical_dims[1] + y) * canonical_dims[0] + x;
                if raw_idx >= raw_plane * raw_dims[2] {
                    return Err("Orientation mapping produced an out-of-range voxel".to_string());
                }
                canonical[canonical_idx] = raw_voxels[raw_idx];
            }
        }
    }
    Ok(canonical)
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
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.subsec_nanos())
        .unwrap_or_default();
    format!("vol-{millis}-{nanos}")
}

fn attach_cached_volume(
    cache: &State<'_, VolumeCache>,
    cache_key: &str,
) -> Result<Option<VolumeInfo>, String> {
    let mut inner = cache
        .inner
        .lock()
        .map_err(|_| "Volume cache lock was poisoned".to_string())?;
    let Some(volume) = inner.prepared.get(cache_key).cloned() else {
        return Ok(None);
    };
    touch_lru(&mut inner.lru, cache_key);
    let handle_id = make_volume_id();
    inner.handles.insert(handle_id.clone(), volume.clone());
    Ok(Some(volume.info(handle_id, cache_key.to_string(), "warm")))
}

fn insert_prepared_volume(
    cache: &State<'_, VolumeCache>,
    cache_key: String,
    volume: Arc<Volume>,
    cache_status: &str,
) -> Result<VolumeInfo, String> {
    let handle_id = make_volume_id();
    let info = volume.info(handle_id.clone(), cache_key.clone(), cache_status);
    let mut inner = cache
        .inner
        .lock()
        .map_err(|_| "Volume cache lock was poisoned".to_string())?;
    inner.handles.insert(handle_id, volume.clone());
    inner.prepared.insert(cache_key.clone(), volume);
    touch_lru(&mut inner.lru, &cache_key);
    evict_prepared_volumes(&mut inner);
    Ok(info)
}

fn touch_lru(lru: &mut VecDeque<String>, cache_key: &str) {
    if let Some(index) = lru.iter().position(|item| item == cache_key) {
        lru.remove(index);
    }
    lru.push_back(cache_key.to_string());
}

fn evict_prepared_volumes(inner: &mut VolumeCacheInner) {
    while inner.prepared.len() > PREPARED_VOLUME_CACHE_CAPACITY {
        let Some(candidate) = inner.lru.pop_front() else {
            break;
        };
        let is_active = inner
            .handles
            .values()
            .any(|volume| inner.prepared.get(&candidate).is_some_and(|cached| Arc::ptr_eq(cached, volume)));
        if is_active {
            inner.lru.push_back(candidate);
            if inner.lru.len() <= inner.prepared.len() {
                break;
            }
            continue;
        }
        inner.prepared.remove(&candidate);
    }
}

fn resolve_nrrd_source(path: &str) -> Result<NrrdVolumeSource, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() || trimmed == "sample" || trimmed.ends_with("sample-aaa-001.nrrd") {
        if !trimmed.is_empty() && trimmed != "sample" {
            if let Some(candidate) = resolve_path(trimmed) {
                let bytes = fs::read(&candidate)
                    .map_err(|error| format!("Failed to read {}: {error}", candidate.display()))?;
                let cache_key = file_cache_key("nrrd", &candidate)?;
                return Ok(NrrdVolumeSource {
                    bytes,
                    source_path: candidate.display().to_string(),
                    cache_key,
                });
            }
        }
        if trimmed == "sample" {
            return Ok(NrrdVolumeSource {
                bytes: SAMPLE_AAA_NRRD.to_vec(),
                source_path: "sample".to_string(),
                cache_key: format!("nrrd:embedded-sample:{}", SAMPLE_AAA_NRRD.len()),
            });
        }
        if let Some(candidate) = resolve_path("content/aaa/volumes/sample-aaa-001.nrrd") {
            let bytes = fs::read(&candidate)
                .map_err(|error| format!("Failed to read {}: {error}", candidate.display()))?;
            let cache_key = file_cache_key("nrrd", &candidate)?;
            return Ok(NrrdVolumeSource {
                bytes,
                source_path: candidate.display().to_string(),
                cache_key,
            });
        }
        return Ok(NrrdVolumeSource {
            bytes: SAMPLE_AAA_NRRD.to_vec(),
            source_path: "sample-aaa-001.nrrd".to_string(),
            cache_key: format!("nrrd:embedded-sample:{}", SAMPLE_AAA_NRRD.len()),
        });
    }

    if let Some(candidate) = resolve_path(trimmed) {
        let bytes = fs::read(&candidate)
            .map_err(|error| format!("Failed to read {}: {error}", candidate.display()))?;
        let cache_key = file_cache_key("nrrd", &candidate)?;
        return Ok(NrrdVolumeSource {
            bytes,
            source_path: candidate.display().to_string(),
            cache_key,
        });
    }

    Err(format!(
        "NRRD file not found: {trimmed}. Use an absolute path, a path relative to the project root, or 'sample'."
    ))
}

fn resolve_dicom_source(folder_path: &str, series_instance_uid: &str) -> Result<DicomVolumeSource, String> {
    let folder = resolve_existing_folder(folder_path)?;
    let cache_key = dicom_folder_cache_key(&folder, series_instance_uid)?;
    Ok(DicomVolumeSource { folder, cache_key })
}

fn file_cache_key(prefix: &str, path: &Path) -> Result<String, String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("Could not inspect {}: {error}", path.display()))?;
    let modified = metadata_modified_millis(&metadata);
    let canonical = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    Ok(format!(
        "{prefix}:{}:{}:{}",
        canonical.display(),
        metadata.len(),
        modified
    ))
}

fn dicom_folder_cache_key(folder: &Path, series_instance_uid: &str) -> Result<String, String> {
    let mut warnings = Vec::new();
    let (files, unreadable_count) = collect_files_recursive(folder, &mut warnings)?;
    let mut latest_modified = 0_u128;
    let mut total_len = 0_u64;
    let mut inspected = 0_usize;
    for file in files {
        if let Ok(metadata) = fs::metadata(&file) {
            inspected += 1;
            total_len = total_len.saturating_add(metadata.len());
            latest_modified = latest_modified.max(metadata_modified_millis(&metadata));
        }
    }
    let canonical = folder.canonicalize().unwrap_or_else(|_| folder.to_path_buf());
    Ok(format!(
        "dicom:{}:{}:{}:{}:{}",
        canonical.display(),
        series_instance_uid,
        inspected,
        total_len,
        latest_modified.max(unreadable_count as u128)
    ))
}

fn metadata_modified_millis(metadata: &fs::Metadata) -> u128 {
    metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
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
    let voxels = canonicalize_voxels(voxels, dims, canonical_dims, &orientation)?;

    Ok(Volume {
        id: String::new(),
        source_path,
        width: canonical_dims[0],
        height: canonical_dims[1],
        depth: canonical_dims[2],
        spacing,
        orientation,
        encoding,
        nrrd_type,
        min_hu,
        max_hu,
        voxels,
    })
}

#[derive(Debug, Clone)]
struct DicomSeriesAccumulator {
    series_instance_uid: String,
    folder_path: String,
    series_folder_path: Option<String>,
    series_description: Option<String>,
    modality: Option<String>,
    study_description: Option<String>,
    files: Vec<PathBuf>,
    warnings: Vec<String>,
}

#[derive(Debug, Clone)]
struct DicomSlice {
    path: PathBuf,
    rows: usize,
    cols: usize,
    position: Option<[f32; 3]>,
    orientation: Option<[[f32; 3]; 2]>,
    pixel_spacing: Option<[f32; 2]>,
    instance_number: Option<i32>,
    rescale_slope: f32,
    rescale_intercept: f32,
    voxels: Vec<i16>,
}

fn discover_dicom_folder(folder_path: &str) -> Result<DicomDiscoveryResult, String> {
    let folder = resolve_existing_folder(folder_path)?;
    let mut grouped: HashMap<String, DicomSeriesAccumulator> = HashMap::new();
    let mut dicom_file_count = 0usize;
    let mut ignored_file_count = 0usize;
    let mut warnings = Vec::new();
    let (candidate_files, unreadable_count) = collect_files_recursive(&folder, &mut warnings)?;
    ignored_file_count += unreadable_count;

    for path in candidate_files {
        let object = match open_dicom_file(&path) {
            Ok(object) => object,
            Err(_) => {
                ignored_file_count += 1;
                continue;
            }
        };

        let Some(series_instance_uid) = dicom_string_opt(&object, "SeriesInstanceUID") else {
            warnings.push(format!(
                "Ignored {} because it has no SeriesInstanceUID.",
                display_name(&path)
            ));
            ignored_file_count += 1;
            continue;
        };

        dicom_file_count += 1;
        let entry = grouped
            .entry(series_instance_uid.clone())
            .or_insert_with(|| DicomSeriesAccumulator {
                series_instance_uid: series_instance_uid.clone(),
                folder_path: folder.display().to_string(),
                series_folder_path: path.parent().map(|parent| parent.display().to_string()),
                series_description: dicom_string_opt(&object, "SeriesDescription"),
                modality: dicom_string_opt(&object, "Modality"),
                study_description: dicom_string_opt(&object, "StudyDescription"),
                files: Vec::new(),
                warnings: Vec::new(),
            });

        merge_optional_string(&mut entry.series_description, dicom_string_opt(&object, "SeriesDescription"));
        merge_optional_string(&mut entry.modality, dicom_string_opt(&object, "Modality"));
        merge_optional_string(&mut entry.study_description, dicom_string_opt(&object, "StudyDescription"));
        entry.files.push(path);
    }

    let mut series: Vec<DicomSeriesInfo> = grouped
        .into_values()
        .map(|mut acc| {
            acc.files.sort();
            let modality = acc.modality.clone();
            let unsupported_reason = match modality.as_deref() {
                Some("CT") => None,
                Some(other) => Some(format!("Only CT series are supported in this import pass; modality is {other}.")),
                None => Some("Only CT series are supported, and this series has no Modality tag.".to_string()),
            };
            DicomSeriesInfo {
                series_instance_uid: acc.series_instance_uid,
                folder_path: acc.folder_path,
                series_folder_path: acc.series_folder_path,
                series_description: acc.series_description,
                modality,
                study_description: acc.study_description,
                slice_count: acc.files.len(),
                warnings: acc.warnings,
                unsupported_reason,
            }
        })
        .collect();

    series.sort_by(|a, b| {
        a.modality
            .as_deref()
            .unwrap_or("")
            .cmp(b.modality.as_deref().unwrap_or(""))
            .then_with(|| b.slice_count.cmp(&a.slice_count))
            .then_with(|| {
                a.series_description
                    .as_deref()
                    .unwrap_or("")
                    .cmp(b.series_description.as_deref().unwrap_or(""))
            })
    });

    Ok(DicomDiscoveryResult {
        folder_path: folder.display().to_string(),
        dicom_file_count,
        ignored_file_count,
        series,
        warnings,
    })
}

fn build_dicom_volume_from_folder(folder: PathBuf, series_instance_uid: &str) -> Result<Volume, String> {
    let mut slices = Vec::new();
    let mut skipped_same_folder_dicom = 0usize;
    let mut series_description = None;
    let mut warnings = Vec::new();
    let (candidate_files, _) = collect_files_recursive(&folder, &mut warnings)?;

    for path in candidate_files {
        let object = match open_dicom_file(&path) {
            Ok(object) => object,
            Err(_) => continue,
        };

        if dicom_string_opt(&object, "SeriesInstanceUID").as_deref() != Some(series_instance_uid) {
            skipped_same_folder_dicom += 1;
            continue;
        }

        let modality = dicom_string_opt(&object, "Modality")
            .ok_or_else(|| format!("{} is missing Modality; CT import cannot continue.", display_name(&path)))?;
        if modality != "CT" {
            return Err(format!(
                "Unsupported DICOM modality '{modality}'. v0.18 imports CT series only."
            ));
        }
        merge_optional_string(&mut series_description, dicom_string_opt(&object, "SeriesDescription"));
        slices.push(parse_dicom_slice(&object, path)?);
    }

    if slices.is_empty() {
        return Err("No DICOM slices from the selected series were found in that folder.".to_string());
    }

    validate_and_sort_dicom_slices(&mut slices, &mut warnings)?;
    let first = slices
        .first()
        .ok_or_else(|| "Selected DICOM series has no slices.".to_string())?;
    let dims = [first.cols, first.rows, slices.len()];
    let voxel_count = checked_voxel_count(dims)?;
    let mut voxels = Vec::with_capacity(voxel_count);
    for slice in &slices {
        voxels.extend_from_slice(&slice.voxels);
    }

    if voxels.len() != voxel_count {
        return Err(format!(
            "Malformed DICOM series: expected {voxel_count} voxels but decoded {}.",
            voxels.len()
        ));
    }

    if skipped_same_folder_dicom > 0 {
        warnings.push(format!(
            "Ignored {skipped_same_folder_dicom} DICOM file(s) from other series in the selected folder."
        ));
    }

    let raw_spacing = dicom_spacing(first, &slices, &mut warnings);
    let orientation = dicom_orientation(first, raw_spacing, &mut warnings)?;
    let canonical_dims = orientation.canonical_dims(dims);
    let spacing = orientation.canonical_spacing(raw_spacing);
    let (min_hu, max_hu) = intensity_range(&voxels)?;
    let mut orientation_info = orientation.info.clone();
    orientation_info.warnings.extend(dicom_series_warnings(first, &slices));
    orientation_info.warnings.sort();
    orientation_info.warnings.dedup();
    let voxels = canonicalize_voxels(
        voxels,
        dims,
        canonical_dims,
        &OrientationTransform {
            canonical_to_raw: orientation.canonical_to_raw,
            info: orientation_info.clone(),
        },
    )?;

    Ok(Volume {
        id: String::new(),
        source_path: format!(
            "DICOM: {} ({})",
            series_description.unwrap_or_else(|| "CT series".to_string()),
            folder.display()
        ),
        width: canonical_dims[0],
        height: canonical_dims[1],
        depth: canonical_dims[2],
        spacing,
        orientation: OrientationTransform {
            canonical_to_raw: orientation.canonical_to_raw,
            info: orientation_info,
        },
        encoding: "dicom-import".to_string(),
        nrrd_type: "ct-int16-hu".to_string(),
        min_hu,
        max_hu,
        voxels,
    })
}

fn parse_dicom_slice(object: &DefaultDicomObject, path: PathBuf) -> Result<DicomSlice, String> {
    let transfer_syntax = object.meta().transfer_syntax().trim_end_matches('\0');
    if !is_supported_transfer_syntax(transfer_syntax) {
        return Err(format!(
            "{} uses transfer syntax {transfer_syntax}. v0.18 DICOM import currently supports uncompressed little-endian CT pixel data only.",
            display_name(&path)
        ));
    }

    let rows = dicom_int::<u16>(object, "Rows", &path)? as usize;
    let cols = dicom_int::<u16>(object, "Columns", &path)? as usize;
    if rows == 0 || cols == 0 {
        return Err(format!("{} has invalid zero Rows/Columns.", display_name(&path)));
    }
    let samples_per_pixel = dicom_int_opt::<u16>(object, "SamplesPerPixel").unwrap_or(1);
    if samples_per_pixel != 1 {
        return Err(format!(
            "{} has SamplesPerPixel={samples_per_pixel}; CT grayscale slices only are supported.",
            display_name(&path)
        ));
    }
    let bits_allocated = dicom_int::<u16>(object, "BitsAllocated", &path)?;
    let bits_stored = dicom_int_opt::<u16>(object, "BitsStored").unwrap_or(bits_allocated);
    if bits_allocated != 16 || bits_stored > 16 {
        return Err(format!(
            "{} has BitsAllocated={bits_allocated}, BitsStored={bits_stored}; only 16-bit CT pixels are supported.",
            display_name(&path)
        ));
    }

    let pixel_representation = dicom_int_opt::<u16>(object, "PixelRepresentation").unwrap_or(0);
    let frame_count = dicom_string_opt(object, "NumberOfFrames")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(1);
    if frame_count != 1 {
        return Err(format!(
            "{} is multi-frame ({frame_count} frames); v0.18 imports single-frame CT series only.",
            display_name(&path)
        ));
    }

    let pixel_bytes = object
        .element_by_name("PixelData")
        .map_err(|_| format!("{} is missing PixelData.", display_name(&path)))?
        .to_bytes()
        .map_err(|error| format!("Could not read PixelData from {}: {error}", display_name(&path)))?;
    let expected_bytes = rows
        .checked_mul(cols)
        .and_then(|count| count.checked_mul(2))
        .ok_or_else(|| format!("{} has pixel dimensions that are too large.", display_name(&path)))?;
    if pixel_bytes.len() < expected_bytes {
        return Err(format!(
            "{} has incomplete PixelData: expected at least {expected_bytes} bytes, found {}.",
            display_name(&path),
            pixel_bytes.len()
        ));
    }

    let slope = dicom_float_opt(object, "RescaleSlope").unwrap_or(1.0);
    let intercept = dicom_float_opt(object, "RescaleIntercept").unwrap_or(0.0);
    let mut voxels = Vec::with_capacity(rows * cols);
    for chunk in pixel_bytes.chunks_exact(2).take(rows * cols) {
        let raw = if pixel_representation == 0 {
            u16::from_le_bytes([chunk[0], chunk[1]]) as f32
        } else {
            i16::from_le_bytes([chunk[0], chunk[1]]) as f32
        };
        voxels.push((raw * slope + intercept).round().clamp(i16::MIN as f32, i16::MAX as f32) as i16);
    }

    Ok(DicomSlice {
        path,
        rows,
        cols,
        position: dicom_float_vec(object, "ImagePositionPatient").and_then(|v| array3(&v)),
        orientation: dicom_float_vec(object, "ImageOrientationPatient").and_then(|v| {
            if v.len() == 6 {
                Some([[v[0], v[1], v[2]], [v[3], v[4], v[5]]])
            } else {
                None
            }
        }),
        pixel_spacing: dicom_float_vec(object, "PixelSpacing").and_then(|v| {
            if v.len() >= 2 {
                Some([v[0], v[1]])
            } else {
                None
            }
        }),
        instance_number: dicom_int_opt::<i32>(object, "InstanceNumber"),
        rescale_slope: slope,
        rescale_intercept: intercept,
        voxels,
    })
}

fn validate_and_sort_dicom_slices(
    slices: &mut [DicomSlice],
    warnings: &mut Vec<String>,
) -> Result<(), String> {
    let first = slices
        .first()
        .ok_or_else(|| "Selected DICOM series has no slices.".to_string())?;
    for slice in slices.iter() {
        if slice.rows != first.rows || slice.cols != first.cols {
            return Err(format!(
                "Malformed DICOM series: {} has dimensions {} x {}, expected {} x {}.",
                display_name(&slice.path),
                slice.cols,
                slice.rows,
                first.cols,
                first.rows
            ));
        }
        if slice.pixel_spacing != first.pixel_spacing {
            warnings.push("PixelSpacing varies across slices; measurements may be approximate.".to_string());
        }
        if slice.orientation != first.orientation {
            warnings.push("ImageOrientationPatient varies across slices; orientation may be approximate.".to_string());
        }
        if (slice.rescale_slope - first.rescale_slope).abs() > 0.001
            || (slice.rescale_intercept - first.rescale_intercept).abs() > 0.001
        {
            warnings.push("Rescale slope/intercept varies across slices; HU conversion was applied per slice.".to_string());
        }
    }
    warnings.sort();
    warnings.dedup();

    let normal = first.orientation.map(|orientation| cross(orientation[0], orientation[1]));
    if let Some(normal) = normal {
        if slices.iter().all(|slice| slice.position.is_some()) {
            slices.sort_by(|a, b| {
                let ad = dot(a.position.unwrap_or([0.0, 0.0, 0.0]), normal);
                let bd = dot(b.position.unwrap_or([0.0, 0.0, 0.0]), normal);
                ad.partial_cmp(&bd).unwrap_or(Ordering::Equal)
            });
            return Ok(());
        }
    }

    if slices.iter().all(|slice| slice.instance_number.is_some()) {
        warnings.push(
            "Image position/orientation metadata is incomplete; sorted slices by InstanceNumber.".to_string(),
        );
        slices.sort_by_key(|slice| slice.instance_number.unwrap_or_default());
        return Ok(());
    }

    Err("Malformed DICOM series: cannot sort slices safely because ImagePositionPatient/ImageOrientationPatient and InstanceNumber are incomplete.".to_string())
}

fn dicom_spacing(first: &DicomSlice, slices: &[DicomSlice], warnings: &mut Vec<String>) -> [f32; 3] {
    let [row_spacing, col_spacing] = match first.pixel_spacing {
        Some(spacing) if spacing[0].is_finite() && spacing[0] > 0.0 && spacing[1].is_finite() && spacing[1] > 0.0 => spacing,
        _ => {
            warnings.push("PixelSpacing is missing or invalid; using 1.0 mm in-plane spacing.".to_string());
            [1.0, 1.0]
        }
    };

    let slice_spacing = estimate_slice_spacing(first, slices).unwrap_or_else(|| {
        warnings.push("Slice spacing metadata is incomplete; using 1.0 mm between slices.".to_string());
        1.0
    });

    [col_spacing, row_spacing, slice_spacing]
}

fn estimate_slice_spacing(first: &DicomSlice, slices: &[DicomSlice]) -> Option<f32> {
    if slices.len() < 2 {
        return Some(1.0);
    }
    let normal = first.orientation.map(|orientation| cross(orientation[0], orientation[1]))?;
    let mut positions: Vec<f32> = slices
        .iter()
        .filter_map(|slice| slice.position.map(|position| dot(position, normal)))
        .collect();
    if positions.len() < 2 {
        return None;
    }
    positions.sort_by(|a, b| a.partial_cmp(b).unwrap_or(Ordering::Equal));
    let mut gaps: Vec<f32> = positions
        .windows(2)
        .map(|pair| (pair[1] - pair[0]).abs())
        .filter(|gap| gap.is_finite() && *gap > 0.0)
        .collect();
    if gaps.is_empty() {
        return None;
    }
    gaps.sort_by(|a, b| a.partial_cmp(b).unwrap_or(Ordering::Equal));
    Some(gaps[gaps.len() / 2])
}

fn dicom_orientation(
    first: &DicomSlice,
    raw_spacing: [f32; 3],
    warnings: &mut Vec<String>,
) -> Result<OrientationTransform, String> {
    let mut fields = HashMap::new();
    fields.insert("space".to_string(), "left-posterior-superior".to_string());
    fields.insert("kinds".to_string(), "domain domain domain".to_string());

    if let Some(origin) = first.position {
        fields.insert(
            "space origin".to_string(),
            format!("({},{},{})", origin[0], origin[1], origin[2]),
        );
    } else {
        warnings.push("ImagePositionPatient is missing; origin is approximate.".to_string());
    }

    if let Some(orientation) = first.orientation {
        let normal = cross(orientation[0], orientation[1]);
        let col = scale(orientation[0], raw_spacing[0]);
        let row = scale(orientation[1], raw_spacing[1]);
        let slice = scale(normal, raw_spacing[2]);
        fields.insert(
            "space directions".to_string(),
            format!(
                "({},{},{}) ({},{},{}) ({},{},{})",
                col[0], col[1], col[2], row[0], row[1], row[2], slice[0], slice[1], slice[2]
            ),
        );
    } else {
        warnings.push(
            "ImageOrientationPatient is missing; assuming raw DICOM pixel axes approximate RAS.".to_string(),
        );
    }

    let mut orientation = build_orientation_transform(&fields, [first.cols, first.rows, 1], raw_spacing)?;
    orientation.info.warnings.extend(warnings.clone());
    orientation.info.warnings.sort();
    orientation.info.warnings.dedup();
    Ok(orientation)
}

fn dicom_series_warnings(first: &DicomSlice, slices: &[DicomSlice]) -> Vec<String> {
    let mut warnings = Vec::new();
    if first.position.is_none() {
        warnings.push("ImagePositionPatient is missing; origin is approximate.".to_string());
    }
    if first.orientation.is_none() {
        warnings.push("ImageOrientationPatient is missing; orientation labels are approximate.".to_string());
    }
    if first.pixel_spacing.is_none() {
        warnings.push("PixelSpacing is missing; measurement spacing uses a fallback.".to_string());
    }
    if slices.len() < 2 {
        warnings.push("Series contains one slice; MPR depth is limited.".to_string());
    }
    warnings
}

fn resolve_existing_folder(input: &str) -> Result<PathBuf, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("No DICOM folder was selected.".to_string());
    }
    let folder = resolve_path(trimmed).unwrap_or_else(|| PathBuf::from(trimmed));
    if !folder.exists() {
        return Err(format!("DICOM folder not found: {}", folder.display()));
    }
    if !folder.is_dir() {
        return Err(format!("DICOM import expects a folder, not a file: {}", folder.display()));
    }
    Ok(folder)
}

fn collect_files_recursive(root: &Path, warnings: &mut Vec<String>) -> Result<(Vec<PathBuf>, usize), String> {
    let mut files = Vec::new();
    let mut unreadable_count = 0usize;
    collect_files_recursive_inner(root, &mut files, &mut unreadable_count, warnings)?;
    files.sort();
    Ok((files, unreadable_count))
}

fn collect_files_recursive_inner(
    folder: &Path,
    files: &mut Vec<PathBuf>,
    unreadable_count: &mut usize,
    warnings: &mut Vec<String>,
) -> Result<(), String> {
    let entries = fs::read_dir(folder)
        .map_err(|error| format!("Failed to read DICOM folder {}: {error}", folder.display()))?;

    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                warnings.push(format!("A folder entry could not be read: {error}"));
                *unreadable_count += 1;
                continue;
            }
        };
        let path = entry.path();
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(error) => {
                warnings.push(format!("Could not inspect {}: {error}", path.display()));
                *unreadable_count += 1;
                continue;
            }
        };
        if file_type.is_dir() {
            if let Err(error) = collect_files_recursive_inner(&path, files, unreadable_count, warnings) {
                warnings.push(error);
                *unreadable_count += 1;
            }
        } else if file_type.is_file() {
            files.push(path);
        }
    }

    Ok(())
}

fn is_supported_transfer_syntax(uid: &str) -> bool {
    matches!(
        uid,
        "1.2.840.10008.1.2" | "1.2.840.10008.1.2.1" | "1.2.840.10008.1.2.1.99"
    )
}

fn dicom_string_opt(object: &DefaultDicomObject, name: &str) -> Option<String> {
    object
        .element_by_name(name)
        .ok()
        .and_then(|element| element.to_str().ok())
        .map(|value| value.trim_matches(char::from(0)).trim().to_string())
        .filter(|value| !value.is_empty())
}

fn dicom_int<T>(object: &DefaultDicomObject, name: &str, path: &Path) -> Result<T, String>
where
    T: num_traits::NumCast,
    T: std::str::FromStr<Err = ParseIntError>,
    T: Copy,
{
    object
        .element_by_name(name)
        .map_err(|_| format!("{} is missing required DICOM tag {name}.", display_name(path)))?
        .to_int::<T>()
        .map_err(|error| format!("Could not read DICOM tag {name} from {}: {error}", display_name(path)))
}

fn dicom_int_opt<T>(object: &DefaultDicomObject, name: &str) -> Option<T>
where
    T: num_traits::NumCast,
    T: std::str::FromStr<Err = ParseIntError>,
    T: Copy,
{
    object.element_by_name(name).ok()?.to_int::<T>().ok()
}

fn dicom_float_opt(object: &DefaultDicomObject, name: &str) -> Option<f32> {
    object
        .element_by_name(name)
        .ok()?
        .to_multi_float32()
        .ok()?
        .first()
        .copied()
}

fn dicom_float_vec(object: &DefaultDicomObject, name: &str) -> Option<Vec<f32>> {
    object.element_by_name(name).ok()?.to_multi_float32().ok()
}

fn merge_optional_string(target: &mut Option<String>, candidate: Option<String>) {
    if target.is_none() && candidate.is_some() {
        *target = candidate;
    }
}

fn array3(values: &[f32]) -> Option<[f32; 3]> {
    if values.len() >= 3 {
        Some([values[0], values[1], values[2]])
    } else {
        None
    }
}

fn display_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_string())
        .unwrap_or_else(|| path.display().to_string())
}

fn dot(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn cross(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn scale(v: [f32; 3], factor: f32) -> [f32; 3] {
    [v[0] * factor, v[1] * factor, v[2] * factor]
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
