import {Plus, Search} from 'lucide-react';
import {useEffect, useState, type ReactNode} from 'react';
import {Link} from 'react-router-dom';
import {ApiError} from '@/api/client';
import {useDeleteProject, useProjects} from '@/api/hooks';
import type {ProjectSummary} from '@/api/types';
import {PageHeader} from '@/components/layout/AppShell';
import {NewReelCard, ReelCard, ReelCardSkeleton} from '@/components/reels/ReelCard';
import {Button} from '@/components/ui/Button';
import {Dialog} from '@/components/ui/Dialog';
import {Notice} from '@/components/ui/Notice';
import {cn} from '@/lib/cn';

// Each filter maps to the API's `status` parameter (comma-separated list).
const FILTERS = [
  {id: 'all', label: 'All', status: ''},
  {id: 'drafts', label: 'Drafts', status: 'scripting,draft'},
  {id: 'generating', label: 'In progress', status: 'generating,rendering,posting'},
  {id: 'ready', label: 'Ready', status: 'ready,rendered'},
  {id: 'posted', label: 'Posted', status: 'posted'},
  {id: 'failed', label: 'Failed', status: 'needs_attention,render_failed,post_failed'},
] as const;

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

export function ProjectsPage() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('all');
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 300);
  const status = FILTERS.find((f) => f.id === filter)!.status;
  const projects = useProjects({status, q, limit: 100});
  const remove = useDeleteProject();
  const [toDelete, setToDelete] = useState<ProjectSummary | null>(null);

  const items = projects.data?.items ?? [];
  const hasAny = (projects.data?.counts.total ?? 0) > 0;
  const filtered = filter !== 'all' || q !== '';

  const confirmDelete = () => {
    if (!toDelete) return;
    remove.mutate(toDelete.id, {onSuccess: () => setToDelete(null)});
  };

  return (
    <>
      <PageHeader title="Your Reels">
        <Link to="/app/new">
          <Button size="sm" className="h-9">
            <Plus className="h-4 w-4" aria-hidden /> New Reel
          </Button>
        </Link>
      </PageHeader>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search Reels"
            aria-label="Search Reels"
            className="h-10 w-full rounded-xl border border-line bg-black/30 pl-10 pr-3.5 text-sm placeholder:text-white/30 focus:border-violet focus:outline-none focus:ring-2 focus:ring-violet/30"
          />
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                'h-8 rounded-full border px-3.5 text-[13px] font-medium transition',
                filter === f.id ? 'border-violet bg-violet/20 text-white' : 'border-line bg-white/[0.03] text-muted hover:text-white',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {projects.isError ? (
        <Notice tone="error">
          We couldn't load your Reels.{' '}
          <button type="button" className="font-semibold text-white underline" onClick={() => void projects.refetch()}>
            Try again
          </button>
        </Notice>
      ) : projects.isPending ? (
        <Grid>
          {Array.from({length: 6}, (_, i) => (
            <ReelCardSkeleton key={i} />
          ))}
        </Grid>
      ) : items.length === 0 ? (
        <div className="glass flex flex-col items-center px-6 py-16 text-center">
          <p className="font-display text-lg">{filtered && hasAny ? 'No Reels match' : 'No Reels yet'}</p>
          <p className="mt-1 text-sm text-muted">
            {filtered && hasAny ? 'Try another search or filter.' : 'Create your first Reel from an idea in a few minutes.'}
          </p>
          {filtered && hasAny ? (
            <Button
              variant="secondary"
              className="mt-5"
              onClick={() => {
                setFilter('all');
                setSearch('');
              }}
            >
              Clear filters
            </Button>
          ) : (
            <Link to="/app/new" className="mt-5">
              <Button>
                <Plus className="h-4 w-4" aria-hidden /> New Reel
              </Button>
            </Link>
          )}
        </div>
      ) : (
        <Grid>
          {items.map((p) => (
            <ReelCard key={p.id} project={p} onDelete={setToDelete} />
          ))}
          {!filtered ? <NewReelCard /> : null}
        </Grid>
      )}

      <Dialog
        open={toDelete !== null}
        onClose={() => (remove.isPending ? undefined : setToDelete(null))}
        title="Delete this Reel?"
        description={toDelete ? `"${toDelete.title}" and its files will be removed. This can't be undone.` : ''}
      >
        {remove.isError ? (
          <Notice tone="error" className="mb-4">
            {remove.error instanceof ApiError ? remove.error.message : 'Something went wrong. Please try again.'}
          </Notice>
        ) : null}
        <div className="flex justify-end gap-2.5">
          <Button variant="secondary" onClick={() => setToDelete(null)} disabled={remove.isPending}>
            Cancel
          </Button>
          <Button variant="danger" loading={remove.isPending} onClick={confirmDelete}>
            Delete
          </Button>
        </div>
      </Dialog>
    </>
  );
}

function Grid({children}: {children: ReactNode}) {
  return <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">{children}</div>;
}
