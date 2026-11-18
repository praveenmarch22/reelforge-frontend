import {Hammer} from 'lucide-react';
import {PageHeader} from '@/components/layout/AppShell';
import {ButtonLink} from '@/components/ui/Button';

/** Placeholder for screens that are designed but not built yet. See MILESTONES.md in the reelforge-backend repository. */
export function ComingSoon({title, milestone}: {title: string; milestone: string}) {
  return (
    <>
      <PageHeader title={title} />
      <div className="glass flex flex-col items-center px-6 py-16 text-center">
        <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-violet/15 text-violet-soft">
          <Hammer className="h-5 w-5" aria-hidden />
        </span>
        <p className="font-display text-lg">This screen isn't built yet</p>
        <p className="mt-1 text-sm text-muted">It's planned for milestone {milestone}.</p>
        <ButtonLink variant="secondary" className="mt-5" to="/app">
          Back to home
        </ButtonLink>
      </div>
    </>
  );
}

export function NotFound() {
  return (
    <main className="flex h-full flex-col items-center justify-center px-6 text-center">
      <p className="text-gradient font-display text-6xl font-bold" aria-hidden>
        404
      </p>
      <h1 className="mt-3 text-xl font-semibold">Page not found</h1>
      <p className="mt-1 text-muted">We couldn't find that page.</p>
      <ButtonLink className="mt-6" to="/app">
        Back to home
      </ButtonLink>
    </main>
  );
}
