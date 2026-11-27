import {CheckCircle2, Info, Youtube} from 'lucide-react';
import {useEffect, useState} from 'react';
import {ApiError} from '@/api/client';
import {useConnect} from '@/api/publishing';
import type {User} from '@/api/types';
import {Button} from '@/components/ui/Button';
import {Notice} from '@/components/ui/Notice';
import {REASONS, toConnectionReason} from '@/features/publish/ConnectionResult';
import {StepHeading} from './StepHeading';

type Props = {
  user: User;
  /** `connected` / `connection_error` and `reason` from the address after Google sends the browser back (API F2). */
  connected: string | null;
  error: string | null;
  reason: string | null;
  onBack: () => void;
  onFinish: () => void;
  finishing: boolean;
  /** Removes the result from the address once read, so a reload doesn't show it again (QF7-006). */
  onResultSeen?: () => void;
};

/** Onboarding step 3 (F7; YouTube first, decision 2026-11-26): connect the channel to publish to. */
export function YouTubeStep({user, onBack, onFinish, finishing, onResultSeen, ...fromAddress}: Props) {
  // Read once: the address is cleaned right after.
  const [{connected: justConnected, error, reason}] = useState(fromAddress);
  useEffect(() => {
    if (fromAddress.connected || fromAddress.error) onResultSeen?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const connect = useConnect();
  // True from the moment the browser is sent to Google until this page goes away.
  const [leaving, setLeaving] = useState(false);
  const channel = user.connections?.youtube ?? null;
  const connected = channel?.status === 'connected';
  const failure = !connected && error ? toConnectionReason(reason) : null;
  const connecting = connect.isPending || leaving;

  // Back from Google's page: the browser may show this page exactly as it was left.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) setLeaving(false);
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  const startConnect = () =>
    connect.mutate({platform: 'youtube', returnTo: '/onboarding?step=3'}, {onSuccess: () => setLeaving(true)});

  return (
    <section aria-labelledby="youtube-title" className="text-center">
      <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-brand p-[2px] shadow-glow">
        <div className="flex h-full w-full items-center justify-center rounded-full bg-ink-700">
          <Youtube className="h-8 w-8" aria-hidden />
        </div>
      </div>

      <StepHeading id="youtube-title" title={connected ? 'YouTube connected' : 'Connect YouTube'}>
        {connected ? null : 'Publish your Reels as YouTube Shorts straight from ReelForge. Instagram is coming soon.'}
      </StepHeading>

      {connected ? (
        <div className="mx-auto mt-5 flex w-fit max-w-full items-center gap-2.5 rounded-full border border-line bg-white/[0.04] px-4 py-2 text-sm">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-ok" aria-hidden />
          <span className="truncate font-medium">
            {justConnected ? 'Connected as ' : 'Connected: '}
            {channel?.name}
          </span>
        </div>
      ) : null}

      {failure ? (
        <Notice tone="error" className="mx-auto mt-6 max-w-md text-left">
          <p className="font-medium text-white">We couldn't connect your channel</p>
          <p className="mt-1">{REASONS[failure]}</p>
          {failure === 'no_channel' ? (
            <a href="https://www.youtube.com/create_channel" target="_blank" rel="noreferrer" className="mt-1 inline-block underline">
              Create a YouTube channel
            </a>
          ) : null}
        </Notice>
      ) : null}

      {!connected ? (
        <div className="mx-auto mt-6 max-w-md rounded-xl border border-line bg-white/[0.03] px-4 py-3 text-left text-[13px] text-white/80">
          <p className="flex items-start gap-2.5">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-cyan" aria-hidden />
            <span>
              You sign in with Google and allow ReelForge to upload videos. While ReelForge is in testing with Google,
              only accounts added as testers can connect.
            </span>
          </p>
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
              {failure ? 'Try again' : channel?.status === 'reconnect_required' ? 'Reconnect YouTube' : 'Connect YouTube'}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
