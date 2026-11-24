import {Check, Loader2, Pause, Play} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';
import {ApiError} from '@/api/client';
import {useUpdateMe, useVoices} from '@/api/hooks';
import type {User, Voice} from '@/api/types';
import {Button} from '@/components/ui/Button';
import {Notice} from '@/components/ui/Notice';
import {cn} from '@/lib/cn';
import {StepHeading} from './StepHeading';

const BARS = [0.45, 0.8, 0.6, 1, 0.7, 0.5, 0.9, 0.65, 0.4, 0.75, 0.55, 0.85];

function Waveform({playing}: {playing: boolean}) {
  return (
    <div className="flex h-7 items-center gap-[3px]" aria-hidden>
      {BARS.map((height, i) => (
        <span
          key={i}
          className={cn('w-[3px] origin-center rounded-full', playing ? 'animate-pulse bg-cyan' : 'bg-white/25')}
          style={{height: `${height * 100}%`, animationDelay: `${i * 70}ms`}}
        />
      ))}
    </div>
  );
}

/** Plays one voice sample at a time. */
function usePreviewPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);

  useEffect(() => () => audioRef.current?.pause(), []);

  const toggle = (voice: Voice) => {
    audioRef.current?.pause();
    if (playingId === voice.id) {
      setPlayingId(null);
      return;
    }
    const audio = new Audio(voice.previewUrl);
    audioRef.current = audio;
    setFailedId(null);
    setPlayingId(voice.id);
    const stop = () => setPlayingId((id) => (id === voice.id ? null : id));
    audio.addEventListener('ended', stop);
    audio.play().catch((error: unknown) => {
      // Stopping or switching before a sample has started makes play() reject with
      // AbortError. That is the visitor's own action, not a failed sample.
      const interrupted = error instanceof DOMException && error.name === 'AbortError';
      if (interrupted || audioRef.current !== audio) return;
      stop();
      setFailedId(voice.id);
    });
  };

  return {playingId, failedId, toggle};
}

type Props = {user: User; onBack: () => void; onNext: () => void};

export function VoiceStep({user, onBack, onNext}: Props) {
  const voices = useVoices();
  const update = useUpdateMe();
  const [selected, setSelected] = useState(user.defaults.voiceId);
  const {playingId, failedId, toggle} = usePreviewPlayer();

  const save = () => update.mutate({defaults: {voiceId: selected}}, {onSuccess: onNext});

  return (
    <section aria-labelledby="voice-title">
      <StepHeading id="voice-title" title="Pick your voice">
        This narrates your Reels. You can change it for any Reel.
      </StepHeading>

      <div className="mt-7 min-h-[14rem]">
        {voices.isPending ? (
          <div className="flex h-56 items-center justify-center" role="status" aria-label="Loading voices">
            <Loader2 className="h-6 w-6 animate-spin text-violet" />
          </div>
        ) : voices.isError ? (
          <Notice tone="error">
            We couldn't load the voices.{' '}
            <button type="button" className="font-semibold text-white underline" onClick={() => void voices.refetch()}>
              Try again
            </button>
          </Notice>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label="Voices">
            {voices.data.map((voice) => {
              const isSelected = selected === voice.id;
              const isPlaying = playingId === voice.id;
              return (
                <div
                  key={voice.id}
                  className={cn(
                    'rounded-2xl border p-4 transition',
                    isSelected ? 'ring-brand border-transparent bg-violet/15' : 'border-line bg-white/[0.03]',
                  )}
                >
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => toggle(voice)}
                      aria-label={`${isPlaying ? 'Stop' : 'Play'} ${voice.name} sample`}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
                    >
                      {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
                    </button>
                    <Waveform playing={isPlaying} />
                  </div>
                  {/* A native radio, invisible but covering its label, so clicks, arrow keys and screen readers all work. */}
                  <label className="relative mt-3 flex w-full cursor-pointer items-start justify-between gap-2 rounded-lg text-left has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-4 has-[:focus-visible]:outline-cyan">
                    <input
                      type="radio"
                      name="voice"
                      value={voice.id}
                      checked={isSelected}
                      onChange={() => setSelected(voice.id)}
                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    />
                    <span>
                      <span className="block font-display text-[15px] font-semibold">{voice.name}</span>
                      <span className="mt-1.5 flex flex-wrap gap-1.5">
                        {[voice.style, voice.gender].map((tag) => (
                          <span key={tag} className="rounded-full bg-white/[0.08] px-2 py-0.5 text-[11px] text-white/75">
                            {tag}
                          </span>
                        ))}
                      </span>
                    </span>
                    {isSelected ? (
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand text-ink">
                        <Check className="h-3 w-3" aria-hidden />
                      </span>
                    ) : null}
                  </label>
                  {failedId === voice.id ? (
                    <p role="alert" className="mt-2 text-xs text-bad">
                      Couldn't play this sample.
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {update.isError ? (
        <Notice tone="error" className="mt-5">
          {update.error instanceof ApiError ? update.error.message : 'Something went wrong. Please try again.'}
        </Notice>
      ) : null}

      <div className="mt-8 flex flex-wrap items-center justify-between gap-2.5">
        <Button variant="secondary" onClick={onBack} disabled={update.isPending}>
          Back
        </Button>
        <div className="flex items-center gap-2.5">
          <Button variant="ghost" onClick={onNext} disabled={update.isPending}>
            Skip for now
          </Button>
          <Button onClick={save} disabled={!selected} loading={update.isPending}>
            Continue
          </Button>
        </div>
      </div>
    </section>
  );
}
