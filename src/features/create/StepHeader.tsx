import {Check} from 'lucide-react';
import {cn} from '@/lib/cn';

const STEPS = ['Idea', 'Script', 'Create'] as const;

/** "1 Idea · 2 Script · 3 Create", as at the top of the New Reel and Script editor designs. */
export function StepHeader({current}: {current: 0 | 1 | 2}) {
  return (
    <ol className="flex items-center justify-center gap-2 text-xs font-medium" aria-label="Steps">
      {STEPS.map((step, i) => (
        <li key={step} className="flex items-center gap-2">
          {i > 0 ? <span className="h-px w-6 bg-line" aria-hidden /> : null}
          <span
            aria-current={i === current ? 'step' : undefined}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-full px-3',
              i === current ? 'bg-violet/25 text-white ring-1 ring-violet/60' : 'text-muted',
            )}
          >
            {i < current ? <Check className="h-3.5 w-3.5 text-cyan" aria-hidden /> : <span>{i + 1}.</span>}
            {step}
          </span>
        </li>
      ))}
    </ol>
  );
}
