import {Player, type PlayerRef} from '@remotion/player';
import {ArrowLeft, Clapperboard, Loader2, Send, Zap} from 'lucide-react';
import {useEffect, useMemo, useRef, useState} from 'react';
import {Navigate, useNavigate, useParams} from 'react-router-dom';
import {ApiError} from '@/api/client';
import {useCredits, useEstimate, useGenerate, useProject, useReorderScenes, useTimeline} from '@/api/projects';
import {useStartRender} from '@/api/publishing';
import {TopBar} from '@/components/layout/AppShell';
import {StatusPill} from '@/components/reels/StatusPill';
import {Button} from '@/components/ui/Button';
import {FullPageSpinner} from '@/components/ui/FullPageSpinner';
import {Notice} from '@/components/ui/Notice';
import {flushAll, useWarnBeforeLeaving} from '@/features/create/autosave';
import {errorText} from '@/features/create/errors';
import {Reel} from '@/remotion/Reel';
import {AudioBar} from './AudioBar';
import {Inspector, type Tab} from './Inspector';
import {stableLinks} from './links';
import {SceneList} from './SceneList';

const NEEDS_WORK = ['missing', 'outdated', 'failed'];

/** Screen 11 (docs/SCREENS_F5_F6.md): preview the Reel and change any part of it. */
export function ReelEditorPage() {
  const {id = ''} = useParams();
  const navigate = useNavigate();
  const project = useProject(id);
  const p = project.data;
  // The timeline is fetched again whenever any scene's files or statuses change.
  const version = p
    ? `${p.timelineVersion}:${p.scenes.map((s) => `${s.voice?.assetId}${s.visual?.assetId}${s.voiceStatus}${s.visualStatus}`).join()}`
    : undefined;
  const timeline = useTimeline(id, version);
  const estimate = useEstimate(id, !!p && p.status !== 'scripting');
  const credits = useCredits();
  const generate = useGenerate(id);
  const startRender = useStartRender(id);
  const reorder = useReorderScenes(id);
  const player = useRef<PlayerRef>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('visual'); // kept when another scene is selected (BUG-063)
  const [actionError, setActionError] = useState('');
  const [starting, setStarting] = useState(false); // busy from the first click (BUG-057)
  const [playerFailed, setPlayerFailed] = useState(false);
  // Links are signed afresh on every fetch; reusing the ones the player already has stops it
  // downloading every voice, clip and track again after each autosave (QF6-008).
  const previousTimeline = useRef<ReturnType<typeof stableLinks>>();
  const shown = useMemo(() => {
    if (!timeline.data) return undefined;
    previousTimeline.current = stableLinks(previousTimeline.current, timeline.data.timeline);
    return previousTimeline.current;
  }, [timeline.data]);
  // A file that can't be played (an expired link, a broken download) is reported by the media
  // element itself, outside React's rendering, so the player is told what to do (BUG-067).
  const playerProps = useMemo(() => (shown ? {...shown, onMediaError: () => setPlayerFailed(true)} : undefined), [shown]);
  useWarnBeforeLeaving();

  const scenes = p ? [...p.scenes].sort((a, b) => a.position - b.position) : [];
  const selected = scenes.find((s) => s.id === selectedId) ?? scenes[0];

  // Selecting a scene shows it in the player.
  useEffect(() => {
    const start = shown?.scenes.find((s) => s.id === selected?.id)?.startFrame;
    if (start !== undefined) player.current?.seekTo(start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  if (project.isError) {
    if (project.error instanceof ApiError && project.error.status === 404) return <Navigate to="/app/projects" replace />;
    return (
      <Notice tone="error">
        We couldn't load this Reel.{' '}
        <button type="button" className="font-semibold text-white underline" onClick={() => void project.refetch()}>
          Try again
        </button>
      </Notice>
    );
  }
  if (!p) return <FullPageSpinner />;
  if (p.status === 'scripting') return <Navigate to={`/app/p/${id}/script`} replace />;

  const missing = scenes.some((s) => NEEDS_WORK.includes(s.voiceStatus) || NEEDS_WORK.includes(s.visualStatus));
  const parts = scenes.length * 2;
  const done = scenes.reduce((n, s) => n + Number(s.voiceStatus === 'ready') + Number(s.visualStatus === 'ready'), 0);
  const t = timeline.data;
  const frames = Math.max(1, shown?.durationInFrames ?? 1);
  const index = selected ? scenes.indexOf(selected) : 0;

  const generateMissing = (sceneIds?: string[]) => {
    if (starting) return;
    setStarting(true);
    void flushAll()
      .then(() => generate.mutateAsync(sceneIds))
      .then(
        () => setActionError(''),
        (e: unknown) => setActionError(errorText(e, 'Generating didn’t start.')),
      )
      .finally(() => setStarting(false));
  };

  // F7: unsaved edits are sent first, then the render starts (E1) and its page opens.
  const render = () => {
    if (starting) return;
    const cost = credits.data?.costs.render ?? 2;
    if (!window.confirm(`Render this Reel into a video? ${cost} credits, given back if it fails.`)) return;
    setStarting(true);
    void flushAll()
      .then(() => startRender.mutateAsync())
      .then(
        () => navigate(`/app/p/${id}/render`),
        (e: unknown) => {
          if (e instanceof ApiError && e.code === 'already_running') {
            // Started from another tab? The page's data is from before: read it again (BUG-082).
            void project.refetch().then(({data}) => {
              if (data?.status === 'rendering') navigate(`/app/p/${id}/render`);
              else setActionError(errorText(e, 'Rendering didn’t start.'));
            });
            return;
          }
          if (e instanceof ApiError && e.code === 'not_ready') {
            const waiting = (e.details?.scenes as string[] | undefined) ?? [];
            if (waiting[0]) setSelectedId(waiting[0]);
            const numbers = scenes.filter((s) => waiting.includes(s.id)).map((s) => s.position);
            setActionError(
              numbers.length
                ? `Scene${numbers.length === 1 ? '' : 's'} ${numbers.join(', ')} ${numbers.length === 1 ? 'isn’t' : 'aren’t'} ready yet. Generate ${numbers.length === 1 ? 'it' : 'them'} first.`
                : errorText(e, 'Rendering didn’t start.'),
            );
            return;
          }
          if (e instanceof ApiError && (e.code === 'too_long' || e.code === 'too_short')) {
            const s = e.details?.seconds;
            const length = typeof s === 'number' ? ` It is ${s.toFixed(1)} s now.` : '';
            setActionError(
              e.code === 'too_long'
                ? `A Reel can be at most 90 seconds.${length} Shorten the script, then render.`
                : `A Reel must be at least 3 seconds.${length} Add to the script, then render.`,
            );
            return;
          }
          setActionError(errorText(e, 'Rendering didn’t start.'));
        },
      )
      .finally(() => setStarting(false));
  };
  const canRender = ['ready', 'rendered', 'render_failed', 'posted', 'post_failed'].includes(project.data?.status ?? '');

  // Another scene: its unsaved text is sent first; if that fails, the creator stays on this one
  // with the error showing, so nothing typed is lost unnoticed (QF6-001).
  const select = (sceneId: string) => {
    if (sceneId === selected?.id) return;
    flushAll().then(
      () => {
        setActionError('');
        setSelectedId(sceneId);
      },
      (e: unknown) => setActionError(errorText(e, 'Some changes aren’t saved yet.')),
    );
  };

  const move = (from: number, to: number) => {
    if (from < 0 || to < 0 || from === to) return;
    const ids = scenes.map((s) => s.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    reorder.mutate(ids, {onError: (e) => setActionError(errorText(e, 'The new order wasn’t saved.'))});
  };

  return (
    <div className="pb-8">
      <TopBar>
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            // Unsaved text is sent first; if that fails, the editor stays with the error (QF6-018).
            onClick={() =>
              flushAll().then(
                () => navigate(`/app/p/${id}/script`),
                (e: unknown) => setActionError(errorText(e, 'Some changes aren’t saved yet.')),
              )
            }
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg hover:bg-white/10"
            aria-label="Back to the script"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </button>
          <h1 className="min-w-0 truncate font-display text-xl font-semibold">{p.title}</h1>
          <StatusPill status={p.status} />
        </div>
      </TopBar>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {p.status === 'generating' ? (
          <p className="flex items-center gap-2 text-sm text-muted" role="status">
            <Loader2 className="h-4 w-4 animate-spin text-cyan" aria-hidden /> Making your Reel: {done} of {parts} parts ready
          </p>
        ) : t ? (
          <p className="text-sm text-muted">
            {t.durationSeconds.toFixed(1)}s{t.tooLong ? ' · over 90 s: shorten it before rendering' : ''}
          </p>
        ) : null}
        <span className="ml-auto flex flex-wrap gap-2">
          {missing && p.status !== 'generating' ? (
            <Button size="sm" loading={starting || generate.isPending} onClick={() => generateMissing()}>
              <Zap className="h-3.5 w-3.5" aria-hidden /> Generate missing
              {estimate.data ? ` · ${estimate.data.credits} credit${estimate.data.credits === 1 ? '' : 's'}` : ''}
            </Button>
          ) : null}
          {p.status === 'rendering' ? (
            <Button size="sm" variant="secondary" onClick={() => navigate(`/app/p/${id}/render`)}>
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Rendering…
            </Button>
          ) : (
            <Button
              size="sm"
              variant={canRender && !missing ? 'primary' : 'secondary'}
              disabled={!canRender || t?.tooLong}
              loading={starting && startRender.isPending}
              onClick={render}
              aria-describedby={canRender && !t?.tooLong ? undefined : 'render-why'}
            >
              <Clapperboard className="h-3.5 w-3.5" aria-hidden /> Render
            </Button>
          )}
          {/* A finished video exists (a later attempt stopped or failed doesn't hide it). */}
          {!canRender || t?.tooLong ? (
            <span id="render-why" className="self-center text-[11px] text-muted">
              {t?.tooLong
                ? 'Over 90 s: shorten it to render'
                : p.status === 'generating'
                  ? 'Rendering opens when every part is made'
                  : p.status === 'posting'
                    ? 'Publishing is running'
                    : 'Every scene needs its voice and visual first'}
            </span>
          ) : null}
          {p.latestRender?.state === 'succeeded' || p.thumbnailUrl ? (
            <Button size="sm" variant="secondary" onClick={() => navigate(`/app/p/${id}/publish`)}>
              <Send className="h-3.5 w-3.5" aria-hidden /> Publish
            </Button>
          ) : null}
        </span>
      </div>

      {p.status === 'needs_attention' ? (
        <Notice tone="error" className="mb-4">
          Some parts couldn't be made. Retry the scenes marked in red, or change them and generate again.
        </Notice>
      ) : null}
      {actionError ? (
        <Notice tone="error" className="mb-4">
          {actionError}
        </Notice>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[250px_minmax(0,1fr)_340px]">
        <aside className="order-2 lg:order-1" aria-label="Scene list">
          <SceneList
            scenes={scenes}
            selectedId={selected?.id ?? null}
            onSelect={select}
            onRetry={(sceneId) => generateMissing([sceneId])}
            onMove={move}
            retrying={starting || generate.isPending}
          />
        </aside>

        <section className="order-1 flex flex-col items-center lg:order-2" aria-label="Preview">
          <div className="w-full max-w-[340px] overflow-hidden rounded-2xl border border-line bg-black shadow-2xl">
            {shown && playerProps ? (
              <Player
                ref={player}
                component={Reel}
                inputProps={playerProps}
                durationInFrames={frames}
                fps={shown.fps}
                compositionWidth={shown.width}
                compositionHeight={shown.height}
                controls
                clickToPlay
                // With the space-key shortcut on, the player moves keyboard focus to its own Play
                // button when it appears and whenever playback stops, taking it from the field
                // being typed in (BUG-068). Its Play button still works with Space when focused.
                spaceKeyToPlayOrPause={false}
                acknowledgeRemotionLicense
                // Anything else that breaks the drawing shows a message instead of a blank player.
                errorFallback={() => (
                  <div className="grid h-full place-items-center p-6 text-center text-[13px] text-white/80">
                    The preview couldn't be shown.
                  </div>
                )}
                style={{width: '100%', aspectRatio: '9 / 16'}}
              />
            ) : (
              <div className="grid aspect-[9/16] place-items-center text-sm text-muted">
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
              </div>
            )}
          </div>
          {playerFailed ? (
            <p className="mt-2 text-center text-xs text-red-300" role="alert">
              The preview couldn't load one of its files.
            </p>
          ) : null}
          {playerFailed ? (
            <Button
              size="sm"
              variant="secondary"
              className="mt-2"
              onClick={() => {
                previousTimeline.current = undefined; // fresh links for every file
                setPlayerFailed(false);
                void timeline.refetch();
              }}
            >
              Reload preview
            </Button>
          ) : null}
          {t && !t.ready ? (
            <p className="mt-2 text-center text-xs text-muted">Scenes still being made show a coloured placeholder.</p>
          ) : null}
        </section>

        <div className="order-3">
          {selected ? (
            <Inspector key={selected.id} project={p} scene={selected} index={index} costs={credits.data?.costs} tab={tab} onTab={setTab} />
          ) : null}
        </div>
      </div>

      <div className="mt-4">
        <AudioBar project={p} playingTitle={shown?.music?.title} />
      </div>
    </div>
  );
}
