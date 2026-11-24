import {
  Briefcase,
  Coffee,
  Cpu,
  Dumbbell,
  Flame,
  Gamepad2,
  GraduationCap,
  Laugh,
  Plane,
  Sparkles,
  UtensilsCrossed,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import {useState, type FormEvent} from 'react';
import {ApiError} from '@/api/client';
import {useUpdateMe} from '@/api/hooks';
import type {User} from '@/api/types';
import {Button} from '@/components/ui/Button';
import {Notice} from '@/components/ui/Notice';
import {cn} from '@/lib/cn';
import {cleanCustom, countTopics, joinNiche, matchingLabel, MAX_NICHES, NICHE_LABELS, splitNiche} from './niche';
import {StepHeading} from './StepHeading';

export {joinNiche, MAX_NICHES, splitNiche} from './niche';

const ICONS: Record<(typeof NICHE_LABELS)[number], LucideIcon> = {
  Fitness: Dumbbell,
  Finance: Wallet,
  Tech: Cpu,
  Food: UtensilsCrossed,
  Travel: Plane,
  Motivation: Flame,
  Education: GraduationCap,
  Comedy: Laugh,
  Beauty: Sparkles,
  Gaming: Gamepad2,
  Business: Briefcase,
  Lifestyle: Coffee,
};

export const NICHES = NICHE_LABELS.map((label) => ({label, icon: ICONS[label]}));

export function NicheStep({user, onNext}: {user: User; onNext: () => void}) {
  const [initial] = useState(() => splitNiche(user.niche));
  const [chosen, setChosen] = useState<string[]>(initial.chosen);
  const [custom, setCustom] = useState(initial.custom);
  const update = useUpdateMe();
  const saving = update.isPending;

  const total = countTopics(chosen, custom);
  const atLimit = total >= MAX_NICHES;
  const value = joinNiche(chosen, custom);
  // Continue saves the choices. With nothing chosen it is only useful for clearing a saved niche.
  const canContinue = total > 0 || user.niche.trim() !== '';

  const toggle = (label: string) => {
    const typedSame = matchingLabel(custom) === label;
    // Selecting a topic whose name is already typed below replaces the typed text; it is one choice.
    if (!chosen.includes(label) && typedSame) setCustom('');
    setChosen((current) =>
      current.includes(label)
        ? current.filter((c) => c !== label)
        : atLimit && !typedSame
          ? current
          : [...current, label],
    );
  };

  // The name of a topic that is already selected adds nothing (joinNiche never stores a repeat),
  // so the field is emptied. This happens on leaving the field, not while typing, or a text
  // that only begins with a topic's name ("Tech reviews") could not be typed.
  const onCustomBlur = () => {
    const label = matchingLabel(custom);
    if (label && chosen.includes(label)) setCustom('');
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!canContinue || saving) return;
    update.mutate({niche: value}, {onSuccess: onNext});
  };

  return (
    <form onSubmit={onSubmit} aria-labelledby="niche-title" noValidate>
      <StepHeading id="niche-title" title="What do you post about?">
        Pick up to {MAX_NICHES}. We use this to suggest ideas.
      </StepHeading>

      <div className="mt-7 grid grid-cols-2 gap-2.5 sm:grid-cols-4" role="group" aria-label="Topics">
        {NICHES.map(({label, icon: Icon}) => {
          const selected = chosen.includes(label);
          return (
            <button
              key={label}
              type="button"
              aria-pressed={selected}
              disabled={saving || (!selected && atLimit && matchingLabel(custom) !== label)}
              onClick={() => toggle(label)}
              className={cn(
                'flex h-12 items-center gap-2.5 rounded-xl border px-3.5 text-sm font-medium transition',
                selected
                  ? 'ring-brand border-transparent bg-violet/15 text-white'
                  : 'border-line bg-white/[0.03] text-white/80 hover:bg-white/[0.07] hover:text-white',
                'disabled:cursor-not-allowed disabled:opacity-40',
              )}
            >
              <Icon className={cn('h-4 w-4 shrink-0', selected ? 'text-cyan' : 'text-muted')} aria-hidden />
              {label}
            </button>
          );
        })}
      </div>

      <label htmlFor="niche-custom" className="mt-5 block text-[13px] font-medium text-white/80">
        Something else
      </label>
      <input
        id="niche-custom"
        value={custom}
        onChange={(e) => setCustom(cleanCustom(e.target.value))}
        onBlur={onCustomBlur}
        disabled={saving || (!custom.trim() && atLimit)}
        placeholder="For example, gardening"
        aria-describedby="niche-count"
        className="mt-1.5 h-11 w-full rounded-xl border border-line bg-black/30 px-3.5 text-sm placeholder:text-white/45 focus:border-violet focus:outline-none focus:ring-2 focus:ring-violet/30 disabled:opacity-40"
      />
      <p id="niche-count" className="mt-2 text-xs text-muted" aria-live="polite">
        {total} of {MAX_NICHES} chosen
      </p>

      {update.isError ? (
        <Notice tone="error" className="mt-5">
          {update.error instanceof ApiError ? update.error.message : 'Something went wrong. Please try again.'}
        </Notice>
      ) : null}

      <div className="mt-8 flex flex-wrap items-center justify-end gap-2.5">
        <Button variant="ghost" onClick={onNext} disabled={saving}>
          Skip for now
        </Button>
        <Button type="submit" disabled={!canContinue} loading={saving}>
          Continue
        </Button>
      </div>
    </form>
  );
}
