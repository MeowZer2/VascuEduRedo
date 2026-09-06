import { describe, expect, it } from 'vitest';
import {
  angleDeg,
  applyDisplayFlips,
  distanceMm,
  getDisplayedOrientationLabels,
  getPlaneSpacing,
  paneFromVoxel,
  voxelFromPane,
  type CrosshairVoxel,
  type DisplayFlips,
} from './viewerShared';
import type { VolumePlane } from '../lib/volume';

describe('synthetic MPR spacing and display phantoms', () => {
  const spacing: [number, number, number] = [0.7, 0.7, 2.5];

  it('uses the correct physical axes for axial, coronal, and sagittal distance', () => {
    expect(getPlaneSpacing(spacing, 'axial')).toEqual([0.7, 0.7]);
    expect(getPlaneSpacing(spacing, 'coronal')).toEqual([0.7, 2.5]);
    expect(getPlaneSpacing(spacing, 'sagittal')).toEqual([0.7, 2.5]);

    expect(distanceMm({ x: 0, y: 0 }, { x: 3, y: 4 }, getPlaneSpacing(spacing, 'axial')))
      .toBeCloseTo(3.5);
    expect(distanceMm({ x: 0, y: 0 }, { x: 10, y: 2 }, getPlaneSpacing(spacing, 'coronal')))
      .toBeCloseTo(Math.sqrt(74));
    expect(distanceMm({ x: 0, y: 0 }, { x: 10, y: 2 }, getPlaneSpacing(spacing, 'sagittal')))
      .toBeCloseTo(Math.sqrt(74));
  });

  it('keeps physical distance and angle invariant under display-only flips', () => {
    const imageSize = { width: 20, height: 10 };
    const flips: DisplayFlips = { flipX: true, flipY: true };
    const start = { x: 2, y: 2 };
    const vertex = { x: 6, y: 2 };
    const end = { x: 6, y: 6 };
    const planeSpacing: [number, number] = [0.7, 2.5];

    const flippedStart = applyDisplayFlips(start, imageSize, flips);
    const flippedVertex = applyDisplayFlips(vertex, imageSize, flips);
    const flippedEnd = applyDisplayFlips(end, imageSize, flips);
    expect(distanceMm(flippedStart, flippedVertex, planeSpacing)).toBeCloseTo(
      distanceMm(start, vertex, planeSpacing),
    );
    expect(angleDeg(flippedStart, flippedVertex, flippedEnd, planeSpacing)).toBeCloseTo(
      angleDeg(start, vertex, end, planeSpacing),
    );
  });

  it('round-trips the canonical crosshair through every MPR plane', () => {
    const dims: [number, number, number] = [11, 13, 17];
    const voxel: CrosshairVoxel = { x: 3, y: 5, z: 7 };
    for (const plane of ['axial', 'coronal', 'sagittal'] satisfies VolumePlane[]) {
      const pane = paneFromVoxel(voxel, plane, dims);
      expect(voxelFromPane(voxel, plane, pane.px, pane.py, pane.slice, dims)).toEqual(voxel);
    }
  });

  it('moves anatomical labels with the displayed PACS flip, not voxel geometry', () => {
    const canonical = { left: 'L', right: 'R', top: 'P', bottom: 'A' };
    expect(getDisplayedOrientationLabels(canonical, { flipX: true, flipY: true })).toEqual({
      left: 'R',
      right: 'L',
      top: 'A',
      bottom: 'P',
    });
  });
});
