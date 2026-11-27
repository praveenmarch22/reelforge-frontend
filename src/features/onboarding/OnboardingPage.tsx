import {useIsMutating} from '@tanstack/react-query';
import {Check} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';
import {Navigate, useNavigate, useSearchParams} from 'react-router-dom';
import {ApiError} from '@/api/client';
import {useMe, useUpdateMe} from '@/api/hooks';
import type {User} from '@/api/types';
import {Logo} from '@/components/ui/Logo';
import {Notice} from '@/components/ui/Notice';
import {cn} from '@/lib/cn';
import {YouTubeStep} from './YouTubeStep';
import {NicheStep} from './NicheStep';
import {VoiceStep} from './VoiceStep';

const STEPS = ['Niche', 'Voice', 'YouTube'] as const;
type StepNumber = 1 | 2 | 3;

function parseStep(value: string | null): StepNumber {
  return value === '2' ? 2 : value === '3' ? 3 : 1;
}

/** A step counts as done only when its choice is really saved, not when it was skipped. */
function isSaved(step: number, user: User): boolean {
  if (step === 1) return user.niche.trim() !== '';
  if (step === 2) return user.defaults.voiceId !== '';
  return user.connections?.youtube?.status === 'connected';
}

function Stepper({current, user}: {current: number; user: User}) {
  return (
    <ol className="mb-8 flex items-center justify-center gap-2 sm:gap-3" aria-label="Setup steps">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const active = n === current;
        const done = !active && isSaved(n, user);
        const skipped = !active && !done && n < current;
        return (
          <li key={label} className="flex items-center gap-2 sm:gap-3" aria-current={active ? 'step' : undefined}>
            <span
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                active && 'bg-brand text-ink',
                done && 'bg-violet/25 text-violet-soft',
                !active && !done && 'border border-line text-muted',
              )}
            >
              {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : n}
            </span>
            {/* On very narrow screens only the current step shows its name. */}
            <span className={cn('text-[13px] font-medium', active ? 'text-white' : 'hidden text-muted min-[400px]:inline')}>
              {label}
            </span>
            {done ? <span className="sr-only">(done)</span> : null}
            {skipped ? <span className="sr-only">(skipped)</span> : null}
            {n < STEPS.length ? <span className="h-px w-5 bg-line sm:w-10" aria-hidden /> : null}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * First-run setup: niche, voice, YouTube (Instagram in B6b). Every step can be skipped, and the whole
 * setup can be skipped from the top-right link. Shown once; settings covers changes later.
 * The step lives in the URL (?step=2) so reload, back and the Google redirect all work.
 */
export function OnboardingPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const {data: user} = useMe();
  const update = useUpdateMe();
  const [finishError, setFinishError] = useState<string | null>(null);
  // "Skip setup" waits for any save or connect request, so it can't race with one.
  const busy = useIsMutating() > 0;
  const step = parseStep(params.get('step'));

  useEffect(() => {
    document.title = `${STEPS[step - 1]} · ReelForge setup`;
    return () => {
      document.title = 'ReelForge';
    };
  }, [step]);

  // When the step changes while the page is open (its own buttons, or the browser's Back and
  // Forward), focus moves to the new step's heading and a failed finish stops being shown.
  // Not on the first load or a reload: there is no previous step then.
  const previousStep = useRef<StepNumber | null>(null);
  useEffect(() => {
    if (previousStep.current !== null && previousStep.current !== step) {
      setFinishError(null);
      // The new step starts at the top, with the stepper in view (a short step after a long one
      // would otherwise stay scrolled down on a phone).
      window.scrollTo({top: 0});
      document.querySelector<HTMLElement>('[data-step-heading]')?.focus({preventScroll: true});
    }
    previousStep.current = step;
  }, [step]);

  if (!user) return null; // RequireAuth renders this page only for signed-in users
  // Setup comes after email verification (PRD flow 1); until then the app shows the verify banner.
  if (!user.emailVerified || user.onboardingCompleted) return <Navigate to="/app" replace />;

  const goTo = (next: StepNumber) => setParams({step: String(next)});

  const finish = () => {
    setFinishError(null);
    update.mutate(
      {onboardingCompleted: true},
      {
        onSuccess: () => navigate('/app', {replace: true}),
        onError: (e) => setFinishError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.'),
      },
    );
  };

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center justify-between px-5 py-5 sm:px-10 sm:py-6">
        <Logo />
        <button
          type="button"
          onClick={finish}
          disabled={busy}
          className="-mr-3 rounded-lg px-3 py-2.5 text-[13px] font-medium text-muted transition hover:text-white disabled:opacity-60"
        >
          Skip setup
        </button>
      </header>

      <main className="flex flex-1 items-start justify-center px-4 pb-12 pt-2 sm:items-center sm:px-5 sm:pt-0">
        <div className="glass w-full max-w-[720px] p-5 sm:p-10">
          <Stepper current={step} user={user} />
          {finishError ? (
            <Notice tone="error" className="mb-5">
              {finishError}
            </Notice>
          ) : null}
          {step === 1 ? <NicheStep user={user} onNext={() => goTo(2)} /> : null}
          {step === 2 ? <VoiceStep user={user} onBack={() => goTo(1)} onNext={() => goTo(3)} /> : null}
          {step === 3 ? (
            <YouTubeStep
              user={user}
              connected={params.get('connected')}
              error={params.get('connection_error')}
              reason={params.get('reason')}
              onResultSeen={() => setParams({step: '3'}, {replace: true})}
              onBack={() => goTo(2)}
              onFinish={finish}
              finishing={update.isPending}
            />
          ) : null}
        </div>
      </main>
    </div>
  );
}
