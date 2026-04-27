# VascEdu v0.1 Starter

This is a clean starter rebuild for **VascEdu** using a modern desktop-oriented architecture:

- React + TypeScript + Vite frontend
- Tauri-ready desktop wrapper
- Local-first content model
- Case library
- Case detail screen
- Training workspace
- Real NRRD axial viewer spike through Rust/Tauri
- Quiz engine
- Progress saved in localStorage
- Admin/content preview screen
- Rust/Tauri command scaffold
- SQLite schema draft
- Content-pack folder structure

This is intentionally **v0.1**, not a full final app. The purpose is to give you a clean base that can scale into the real VascEdu application.

## Requirements

Install:

- Node.js LTS
- pnpm
- Rust stable
- Tauri prerequisites for your OS

## Run as web app first

```bash
cd VascEdu-v0.1
pnpm install
pnpm dev:web  # UI-only; NRRD viewer needs desktop mode
```

Open the Vite URL shown in the terminal.

## Run as desktop app with Tauri

```bash
cd VascEdu-v0.1
pnpm install
pnpm dev
```

## Build

```bash
pnpm build:web
pnpm build
```

## What works in this scaffold

- Home dashboard
- Case library
- Case detail
- Start training from a case
- Real NRRD axial viewer with slice/window/level controls
- Multiple question types:
  - multiple choice
  - multi-select
  - true/false
  - numeric with tolerance
  - short text keyword matching
  - measurement-style numeric question
- Hints
- Score calculation
- Attempt history saved locally
- Progress page
- Admin/content health preview

## What is intentionally not implemented yet

- Coronal/sagittal MPR and orientation-aware reslicing
- DICOM ingest
- Rust-side SQLite persistence
- True MPR axial/coronal/sagittal volume rendering
- Measurement drawing tools
- Crosshair synchronization
- Full device catalog
- Vessel composer
- Real admin authoring CRUD
- Packaging/signing/updater

## Recommended next development order

1. Add coronal/sagittal MPR and orientation-aware reslicing.
2. Replace base64 slice transfer with Tauri binary channel transport.
3. Move attempt/progress persistence from localStorage to SQLite.
4. Add real measurement tools.
5. Add strict content validation with Zod.
6. Build a true admin case authoring workflow.
7. Add content-pack import/export.
8. Add vessel composer later.


## NRRD viewer spike

The AAA sample case now points to `content/aaa/volumes/sample-aaa-001.nrrd`. In desktop mode, the React `NrrdViewer` calls these Rust commands:

- `volume_load(path)` parses a 3D NRRD file, caches it in memory, and returns dimensions, spacing, and HU range.
- `volume_slice_axial(handle_id, slice_index, window_width, window_level)` windows one axial slice and returns 8-bit grayscale pixels as base64.
- `volume_release(handle_id)` removes the cached volume.

Supported NRRD scope for this spike:

- 3D volumes only
- `raw` and `ascii/text` encoding
- common integer voxel types: int8/uint8/int16/uint16/int32/uint32
- no gzip encoding yet
- axial only; no coronal/sagittal reslicing yet

Run the real viewer with:

```bash
pnpm --dir apps/desktop dev
```

`pnpm dev:web` still opens the React UI, but it cannot call the native Rust volume backend.
