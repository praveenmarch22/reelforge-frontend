import {Pause, Play} from 'lucide-react';
import {useVoices} from '@/api/hooks';
import {useAudioPreview} from '@/lib/useAudioPreview';
import {cn} from '@/lib/cn';

/** The narrator: a voice from D3 with its sample. "" means the account's default voice. */
export function VoicePicker({
  value,
  onChange,
  label = 'Narrator',
  disabled,
}: {
  value: string;
  onChange: (voiceId: string) => void;
  label?: string;
  disabled?: boolean;
}) {
  const voices = useVoices();
  const preview = useAudioPreview();
  const items = voices.data ?? [];
  const chosen = items.find((v) => v.id === value) ?? items[0];
  const playing = chosen && preview.playingId === chosen.id;

  return (
    <div>
      <label htmlFor="voice-picker" className="text-xs font-medium uppercase tracking-wider text-muted">
        {label}
      </label>
      <div className="mt-2 flex items-center gap-2 rounded-xl border border-line bg-white/[0.04] p-2">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand font-semibold text-ink" aria-hidden>
          {chosen?.name[0] ?? '…'}
        </span>
        <select
          id="voice-picker"
          value={chosen?.id ?? ''}
          disabled={disabled || !items.length}
          onChange={(e) => onChange(e.target.value)}
          className="min-w-0 flex-1 bg-transparent text-sm text-white focus:outline-none [&>option]:bg-ink-700"
        >
          {items.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}: {v.gender}, {v.accent}, {v.style}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!chosen?.previewUrl}
          onClick={() => chosen && preview.toggle(chosen.id, chosen.previewUrl)}
          aria-label={playing ? `Stop ${chosen?.name}'s sample` : `Play ${chosen?.name ?? 'voice'} sample`}
          className={cn(
            'grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line text-white transition hover:bg-white/10',
            'disabled:cursor-not-allowed disabled:opacity-40',
          )}
        >
          {playing ? <Pause className="h-3.5 w-3.5" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
        </button>
      </div>
      {chosen && preview.failedId === chosen.id ? (
        <p className="mt-1 text-xs text-muted">The sample couldn't play. Try again in a moment.</p>
      ) : null}
    </div>
  );
}
