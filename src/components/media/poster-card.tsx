import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Clapperboard } from 'lucide-react';
import { STATUS_META } from '../../shared/constants';
import type { WatchStatus } from '../../shared/types';
import { toPersianDigits } from '../../shared/jalali';
import { posterUrl, placeholderTint } from '../../lib/images';
import { Stars } from '../ui/rating';

export function PosterImage({
  src,
  alt,
  className = '',
  eager = false,
}: {
  src: string | null;
  alt: string;
  className?: string;
  eager?: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        className={`flex h-full w-full items-center justify-center ${className}`}
        style={{ background: placeholderTint(alt || 'mmu') }}
        aria-label={alt}
        role="img"
      >
        <Clapperboard size={26} strokeWidth={1.4} className="text-white/35" />
      </div>
    );
  }

  return (
    <div className={`relative h-full w-full ${className}`}>
      {!loaded && <div className="skeleton absolute inset-0 rounded-none" />}
      <img
        src={src}
        alt={alt}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        className={`h-full w-full object-cover transition-opacity duration-500 ${loaded ? 'opacity-100' : 'opacity-0'}`}
      />
    </div>
  );
}

export function StatusBadge({ status, className = '' }: { status: WatchStatus | null | undefined; className?: string }) {
  if (!status) return null;
  const meta = STATUS_META[status];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9.5px] font-medium backdrop-blur ${className}`}
      style={{ background: `${meta.color}22`, color: meta.color, border: `1px solid ${meta.color}3d` }}
    >
      <span className="h-1 w-1 rounded-full" style={{ background: meta.color }} />
      {meta.short}
    </span>
  );
}

export interface PosterCardProps {
  title: string;
  originalTitle?: string | null;
  posterPath?: string | null;
  customPosterData?: string | null;
  year?: number | null;
  rating?: number | null;
  status?: WatchStatus | null;
  to?: string;
  subtitle?: ReactNode;
  badge?: ReactNode;
  /** 0–1 watch progress bar rendered under the poster. */
  progress?: number;
  size?: 'sm' | 'md';
}

export function PosterCard({
  title,
  originalTitle,
  posterPath,
  customPosterData,
  year,
  rating,
  status,
  to,
  subtitle,
  badge,
  progress,
  size = 'md',
}: PosterCardProps) {
  const src = posterUrl(posterPath, size === 'sm' ? 'w185' : 'w342', customPosterData);

  const body = (
    <>
      <div className="poster-frame">
        <PosterImage src={src} alt={title} />
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-1 p-1.5">
          <div className="flex flex-wrap gap-1">
            {badge}
            <StatusBadge status={status} />
          </div>
        </div>
        {progress !== undefined && progress > 0 && (
          <div className="absolute inset-x-0 bottom-0 h-[3px] bg-black/45">
            <div className="h-full bg-accent" style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }} />
          </div>
        )}
        {rating !== null && rating !== undefined && (
          <div
            className="absolute inset-x-0 bottom-0 flex items-center justify-between px-2 pb-1.5 pt-5"
            style={
              // Real posters need a dark scrim; a pastel placeholder needs the page tint.
              src
                ? { background: 'linear-gradient(to top, rgb(0 0 0 / 0.85), transparent)' }
                : { background: 'linear-gradient(to top, rgb(var(--c-canvas) / 0.92), transparent)' }
            }
          >
            <Stars value={rating} size={10} />
            {year && (
              <span className={`text-[10px] font-medium tabular ${src ? 'text-white/75' : 'text-ink-faint'}`}>
                {toPersianDigits(year)}
              </span>
            )}
          </div>
        )}
      </div>
      <h3 className="mt-2 line-clamp-2 text-[12.5px] font-medium leading-5 text-ink" title={title}>
        {title}
      </h3>
      {subtitle ? (
        <p className="mt-0.5 line-clamp-1 text-[10.5px] text-ink-faint">{subtitle}</p>
      ) : originalTitle && originalTitle !== title ? (
        <p className="mt-0.5 line-clamp-1 text-[10.5px] text-ink-faint ltr" dir="ltr">
          {originalTitle}
        </p>
      ) : null}
    </>
  );

  if (to) {
    return (
      <Link to={to} className="poster-card group block min-w-0">
        {body}
      </Link>
    );
  }
  return <div className="poster-card group block min-w-0">{body}</div>;
}
