import {useQueryClient} from '@tanstack/react-query';
import {useEffect, useState} from 'react';
import {useSearchParams} from 'react-router-dom';
import type {ConnectionErrorReason, User} from '@/api/types';
import {Button} from '@/components/ui/Button';
import {Dialog} from '@/components/ui/Dialog';

export const REASONS: Record<ConnectionErrorReason, string> = {
  denied: "You didn't allow ReelForge to upload. Try again and allow both permissions.",
  missing_permission: 'ReelForge needs permission to upload videos. Try again and keep both boxes ticked.',
  no_channel: 'This Google account has no YouTube channel yet. Create one on YouTube, then connect again.',
  failed: "Connecting YouTube didn't work. Please try again.",
};

/** The reason comes from the address bar, so anything unexpected is the generic failure. */
export function toConnectionReason(value: string | null): ConnectionErrorReason {
  const known = value !== null && Object.prototype.hasOwnProperty.call(REASONS, value);
  return known ? (value as ConnectionErrorReason) : 'failed';
}

type Result = {ok: true} | {ok: false; reason: ConnectionErrorReason};

/**
 * Screens 21–22: after Google sends the browser back with `?connected=youtube` or
 * `?connection_error=youtube&reason=…` (API F2), shows the outcome once, then removes those
 * parameters from the address so a reload doesn't show it again.
 */
export function ConnectionResult({user}: {user: User | undefined}) {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    const connected = params.get('connected');
    const failed = params.get('connection_error');
    if (!connected && !failed) return;
    setResult(connected ? {ok: true} : {ok: false, reason: toConnectionReason(params.get('reason'))});
    void qc.invalidateQueries({queryKey: ['me']}); // the new connection shows everywhere
    const next = new URLSearchParams(params);
    for (const key of ['connected', 'connection_error', 'platform', 'reason']) next.delete(key);
    setParams(next, {replace: true});
  }, [params, setParams, qc]);

  if (!result) return null;
  const channel = user?.connections?.youtube?.name;
  return (
    <Dialog
      open
      onClose={() => setResult(null)}
      title={result.ok ? 'YouTube connected' : "YouTube isn't connected"}
      description={
        result.ok
          ? channel
            ? `Connected as ${channel}. You can publish Shorts from ReelForge now.`
            : 'You can publish Shorts from ReelForge now.'
          : REASONS[result.reason]
      }
    >
      <div className="flex justify-end gap-2">
        {!result.ok && result.reason === 'no_channel' ? (
          <a
            href="https://www.youtube.com/create_channel"
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 items-center rounded-xl border border-line px-4 text-sm hover:bg-white/[0.06]"
          >
            Create a channel
          </a>
        ) : null}
        <Button onClick={() => setResult(null)}>OK</Button>
      </div>
    </Dialog>
  );
}
