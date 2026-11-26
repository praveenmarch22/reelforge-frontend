import {Music, Pause, Play, Volume2} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';
import {useMusic, useUpdateProject, type ProjectUpdate} from '@/api/projects';
import type {CaptionStyle, Mood, Project, ProjectSettings} from '@/api/types';
import {Chip} from '@/components/ui/Chip';
import {markUnsaved, registerFlusher} from '@/features/create/autosave';
import {errorText} from '@/features/create/errors';
import {MOODS} from '@/features/create/SceneCard';
import {VoicePicker} from '@/features/create/VoicePicker';
import {useAudioPreview} from '@/lib/useAudioPreview';

const CAPTION_STYLES: {value: CaptionStyle; label: string}[] = [
  {value: 'bold-pop', label: 'Bold pop'},
  {value: 'clean', label: 'Clean'},
  {value: 'neon', label: 'Neon'},
];
const SLIDER_SAVE_MS = 500;
type VolumeKey = 'voiceVolume' | 'musicVolume';

const minutes = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

/**
 * The volume sliders: each saves 0.5 s after it stops moving, on its own timer, so moving one
 * never drops the other's change (BUG-059). A move not yet sent is sent when the editor closes,
 * counts as unsaved for the leave warning and is included when Generate saves everything first
 * (BUG-060).
 */
