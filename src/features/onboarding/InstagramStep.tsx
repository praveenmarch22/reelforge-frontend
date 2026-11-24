import {CheckCircle2, Info, Instagram} from 'lucide-react';
import {useEffect, useState} from 'react';
import {ApiError} from '@/api/client';
import {useConnectInstagram} from '@/api/hooks';
import type {InstagramErrorReason, User} from '@/api/types';
import {Button} from '@/components/ui/Button';
import {Notice} from '@/components/ui/Notice';
import {StepHeading} from './StepHeading';

const REASONS: Record<InstagramErrorReason, string> = {
  personal_account:
    'This is a personal account. Reels can only be posted from a Business or Creator account.',
  denied: 'You declined the permissions ReelForge needs to post for you.',
  not_tester: "Your account isn't added as a tester yet. ReelForge is still in testing with Instagram.",
  failed: 'Something went wrong while connecting. Please try again.',
};

/** The reason comes from the address bar, so anything unexpected is treated as the generic failure. */
export function toReason(value: string | null): InstagramErrorReason {
  const known = value !== null && Object.prototype.hasOwnProperty.call(REASONS, value);
  return known ? (value as InstagramErrorReason) : 'failed';
}

function SwitchGuide() {
  return (
    <ol className="mt-3 list-decimal space-y-1 pl-5 text-[13px] text-white/80">
      <li>In the Instagram app, open Settings.</li>
      <li>Choose "Account type and tools", then "Switch to professional account".</li>
      <li>Pick Creator. It's free and takes a minute.</li>
    </ol>
  );
}

type Props = {
  user: User;
  /** `instagram` and `reason` from the URL after Instagram redirects back (API F2). */
  result: string | null;
  reason: string | null;
  onBack: () => void;
  onFinish: () => void;
  finishing: boolean;
};

export function InstagramStep({user, result, reason, onBack, onFinish, finishing}: Props) {
  const connect = useConnectInstagram();
  const [guideOpen, setGuideOpen] = useState(false);
  // True from the moment the browser is sent to Instagram until this page goes away.
  const [leaving, setLeaving] = useState(false);
  const connected = user.instagram.connected && user.instagram.status === 'connected';
  const failure = !connected && result === 'error' ? toReason(reason) : null;
  const connecting = connect.isPending || leaving;

  // If the visitor presses Back on Instagram's page, the browser may show this page exactly
  // as it was left. Bring the buttons back to life.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) setLeaving(false);
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  const startConnect = () => connect.mutate('/onboarding?step=3', {onSuccess: () => setLeaving(true)});

  return (
    <section aria-labelledby="instagram-title" className="text-center">
      <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-brand p-[2px] shadow-glow">
        <div className="flex h-full w-full items-center justify-center rounded-full bg-ink-700">
          <Instagram className="h-8 w-8" aria-hidden />
        </div>
      </div>

      <StepHeading id="instagram-title" title={connected ? 'Instagram connected' : 'Connect Instagram'}>
        {connected ? null : 'Post your Reels straight from ReelForge.'}
      </StepHeading>

      {connected ? (
        <div className="mx-auto mt-5 flex w-fit max-w-full items-center gap-2.5 rounded-full border border-line bg-white/[0.04] px-4 py-2 text-sm">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-ok" aria-hidden />
          <span className="truncate font-medium">Connected as @{user.instagram.username}</span>
        </div>
      ) : null}

      {failure ? (
        <Notice tone="error" className="mx-auto mt-6 max-w-md text-left">
          <p className="font-medium text-white">We couldn't connect your account</p>
          <p className="mt-1">{REASONS[failure]}</p>
          {failure === 'personal_account' ? <SwitchGuide /> : null}
        </Notice>
      ) : null}

      {!connected && failure !== 'personal_account' ? (
        <div className="mx-auto mt-6 max-w-md rounded-xl border border-line bg-white/[0.03] px-4 py-3 text-left text-[13px] text-white/80">
          <p className="flex items-start gap-2.5">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-cyan" aria-hidden />
            <span>
              Needs an Instagram Business or Creator account (free to switch).{' '}
              <button
                type="button"
                aria-expanded={guideOpen}
                onClick={() => setGuideOpen((open) => !open)}
                className="font-medium text-cyan hover:underline"
              >
                How to switch
              </button>
            </span>
          </p>
          {guideOpen ? <SwitchGuide /> : null}
        </div>
      ) : null}

      {connect.isError ? (
        <Notice tone="error" className="mx-auto mt-5 max-w-md text-left">
          {connect.error instanceof ApiError ? connect.error.message : 'Something went wrong. Please try again.'}
        </Notice>
      ) : null}

      <div className="mt-8 flex flex-wrap items-center justify-between gap-2.5">
        <Button variant="secondary" onClick={onBack} disabled={finishing || connecting}>
          Back
        </Button>
        {connected ? (
          <Button onClick={onFinish} loading={finishing}>
            Finish
          </Button>
        ) : (
          <div className="flex flex-wrap items-center justify-end gap-2.5">
            <Button variant="ghost" onClick={onFinish} disabled={connecting} loading={finishing}>
              Skip for now
            </Button>
            <Button onClick={startConnect} loading={connecting} disabled={finishing}>
              {failure ? 'Try again' : 'Connect Instagram'}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
