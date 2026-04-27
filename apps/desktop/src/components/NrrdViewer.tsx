import { useEffect, useMemo, useRef, useState } from 'react';
import { base64ToUint8Array, loadAxialSlice, loadVolume, releaseVolume, type VolumeInfo } from '../lib/volume';

interface NrrdViewerProps {
  volumePath: string;
  description: string;
}

type ViewerStatus = 'loading' | 'ready' | 'error';

function midpoint(max: number): number {
  return Math.max(0, Math.floor((max - 1) / 2));
}

export function NrrdViewer({ volumePath, description }: NrrdViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [volume, setVolume] = useState<VolumeInfo | null>(null);
  const [status, setStatus] = useState<ViewerStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [slice, setSlice] = useState(0);
  const [windowWidth, setWindowWidth] = useState(700);
  const [windowLevel, setWindowLevel] = useState(80);

  useEffect(() => {
    let cancelled = false;
    let loadedHandle: string | null = null;

    setStatus('loading');
    setError(null);
    setVolume(null);

    loadVolume(volumePath)
      .then((info) => {
        if (cancelled) {
          void releaseVolume(info.id);
          return;
        }
        loadedHandle = info.id;
        setVolume(info);
        setSlice(midpoint(info.axialSliceCount));
        setStatus('ready');
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setStatus('error');
        setError(caught instanceof Error ? caught.message : String(caught));
      });

    return () => {
      cancelled = true;
      if (loadedHandle) {
        void releaseVolume(loadedHandle);
      }
    };
  }, [volumePath]);

  useEffect(() => {
    if (!volume || status !== 'ready') return;
    let cancelled = false;

    loadAxialSlice(volume.id, slice, windowWidth, windowLevel)
      .then((image) => {
        if (cancelled) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const gray = base64ToUint8Array(image.bytesBase64);
        const rgba = ctx.createImageData(image.width, image.height);
        for (let index = 0; index < gray.length; index += 1) {
          const pixelOffset = index * 4;
          const value = gray[index];
          rgba.data[pixelOffset] = value;
          rgba.data[pixelOffset + 1] = value;
          rgba.data[pixelOffset + 2] = value;
          rgba.data[pixelOffset + 3] = 255;
        }
        ctx.putImageData(rgba, 0, 0);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setStatus('error');
        setError(caught instanceof Error ? caught.message : String(caught));
      });

    return () => {
      cancelled = true;
    };
  }, [volume, slice, windowWidth, windowLevel, status]);

  const metadata = useMemo(() => {
    if (!volume) return null;
    const [width, height, depth] = volume.dims;
    const [sx, sy, sz] = volume.spacing;
    const [minHu, maxHu] = volume.intensityRange;
    return `${width} × ${height} × ${depth} voxels · ${sx.toFixed(2)} / ${sy.toFixed(2)} / ${sz.toFixed(2)} mm · HU ${minHu} to ${maxHu}`;
  }, [volume]);

  return (
    <section className="viewer-card">
      <div className="viewer-header">
        <div>
          <h3>NRRD CTA Viewer</h3>
          <p>{description}</p>
          {metadata ? <p className="viewer-metadata">{metadata}</p> : null}
        </div>
        <span className="pill">Axial · Real NRRD</span>
      </div>

      <div className="canvas-wrap nrrd-canvas-wrap">
        {status === 'loading' ? <div className="viewer-state">Loading NRRD volume through Rust…</div> : null}
        {status === 'error' ? (
          <div className="viewer-state viewer-state-error">
            <strong>Viewer backend unavailable</strong>
            <span>{error}</span>
          </div>
        ) : null}
        <canvas ref={canvasRef} aria-label="Axial slice rendered from an NRRD volume" />
        {volume && status === 'ready' ? (
          <div className="measurement-overlay">
            Slice {slice + 1}/{volume.axialSliceCount} · W {windowWidth} / L {windowLevel}
          </div>
        ) : null}
      </div>

      <div className="viewer-controls">
        <label>
          Slice {volume ? `${slice + 1}/${volume.axialSliceCount}` : '—'}
          <input
            type="range"
            min="0"
            max={Math.max(0, (volume?.axialSliceCount ?? 1) - 1)}
            value={slice}
            disabled={!volume || status !== 'ready'}
            onChange={(event) => setSlice(Number(event.target.value))}
          />
        </label>
        <label>
          Window {windowWidth}
          <input
            type="range"
            min="50"
            max="1600"
            step="10"
            value={windowWidth}
            disabled={!volume || status !== 'ready'}
            onChange={(event) => setWindowWidth(Number(event.target.value))}
          />
        </label>
        <label>
          Level {windowLevel}
          <input
            type="range"
            min="-300"
            max="500"
            step="5"
            value={windowLevel}
            disabled={!volume || status !== 'ready'}
            onChange={(event) => setWindowLevel(Number(event.target.value))}
          />
        </label>
      </div>
    </section>
  );
}
