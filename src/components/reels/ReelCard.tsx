import {MoreVertical, Plus, Trash2} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';
import {Link} from 'react-router-dom';
import type {ProjectSummary} from '@/api/types';
import {cn} from '@/lib/cn';
import {STATUS, StatusPill} from './StatusPill';
import {formatDuration, thumbBackground} from './thumb';

/** Where a Reel opens, based on how far along it is. */
export function projectHref(p: ProjectSummary): string {
  if (p.status === 'scripting' || p.status === 'draft') return `/app/p/${p.id}/script`;
  if (p.status === 'rendered' || p.status === 'posting' || p.status === 'posted' || p.status === 'post_failed') {
    return `/app/p/${p.id}/publish`;
  }
  return `/app/p/${p.id}/edit`;
}

type Props = {
  project: ProjectSummary;
  onDelete?: (project: ProjectSummary) => void;
  className?: string;
};

export function ReelCard({project, onDelete, className}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const {busy} = STATUS[project.status];

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !menuRef.current?.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [menuOpen]);

  return (
    <article
      className={cn(
        'group relative aspect-[9/16] overflow-hidden rounded-2xl border border-line transition duration-200',
        'hover:-translate-y-1 hover:border-violet/60 hover:shadow-glow',
        className,
      )}
    >
      <Link to={projectHref(project)} className="absolute inset-0" aria-label={`Open ${project.title}`}>
        {project.thumbnailUrl ? (
          <img src={project.thumbnailUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full" style={{background: thumbBackground(project.id)}} />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/85" />
      </Link>

      <div className="pointer-events-none absolute inset-x-2.5 top-2.5 flex items-center justify-between">
        <StatusPill status={project.status} />
        {project.durationSeconds != null ? (
          <span className="rounded-md bg-black/50 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white/90">
            {formatDuration(project.durationSeconds)}
          </span>
        ) : null}
      </div>

      <div className="pointer-events-none absolute inset-x-3 bottom-3">
        <h3 className="line-clamp-2 font-display text-[15px] font-semibold leading-5">{project.title}</h3>
        <p className="mt-1 text-[11px] text-white/60">{project.mode === 'full_ai' ? 'Full AI' : 'Faceless'}</p>
        {busy && project.progress != null ? (
          <div
            className="mt-2 h-1 overflow-hidden rounded-full bg-white/15"
            role="progressbar"
            aria-valuenow={project.progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${STATUS[project.status].label} ${project.progress}%`}
          >
            <div className="h-full rounded-full bg-brand transition-[width] duration-700" style={{width: `${project.progress}%`}} />
          </div>
        ) : null}
      </div>

      {onDelete ? (
        <div ref={menuRef} className="absolute bottom-2 right-1.5">
          <button
            type="button"
            aria-label={`More options for ${project.title}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-lg text-white/70 transition hover:bg-white/15 hover:text-white',
              'opacity-0 focus-visible:opacity-100 group-hover:opacity-100',
              menuOpen && 'bg-white/15 opacity-100',
            )}
          >
            <MoreVertical className="h-4 w-4" />
          </button>
          {menuOpen ? (
            <div role="menu" className="absolute bottom-8 right-0 z-10 w-36 rounded-xl border border-line bg-ink-700 p-1 shadow-card">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onDelete(project);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-bad hover:bg-bad/10"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden /> Delete
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function NewReelCard({className}: {className?: string}) {
  return (
    <Link
      to="/app/new"
      className={cn(
        'flex aspect-[9/16] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/20 text-muted transition',
        'hover:border-violet hover:bg-violet/5 hover:text-white',
        className,
      )}
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white/[0.06]">
        <Plus className="h-5 w-5" aria-hidden />
      </span>
      <span className="font-display text-sm font-medium">New Reel</span>
    </Link>
  );
}

export function ReelCardSkeleton({className}: {className?: string}) {
  return (
    <div
      className={cn('aspect-[9/16] animate-shimmer rounded-2xl border border-line', className)}
      style={{
        backgroundImage: 'linear-gradient(100deg, rgba(255,255,255,0.03) 30%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.03) 70%)',
        backgroundSize: '200% 100%',
      }}
      aria-hidden
    />
  );
}
