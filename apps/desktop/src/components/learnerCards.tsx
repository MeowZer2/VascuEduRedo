import type { CSSProperties, ReactNode } from 'react';

interface SectionHeaderProps {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}

export function SectionHeader({ eyebrow, title, description, action }: SectionHeaderProps) {
  return (
    <header className="learner-section-header">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h3>{title}</h3>
        {description && <p className="muted small">{description}</p>}
      </div>
      {action && <div className="learner-section-header-action">{action}</div>}
    </header>
  );
}

interface ImageBannerCardProps {
  imageUrl?: string;
  ratio?: 'hero' | 'wide' | 'medium';
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  align?: 'start' | 'center';
  focal?: string;
  className?: string;
}

export function ImageBannerCard({
  imageUrl,
  ratio = 'hero',
  eyebrow,
  title,
  description,
  children,
  align = 'start',
  focal,
  className,
}: ImageBannerCardProps) {
  const cls = [
    'image-banner-card',
    `image-banner-card--${ratio}`,
    align === 'center' ? 'image-banner-card--center' : '',
    !imageUrl ? 'image-banner-card--no-image' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  const style: CSSProperties = {
    ...(imageUrl ? { backgroundImage: `url(${imageUrl})` } : {}),
    ...(focal ? { backgroundPosition: focal } : {}),
  };
  return (
    <article className={cls} style={style}>
      <div className="image-banner-card-overlay" />
      <div className="image-banner-card-content">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2>{title}</h2>
        {description && <p>{description}</p>}
        {children}
      </div>
    </article>
  );
}

interface TopicCardProps {
  imageUrl?: string;
  title: ReactNode;
  caseCount?: number;
  description?: ReactNode;
  onClick?: () => void;
  ariaLabel?: string;
}

export function TopicCard({ imageUrl, title, caseCount, description, onClick, ariaLabel }: TopicCardProps) {
  const cls = ['topic-card', !imageUrl ? 'topic-card--no-image' : ''].filter(Boolean).join(' ');
  const style: CSSProperties = imageUrl ? { backgroundImage: `url(${imageUrl})` } : {};
  const Wrapper: 'button' | 'article' = onClick ? 'button' : 'article';
  return (
    <Wrapper
      className={cls}
      style={style}
      onClick={onClick}
      aria-label={ariaLabel ?? (typeof title === 'string' ? title : undefined)}
      type={onClick ? 'button' : undefined}
    >
      <div className="topic-card-overlay" />
      <div className="topic-card-content">
        {typeof caseCount === 'number' && (
          <span className="pill on-image">{caseCount} case{caseCount === 1 ? '' : 's'}</span>
        )}
        <h3>{title}</h3>
        {description && <p>{description}</p>}
      </div>
    </Wrapper>
  );
}

interface ActionTileProps {
  imageUrl?: string;
  label: ReactNode;
  caption?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
}

export function ActionTile({
  imageUrl,
  label,
  caption,
  onClick,
  disabled,
  variant = 'secondary',
}: ActionTileProps) {
  const cls = [
    'action-tile',
    `action-tile--${variant}`,
    !imageUrl ? 'action-tile--no-image' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type="button"
      className={cls}
      onClick={onClick}
      disabled={disabled}
      style={imageUrl ? { backgroundImage: `url(${imageUrl})` } : undefined}
    >
      <span className="action-tile-overlay" />
      <span className="action-tile-content">
        <strong>{label}</strong>
        {caption && <span>{caption}</span>}
      </span>
    </button>
  );
}

interface CaseTileProps {
  imageUrl?: string;
  topicLabel?: string;
  title: ReactNode;
  diagnosis?: ReactNode;
  difficulty?: string;
  estimatedMinutes?: number;
  questionCount?: number;
  hasPlan?: boolean;
  tags?: string[];
  onOpenDetails?: () => void;
  onStart: () => void;
}

export function CaseTile({
  imageUrl,
  topicLabel,
  title,
  diagnosis,
  difficulty,
  estimatedMinutes,
  questionCount,
  hasPlan,
  tags,
  onOpenDetails,
  onStart,
}: CaseTileProps) {
  const style: CSSProperties = imageUrl ? { backgroundImage: `url(${imageUrl})` } : {};
  return (
    <article className={`case-tile${imageUrl ? '' : ' case-tile--no-image'}`}>
      <div className="case-tile-image" style={style}>
        <div className="case-tile-image-overlay" />
        {topicLabel && <span className="pill on-image">{topicLabel}</span>}
      </div>
      <div className="case-tile-body">
        <div>
          <h4>{title}</h4>
          {diagnosis && <p className="muted small">{diagnosis}</p>}
        </div>
        {tags && tags.length > 0 && (
          <div className="tag-row">
            {tags.slice(0, 4).map((tag) => (
              <span key={tag} className="tag">{tag}</span>
            ))}
          </div>
        )}
        <ul className="case-tile-meta">
          {difficulty && <li>{difficulty}</li>}
          {typeof estimatedMinutes === 'number' && <li>{estimatedMinutes} min</li>}
          {typeof questionCount === 'number' && <li>{questionCount} questions</li>}
          {hasPlan && <li className="case-tile-meta--accent">procedural plan</li>}
        </ul>
        <div className="row-actions compact-actions">
          {onOpenDetails && (
            <button className="secondary-button small" onClick={onOpenDetails}>
              Details
            </button>
          )}
          <button className="primary-button small" onClick={onStart}>
            Start practice
          </button>
        </div>
      </div>
    </article>
  );
}

interface StatsTileProps {
  label: ReactNode;
  value: ReactNode;
  caption?: ReactNode;
  accent?: 'success' | 'warning' | 'danger';
}

export function StatsTile({ label, value, caption, accent }: StatsTileProps) {
  const cls = ['stats-tile', accent ? `stats-tile--${accent}` : ''].filter(Boolean).join(' ');
  return (
    <div className={cls}>
      <span className="stats-tile-label">{label}</span>
      <strong className="stats-tile-value">{value}</strong>
      {caption && <span className="stats-tile-caption">{caption}</span>}
    </div>
  );
}
