// Ported from the VascEdu design prototype (components.jsx).
// Small shared presentational bits used by the Home / Cases layouts.
import type { CSSProperties, ReactNode } from 'react';
import { IcBranch, IcClock, IcKey, IcSlice } from './icons';
import { ScanFor } from './scans';

export function Pill({
  children,
  variant,
  mono,
}: {
  children: ReactNode;
  variant?: 'accent' | 'blue' | 'success' | 'warning' | 'danger' | 'outline';
  mono?: boolean;
}) {
  return <span className={`pill ${variant || ''} ${mono ? 'pill-mono' : ''}`}>{children}</span>;
}

export function StatCard({
  label,
  value,
  unit,
  delta,
  deltaDir,
  sub,
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: string;
  delta?: ReactNode;
  deltaDir?: 'up' | 'down';
  sub?: ReactNode;
}) {
  return (
    <div className="metric-tile">
      <div>
        <div className="label">{label}</div>
        <div className="value">
          {value}
          {unit && <span className="unit">{unit}</span>}
        </div>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {delta && (
        <div className={`stat-delta ${deltaDir || ''}`}>
          {deltaDir === 'up' ? '▲' : deltaDir === 'down' ? '▼' : ''} {delta}
        </div>
      )}
    </div>
  );
}

export function SectionHead({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="section-head">
      <div>
        {eyebrow && <div className="page-eyebrow">{eyebrow}</div>}
        <h3>{title}</h3>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Spark({ values, highlightIdx }: { values: number[]; highlightIdx?: number }) {
  const max = Math.max(...values, 1);
  return (
    <div className="spark">
      {values.map((v, i) => (
        <i
          // eslint-disable-next-line react/no-array-index-key
          key={i}
          className={i === (highlightIdx ?? values.length - 1) ? 'now' : ''}
          style={{ height: `${(v / max) * 100}%` }}
        />
      ))}
    </div>
  );
}

export function Ring({
  percent,
  size = 132,
  label = 'Avg',
}: {
  percent: number;
  size?: number;
  label?: string;
}) {
  return (
    <div className="ring" style={{ '--p': percent, '--size': `${size}px` } as CSSProperties}>
      <div className="ring-inner">
        <strong>{percent}%</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}

// Content layer style for tiles that carry a photo background — keeps text and
// chips above the absolutely-positioned image/overlay layers.
export const TILE_CONTENT: CSSProperties = { position: 'relative', zIndex: 1 };

// Photo + gradient overlay layers for a .tile / banner that has a real image.
// Returns null when no image so the caller keeps its plain surface.
export function PhotoLayers({
  imageUrl,
  overlay = 'tile',
}: {
  imageUrl?: string;
  overlay?: 'tile' | 'banner';
}) {
  if (!imageUrl) return null;
  const grad =
    overlay === 'banner'
      ? 'linear-gradient(110deg, rgba(5,8,14,0.9) 0%, rgba(5,8,14,0.74) 38%, rgba(5,8,14,0.36) 70%, rgba(5,8,14,0.18) 100%)'
      : 'linear-gradient(180deg, rgba(5,8,14,0.2) 0%, rgba(5,8,14,0.52) 55%, rgba(5,8,14,0.92) 100%)';
  return (
    <>
      <span
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `url(${imageUrl})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          zIndex: 0,
        }}
      />
      <span aria-hidden style={{ position: 'absolute', inset: 0, background: grad, zIndex: 0 }} />
    </>
  );
}

// Renders a real photo when one is available, otherwise falls back to the
// synthetic scan thumbnail so a box is never blank.
export function Thumb({
  imageUrl,
  categoryId,
  label,
  wide,
  tall,
}: {
  imageUrl?: string;
  categoryId: string;
  label?: string;
  wide?: boolean;
  tall?: boolean;
}) {
  if (imageUrl) {
    return (
      <div
        aria-hidden
        style={{
          width: '100%',
          height: '100%',
          backgroundImage: `url(${imageUrl})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      />
    );
  }
  return <ScanFor categoryId={categoryId} wide={wide} tall={tall} label={label} />;
}

export interface CaseCardModel {
  id: string;
  categoryId: string;
  title: string;
  diagnosis: string;
  difficulty: string;
  estimatedMinutes: number;
  questionCount: number;
  slices?: number;
  hasPlan?: boolean;
  thumbLabel?: string;
  imageUrl?: string;
}

export function CaseCard({
  vascCase,
  categoryName,
  onOpen,
}: {
  vascCase: CaseCardModel;
  categoryName?: string;
  onOpen: () => void;
}) {
  return (
    <article
      className="case-card"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`Open ${vascCase.title}`}
    >
      <div className="case-thumb">
        <Thumb
          imageUrl={vascCase.imageUrl}
          categoryId={vascCase.categoryId}
          wide
          label={vascCase.thumbLabel}
        />
      </div>
      <div className="case-body">
        <div className="case-meta-row">
          {categoryName && (
            <Pill variant="accent" mono>
              {categoryName}
            </Pill>
          )}
          <Pill mono>{vascCase.difficulty}</Pill>
          {vascCase.hasPlan && (
            <Pill variant="blue" mono>
              <IcBranch size={11} /> plan
            </Pill>
          )}
        </div>
        <h4>{vascCase.title}</h4>
        <p className="case-diag">{vascCase.diagnosis}</p>
        <div className="case-foot">
          <span className="case-foot-stat">
            <IcClock size={12} /> {vascCase.estimatedMinutes} min
          </span>
          <span className="case-foot-stat">
            <IcKey size={12} /> {vascCase.questionCount} Qs
          </span>
          <span className="case-foot-stat">
            <IcSlice size={12} /> {vascCase.slices ?? 280} sl
          </span>
        </div>
      </div>
    </article>
  );
}
