# VascEdu v0.1 Architecture

## Product identity

VascEdu should start as a **case-based vascular imaging education app**.

The core loop is:

```text
Choose case → review clinical info → inspect CTA/CT → answer questions → read explanations → track progress
```

## Folder layout

```text
apps/desktop/              React + TypeScript + Tauri app
apps/desktop/src-tauri/    Rust/Tauri shell and future native commands
packages/content-schema/   Shared content validation schema
content/                   Future versioned content packs
```

## Current persistence

For v0.1, attempts and progress use `localStorage` to keep the scaffold simple and runnable without Rust/SQLite work.

## Intended production persistence

Move persistence to SQLite through Tauri commands:

```text
React UI → Tauri invoke → Rust command → SQLite
```

## Future modules

- `viewer-core`: NRRD loading, slice extraction, window/level, measurements
- `quiz-engine`: question validation and scoring
- `content-schema`: content-pack validation
- `admin`: content authoring and review workflow


## Viewer spike implemented

The current `v0.1` viewer path is no longer a mock generator. The training workspace renders `NrrdViewer`, which calls Tauri commands implemented in `apps/desktop/src-tauri/src/volume.rs`. The Rust side parses an NRRD file, caches the volume, applies window/level on one axial slice, and sends 8-bit grayscale pixels to the frontend. The frontend converts the returned bytes into `ImageData` and paints a canvas.

This is intentionally a first spike, not full PACS parity. Next improvements should be binary channel transport, coronal/sagittal extraction, orientation handling, pan/zoom, and measurement overlays.
