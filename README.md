# VascEdu v0.1 Starter

This is a clean starter rebuild for **VascEdu** using a modern desktop-oriented architecture:

- React + TypeScript + Vite frontend
- Tauri-ready desktop wrapper
- Local-first content model
- Case library
- Case detail screen
- Training workspace
- Real NRRD MPR viewer spike through Rust/Tauri
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

## Run Web Mode

```bash
pnpm install
pnpm dev:web
```

This starts the React/Vite UI in a normal browser at the URL shown in the terminal.
Most screens work in this mode, but the NRRD viewer will show:

```text
NRRD viewer requires Tauri desktop mode. Run pnpm dev.
```

That is expected. Browser mode cannot call the Rust commands that load local NRRD volume bytes.

## Run Desktop Mode

```bash
pnpm install
pnpm dev
```

This starts the Tauri desktop app. Tauri runs the Vite dev server, opens the desktop window, and enables the Rust command bridge used by the NRRD viewer.

You can also run the desktop package directly:

```bash
pnpm --dir apps/desktop dev
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
- Real NRRD axial/coronal/sagittal MPR viewer with slice/window/level and basic distance measurement controls
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

- Orientation-aware reslicing and linked multi-viewport MPR
- DICOM ingest
- Rust-side SQLite persistence
- Oblique/curved MPR and 3D volume rendering
- Advanced measurement tools beyond basic distance
- Crosshair synchronization
- Full device catalog
- Vessel composer
- Real admin authoring CRUD
- Packaging/signing/updater

## Recommended next development order

1. Add orientation-aware reslicing and linked multi-viewport MPR.
2. Replace base64 slice transfer with Tauri binary channel transport.
3. Move attempt/progress persistence from localStorage to SQLite.
4. Expand measurement tools beyond basic distance.
5. Add strict content validation with Zod.
6. Build a true admin case authoring workflow.
7. Add content-pack import/export.
8. Add vessel composer later.


## NRRD MPR viewer spike

The AAA sample case now points to `content/aaa/volumes/sample-aaa-001.nrrd`. In desktop mode, the React `NrrdViewer` calls these Rust commands:

- `volume_load(path)` parses a 3D NRRD file, caches it in memory, and returns a handle, dimensions, spacing, intensity range, and per-plane slice ranges.
- `volume_slice(handle_id, plane, slice_index, window_width, window_level)` windows one axial, coronal, or sagittal slice and returns 8-bit grayscale pixels as base64.
- `volume_release(handle_id)` removes the cached volume.

Supported NRRD scope for this spike:

- 3D volumes only
- `raw` and `ascii/text` encoding
- common integer voxel types: int8/uint8/int16/uint16/int32/uint32
- no gzip encoding yet
- axial, coronal, and sagittal orthogonal slices only
- no oblique or orientation-aware reslicing yet

Run the real viewer with:

```bash
pnpm --dir apps/desktop dev
```

`pnpm dev:web` still opens the React UI, but it cannot call the native Rust volume backend. The desktop app can load the sample even when the loose `content/` file is unavailable because the Rust backend bundles `sample-aaa-001.nrrd` into the binary at compile time.

## Common Windows Errors

- `cargo` or `rustc` is not recognized: install Rust from <https://rustup.rs/>, then open a new terminal.
- `link.exe` not found: install Visual Studio Build Tools with the C++ desktop workload, including the MSVC compiler and Windows SDK.
- Missing `icon.ico`: Tauri expects `apps/desktop/src-tauri/icons/icon.ico`. This repo includes it; if it is deleted, restore it or regenerate icons before running `pnpm build`.
- Tauri window does not open from `pnpm dev`: first run `pnpm --dir apps/desktop dev:web` to confirm Vite starts, then run `pnpm --dir apps/desktop dev` again from a terminal that has Rust/MSVC on PATH.
