import {ArrowRight, Sparkles, Zap} from 'lucide-react';
import {useState, type FormEvent, type ReactNode} from 'react';
import {Link, useNavigate} from 'react-router-dom';
import {useMe, useProjects} from '@/api/hooks';
import type {Mode} from '@/api/types';
import {PageHeader} from '@/components/layout/AppShell';
import {NewReelCard, ReelCard, ReelCardSkeleton} from '@/components/reels/ReelCard';
import {Button} from '@/components/ui/Button';
import {Notice} from '@/components/ui/Notice';
import {cn} from '@/lib/cn';

const LENGTHS = [15, 30, 60, 90] as const;
const STARTER_IDEAS = [
  '3 habits that changed my mornings',
  'A fact nobody knows about the ocean',
  'How I save 30% of my salary',
];

function Chip({active, onClick, children}: {active: boolean; onClick: () => void; children: ReactNode}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'h-8 rounded-full border px-3.5 text-[13px] font-medium transition',
        active ? 'border-violet bg-violet/20 text-white' : 'border-line bg-white/[0.03] text-muted hover:text-white',
      )}
    >
      {children}
    </button>
  );
}

function StatTile({label, value, hint}: {label: string; value: string; hint?: string}) {
  return (
    <div className="glass px-5 py-4">
      <p className="text-xs font-medium uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-1.5 font-display text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

function daysUntil(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 864e5));
}

export function DashboardPage() {
  const navigate = useNavigate();
  const {data: user} = useMe();
  const projects = useProjects({limit: 5});
  const [topic, setTopic] = useState('');
  const [mode, setMode] = useState<Mode>(user?.defaults.mode ?? 'faceless');
  const [seconds, setSeconds] = useState<(typeof LENGTHS)[number]>(30);

  const goToNewReel = (opts: {topic?: string; ideas?: boolean}) => {
    const params = new URLSearchParams({mode, length: String(seconds)});
    if (opts.topic) params.set('topic', opts.topic);
    if (opts.ideas) params.set('ideas', '1');
    navigate(`/app/new?${params}`);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    goToNewReel({topic: topic.trim()});
  };

  const items = projects.data?.items ?? [];
  const counts = projects.data?.counts;
  const isEmpty = projects.isSuccess && counts?.total === 0;
  const firstName = user?.name.split(' ')[0] || 'there';

  return (
    <>
      <PageHeader title={isEmpty ? `Welcome, ${firstName}` : `Hey ${firstName}`} />

      <section className="glass relative overflow-hidden p-6 sm:p-8" aria-label="Start a new Reel">
        <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-violet/20 blur-3xl" />
        <form onSubmit={onSubmit} className="relative">
          <div className="ring-brand flex items-center gap-2 rounded-2xl bg-black/40 p-2 shadow-[0_0_50px_-12px_rgba(124,92,255,0.6)]">
            <Button variant="secondary" size="md" className="shrink-0" onClick={() => goToNewReel({ideas: true})}>
              <Sparkles className="h-4 w-4 text-violet-soft" aria-hidden /> Ideas
            </Button>
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              maxLength={300}
              placeholder="What's your next Reel about?"
              aria-label="What's your next Reel about?"
              className="h-11 min-w-0 flex-1 bg-transparent px-2 text-base text-white placeholder:text-white/35 focus:outline-none"
            />
            <Button type="submit" size="md" className="shrink-0">
              Create <Zap className="h-4 w-4" aria-hidden />
            </Button>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Chip active={mode === 'faceless'} onClick={() => setMode('faceless')}>
              Faceless
            </Chip>
            <Chip active={mode === 'full_ai'} onClick={() => setMode('full_ai')}>
              Full AI
            </Chip>
            <span className="mx-1 h-4 w-px bg-line" aria-hidden />
            {LENGTHS.map((s) => (
              <Chip key={s} active={seconds === s} onClick={() => setSeconds(s)}>
                {s}s
              </Chip>
            ))}
          </div>
        </form>
      </section>

      {projects.isError ? (
        <Notice tone="error" className="mt-8">
          We couldn't load your Reels.{' '}
          <button type="button" className="font-semibold text-white underline" onClick={() => void projects.refetch()}>
            Try again
          </button>
        </Notice>
      ) : isEmpty ? (
        <section className="mt-10" aria-label="Getting started">
          <div className="grid grid-cols-3 gap-4 sm:max-w-xl">
            {[0, 1, 2].map((i) => (
              <div key={i} className="aspect-[9/16] rounded-2xl border border-dashed border-white/15 bg-white/[0.02]" aria-hidden />
            ))}
          </div>
          <p className="mt-5 font-display text-lg">Your Reels will appear here</p>
          <p className="mt-1 text-sm text-muted">Start with one of these, or type your own idea above.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {STARTER_IDEAS.map((idea) => (
              <button
                key={idea}
                type="button"
                onClick={() => goToNewReel({topic: idea})}
                className="rounded-full border border-line bg-white/[0.04] px-4 py-2 text-[13px] text-white/90 transition hover:border-violet hover:bg-violet/10"
              >
                {idea}
              </button>
            ))}
          </div>
        </section>
      ) : (
        <>
          <section className="mt-6 grid gap-4 sm:grid-cols-3" aria-label="Summary">
            <StatTile label="Reels made" value={counts ? String(counts.total) : '–'} />
            <StatTile label="Posted" value={counts ? String(counts.posted) : '–'} />
            <StatTile
              label="Credits reset in"
              value={user ? `${daysUntil(user.credits.resetsAt)} days` : '–'}
              hint={user ? `${user.credits.balance} of ${user.credits.monthlyAllowance} left` : undefined}
            />
          </section>

          <section className="mt-10" aria-labelledby="recent-reels">
            <div className="mb-4 flex items-center justify-between">
              <h2 id="recent-reels" className="text-lg font-semibold">
                Recent Reels
              </h2>
              <Link to="/app/projects" className="flex items-center gap-1 text-[13px] font-medium text-cyan hover:underline">
                View all <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              {projects.isPending
                ? Array.from({length: 5}, (_, i) => <ReelCardSkeleton key={i} />)
                : items.map((p) => <ReelCard key={p.id} project={p} />)}
              <NewReelCard />
            </div>
          </section>
        </>
      )}
    </>
  );
}
