# VascEdu imaging support contract

This is the internal contract for the real CT/NRRD/DICOM MPR loader. It is a deliberately small,
defensive subset and is not a claim of general DICOM or NRRD compatibility.

## Supported NRRD subset

- Three-dimensional scalar volumes with an embedded payload.
- `raw`, `gzip`/`gz`, and `ascii`/`text`/`txt` encodings.
- Signed and unsigned 8-, 16-, and 32-bit integer voxel types.
- Little- and big-endian binary integer payloads.
- Anatomical RAS/LPS-family coordinate spaces whose directions are axis-aligned or near-axis-aligned
  and can be canonicalized once through axis permutation and sign flips.
- Integer source values are stored in the viewer's signed 16-bit intensity representation; wider or
  unsigned NRRD values saturate at that documented internal range for backward compatibility.

Unsupported NRRD features include detached payloads, non-3D data, vector/list/color/time axes,
floating-point voxel types, unsupported encodings, and arbitrary oblique geometry. Oblique or
scanner-only geometry is never described as trusted anatomical MPR: it is surfaced as unsupported or
uncertain, uses unknown anatomical labels, and is not resampled.

## Supported DICOM subset

- CT modality, one file per single-frame slice.
- Native, unencapsulated Pixel Data under Implicit VR Little Endian, Explicit VR Little Endian, or
  Deflated Explicit VR Little Endian transfer syntax.
- One sample per pixel with `MONOCHROME2` photometric interpretation.
- A 16-bit allocated integer container, 1 through 16 stored bits, standard `HighBit = BitsStored - 1`,
  and unsigned or two's-complement signed pixel representation.
- Finite rescale slope/intercept whose rounded result fits the viewer's signed 16-bit HU representation.
- Complete patient position, orientation, and pixel-spacing metadata; consistent in-plane dimensions
  and orientation; and regular, unique slice positions.

Unsupported DICOM features include JPEG, JPEG-LS, JPEG 2000, RLE and other encapsulated Pixel Data,
Explicit VR Big Endian, enhanced or other multiframe objects, `MONOCHROME1`, RGB/palette/multi-sample
pixels, missing geometry, irregular or duplicate slice spacing, materially varying per-slice
orientation or pixel spacing, and arbitrary oblique MPR. VascEdu does not include codecs or oblique
resampling and must reject or explicitly mark these cases unsupported instead of guessing.

## Safety limits

- Maximum volume: 512 Mi voxels and 1 GiB decoded bytes.
- Maximum dimensions: 4,096 rows, 4,096 columns, and 8,192 slices.
- Maximum encoded NRRD input: 1 GiB; maximum NRRD header: 1 MiB.
- Maximum DICOM file: 256 MiB; maximum files in one series: 8,192.
- Maximum candidate files scanned in a DICOM folder tree: 50,000; maximum recursion depth: 32.
- Prepared-volume cache: at most three inactive/active entries and approximately 1 GiB of canonical
  voxel storage when inactive entries can be evicted. Active handles are never invalidated to meet a
  budget; the cache returns toward budget when they are released.

These limits are intended to admit realistic vascular CTA studies while bounding malformed input.
They are implementation safety limits, not clinical validation criteria.
