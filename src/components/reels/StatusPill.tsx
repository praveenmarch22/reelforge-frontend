import type {ProjectStatus} from '@/api/types';
import {cn} from '@/lib/cn';

type Tone = 'green' | 'cyan' | 'violet' | 'grey' | 'red' | 'amber';

export const STATUS: Record<ProjectStatus, {label: string; tone: Tone; busy?: boolean}> = {
  scripting: {label: 'Writing', tone: 'violet', busy: true},
  draft: {label: 'Draft', tone: 'grey'},
  generating: {label: 'Generating', tone: 'violet', busy: true},
  needs_attention: {label: 'Needs attention', tone: 'amber'},
  ready: {label: 'Ready', tone: 'cyan'},
  rendering: {label: 'Rendering', tone: 'violet', busy: true},
  render_failed: {label: 'Failed', tone: 'red'},
  rendered: {label: 'Rendered', tone: 'cyan'},
  posting: {label: 'Posting', tone: 'violet', busy: true},
  post_failed: {label: 'Failed', tone: 'red'},
  posted: {label: 'Posted', tone: 'green'},
};

const tones: Record<Tone, string> = {
  green: 'bg-ok/15 text-ok',
  cyan: 'bg-cyan/15 text-cyan',
  violet: 'bg-violet/20 text-violet-soft',
  grey: 'bg-white/10 text-white/70',
  red: 'bg-bad/15 text-bad',
  amber: 'bg-warn/15 text-warn',
};

const dots: Record<Tone, string> = {
  green: 'bg-ok',
  cyan: 'bg-cyan',
  violet: 'bg-violet-soft',
  grey: 'bg-white/50',
  red: 'bg-bad',
  amber: 'bg-warn',
};

export function StatusPill({status, className}: {status: ProjectStatus; className?: string}) {
  const {label, tone, busy} = STATUS[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold backdrop-blur',
        tones[tone],
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', dots[tone], busy && 'animate-pulse')} aria-hidden />
      {label}
    </span>
  );
}