function useVolumes(project: Project, saveSettings: (s: Partial<ProjectSettings>) => Promise<unknown>) {
  const [values, setValues] = useState({voiceVolume: project.settings.voiceVolume, musicVolume: project.settings.musicVolume});
  const pending = useRef<Partial<Record<VolumeKey, number>>>({});
  const timers = useRef<Partial<Record<VolumeKey, ReturnType<typeof setTimeout>>>>({});
  const save = useRef(saveSettings);
  save.current = saveSettings;

  const send = (key: VolumeKey): Promise<unknown> => {
    clearTimeout(timers.current[key]);
    const value = pending.current[key];
    if (value === undefined) return Promise.resolve();
    delete pending.current[key];
    return save.current({[key]: value}).then(
      () => markUnsaved(-1),
      (e: unknown) => {
        // Kept for the next try (Generate, leaving, another move) unless a newer move replaced it.
        pending.current[key] ??= value;
        throw e;
      },
    );
  };

  const slide = (key: VolumeKey, value: number) => {
    setValues((v) => ({...v, [key]: value}));
    if (pending.current[key] === undefined) markUnsaved(1);
    pending.current[key] = value;
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => void send(key).catch(() => undefined), SLIDER_SAVE_MS);
  };

  useEffect(() => {
    const flush = () => Promise.all([send('voiceVolume'), send('musicVolume')]);
    const unregister = registerFlusher(flush);
    return () => {
      unregister();
      void flush().catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The server's values win only when nothing is waiting to be sent.
  useEffect(() => {
    setValues((v) => ({
      voiceVolume: pending.current.voiceVolume ?? project.settings.voiceVolume ?? v.voiceVolume,
      musicVolume: pending.current.musicVolume ?? project.settings.musicVolume ?? v.musicVolume,
    }));
  }, [project.settings.voiceVolume, project.settings.musicVolume]);

  return {values, slide};
}

/** The bottom bar of screen 11: narrator, music, volumes, ducking and captions (B5 settings, D4). */
export function AudioBar({project, playingTitle}: {project: Project; playingTitle?: string}) {
  const update = useUpdateProject(project.id);
  const library = useMusic();
  const preview = useAudioPreview();
  const save = (body: ProjectUpdate) => update.mutateAsync(body);
  const saveSettings = (settings: Partial<ProjectSettings>) => save({settings});
  const quietly = (promise: Promise<unknown>) => void promise.catch(() => undefined); // errors show below
  const volumes = useVolumes(project, saveSettings);

  // The whole library, this mood's tracks first, so a track chosen earlier is always named, even
  // after the music mood changes (QF6-006).
  const chosenTrack = project.music && 'trackId' in project.music ? project.music.trackId : '';
  const all = library.data ?? [];
  const forMood = all.filter((t) => t.moods.includes(project.musicMood));
  const others = all.filter((t) => !t.moods.includes(project.musicMood));
  const playing = all.find((t) => t.id === chosenTrack);

  return (
    <section className="glass grid grid-cols-1 gap-4 p-4 md:grid-cols-2 xl:grid-cols-[1fr_1.3fr_1fr_1fr_1.1fr]" aria-label="Audio and captions">
      <VoicePicker
        value={project.voiceId}
        disabled={update.isPending}
        onChange={(voiceId) =>
          window.confirm('Change the narrator? Every scene gets a new voice when you generate again.') && quietly(save({voiceId}))
        }
      />

      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted">
          <Music className="h-3.5 w-3.5" aria-hidden /> Music
        </p>
        <div className="mt-1.5 flex items-center gap-2">
          <label htmlFor="music-mood" className="sr-only">
            Music mood
          </label>
          <select
            id="music-mood"
            value={project.musicMood}
            onChange={(e) => quietly(save({musicMood: e.target.value as Mood}))}
            className="h-8 rounded-lg border border-line bg-white/[0.04] px-2 text-[12px] capitalize focus:outline-none [&>option]:bg-ink-700"
          >
            {MOODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <label htmlFor="music-track" className="sr-only">
            Music track
          </label>
          <select
            id="music-track"
            value={chosenTrack}
            onChange={(e) => quietly(save({music: e.target.value ? {trackId: e.target.value} : null}))}
            className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-white/[0.04] px-2 text-[12px] focus:outline-none [&>option]:bg-ink-700"
          >
            <option value="">{playingTitle && !chosenTrack ? `Automatic: ${playingTitle}` : 'Automatic for this mood'}</option>
            {forMood.length ? (
              <optgroup label={`For ${/^[aeiou]/.test(project.musicMood) ? 'an' : 'a'} ${project.musicMood} Reel`}>
                {forMood.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title} ({minutes(t.durationSeconds)})
                  </option>
                ))}
              </optgroup>
            ) : null}
            {others.length ? (
              <optgroup label="Other moods">
                {others.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title} ({minutes(t.durationSeconds)})
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
          {playing ? (
            <button
              type="button"
              onClick={() => preview.toggle(playing.id, playing.previewUrl)}
              aria-label={preview.playingId === playing.id ? `Stop ${playing.title}` : `Play ${playing.title}`}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line hover:bg-white/10"
            >
              {preview.playingId === playing.id ? <Pause className="h-3.5 w-3.5" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
            </button>
          ) : null}
        </div>
        {playing?.license ? <p className="mt-1 truncate text-[10px] text-muted" title={playing.license}>{playing.license}</p> : null}
      </div>

      {(['voiceVolume', 'musicVolume'] as const).map((key) => (
        <div key={key}>
          <label htmlFor={key} className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted">
            <Volume2 className="h-3.5 w-3.5" aria-hidden /> {key === 'voiceVolume' ? 'Voice volume' : 'Music volume'}
          </label>
          <input
            id={key}
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volumes.values[key]}
            aria-valuetext={`${Math.round(volumes.values[key] * 100)} percent`}
            onChange={(e) => volumes.slide(key, Number(e.target.value))}
            className="mt-2.5 w-full accent-violet"
          />
          {key === 'musicVolume' ? (
            <label className="mt-1 flex items-center gap-1.5 text-[11px] text-muted">
              <input
                type="checkbox"
                checked={project.settings.ducking}
                onChange={(e) => quietly(saveSettings({ducking: e.target.checked}))}
                className="accent-violet"
              />
              Lower the music while the voice speaks
            </label>
          ) : null}
        </div>
      ))}

      <fieldset>
        <legend className="text-xs font-medium uppercase tracking-wider text-muted">Captions</legend>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {CAPTION_STYLES.map((s) => (
            <Chip
              key={s.value}
              active={project.settings.captionStyle === s.value}
              onClick={() => quietly(saveSettings({captionStyle: s.value}))}
              className="h-7 px-2.5 text-[12px]"
            >
              {s.label}
            </Chip>
          ))}
        </div>
        <label className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted">
          <input
            type="checkbox"
            checked={project.settings.showCaptions}
            onChange={(e) => quietly(saveSettings({showCaptions: e.target.checked}))}
            className="accent-violet"
          />
          Show captions
        </label>
      </fieldset>
      <p role={update.isError ? 'alert' : 'status'} className="text-xs md:col-span-2 xl:col-span-5">
        {update.isError ? (
          <span className="text-red-300">{errorText(update.error, 'Not saved.')}</span>
        ) : (
          <span className="text-muted">{update.isPending ? 'Saving…' : ''}</span>
        )}
      </p>
    </section>
  );
}
