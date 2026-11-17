import {Hammer} from 'lucide-react';
import {Link} from 'react-router-dom';
import {PageHeader} from '@/components/layout/AppShell';
import {Button} from '@/components/ui/Button';

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
        <Link to="/app" className="mt-5">
          <Button variant="secondary">Back to home</Button>
        </Link>
      </div>
    </>
  );
}

export function NotFound() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <p className="text-gradient font-display text-6xl font-bold">404</p>
      <p className="mt-3 text-muted">We couldn't find that page.</p>
      <Link to="/app" className="mt-6">
        <Button>Back to home</Button>
      </Link>
    </div>
  );
}
