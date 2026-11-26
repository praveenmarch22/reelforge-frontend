import {ArrowRight, Loader2, Plus, RefreshCw, Scissors, Sparkles, Zap} from 'lucide-react';
import {useEffect, useRef, useState} from 'react';
import {Link, Navigate, useNavigate, useParams} from 'react-router-dom';
import {ApiError} from '@/api/client';
import {
  useAddScene,
  useCredits,
  useDeleteScene,
  useDuplicateScene,
  useEstimate,
  useGenerate,
  useHooks,
  useProject,
  useProjectJobs,
  useRegenerateScript,
  useReorderScenes,
  useRewriteScene,
  useUpdateProject,
  useUpdateScene,
  useLeaveSignal,
  waitForJob,
} from '@/api/projects';
import type {Project} from '@/api/types';
import {TopBar} from '@/components/layout/AppShell';
import {Button} from '@/components/ui/Button';
import {FullPageSpinner} from '@/components/ui/FullPageSpinner';
import {Notice} from '@/components/ui/Notice';
import {cn} from '@/lib/cn';
import {flushAll, useWarnBeforeLeaving} from './autosave';
import {errorText} from './errors';
import {NARRATION_MAX, SceneCard} from './SceneCard';
import {StepHeader} from './StepHeader';
import {VoicePicker} from './VoicePicker';

const SCENES_MAX = 30;
const TITLE_MAX = 120;
const GENERATED = ['generating', 'needs_attention', 'ready', 'rendering', 'render_failed', 'rendered', 'posting', 'post_failed', 'posted'];

/** The title, saved when the field is left. The server's title (for example the one the AI
 * gives a new script) only replaces it while the field isn't being edited (QF5-013). */
function TitleField({project}: {project: Project}) {
  const update = useUpdateProject(project.id);
  const [title, setTitle] = useState(project.title);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setTitle(project.title);
  }, [project.title]);
  const save = () => {
    editing.current = false;
    const value = title.trim();
    if (!value) return setTitle(project.title);
    if (value !== project.title) update.mutate({title: value});
  };
  return (
    <div>
      <label htmlFor="project-title" className="sr-only">
        Title
      </label>
      <input
        id="project-title"
        value={title}
        maxLength={TITLE_MAX}
        onFocus={() => (editing.current = true)}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        className="w-full bg-transparent font-display text-2xl font-semibold focus:outline-none"
      />
      {update.isError ? <p className="text-xs text-red-300">{errorText(update.error, 'Not saved.')}</p> : null}
    </div>
  );
}

/** Screen 10 (docs/SCREENS_F5_F6.md): edit the script, then generate the Reel. */
export function ScriptEditorPage() {
  const {id = ''} = useParams();
  const navigate = useNavigate();
  const project = useProject(id);
  const p = project.data;
  const scripting = p?.status === 'scripting';
  const estimate = useEstimate(id, !!p && !scripting);
  const jobs = useProjectJobs(id, !!p && !scripting);
  const credits = useCredits();
  const updateScene = useUpdateScene(id);
  const addScene = useAddScene(id);
  const deleteScene = useDeleteScene(id);
  const duplicate = useDuplicateScene(id);
  const reorder = useReorderScenes(id);
  const rewrite = useRewriteScene(id);
  const regenerate = useRegenerateScript(id);
  const hooks = useHooks(id);
  const generate = useGenerate(id);
  const updateProject = useUpdateProject(id);
  useWarnBeforeLeaving();
  const leaveSignal = useLeaveSignal();

  const [dragging, setDragging] = useState<string | null>(null);
  const [newScene, setNewScene] = useState('');
  const [actionError, setActionError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [confirmRewriteAll, setConfirmRewriteAll] = useState(false);
  const [rewriteAllText, setRewriteAllText] = useState('');
  // Why the new script this visit asked for (B8) failed, from that very job (QF5-018, BUG-054).
  const [rewriteFailure, setRewriteFailure] = useState('');
  // Set from the first moment of a click on Generate, before unsaved text is sent (QF5-020).
  const [starting, setStarting] = useState(false);

  // A script finishing (or failing) refreshes the list of jobs that explains it.
  const wasScripting = useRef(scripting);
  useEffect(() => {
    if (wasScripting.current && !scripting) void jobs.refetch();
    wasScripting.current = scripting;
  }, [scripting, jobs]);

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

  const scenes = [...p.scenes].sort((a, b) => a.position - b.position);
  const starts = scenes.map((_, i) => scenes.slice(0, i).reduce((sum, s) => sum + s.estimatedSeconds, 0));
  const costs = credits.data?.costs;
  const target = p.targetSeconds;
  const length = p.estimatedSeconds;
  const over = length > target * 1.15;
  const generated = GENERATED.includes(p.status);
  const lastScript = jobs.data?.find((j) => j.type === 'script');
  const scriptFailed = !scripting && lastScript?.state === 'failed' ? lastScript : null;
  const newTopicHref = `/app/new?${new URLSearchParams({topic: p.topic, mode: p.mode, length: String(p.targetSeconds)})}`;

  const run = (promise: Promise<unknown>, fallback: string) =>
    promise.then(
      () => setActionError(''),
      (e: unknown) => setActionError(errorText(e, fallback)),
    );

  const move = (from: number, to: number) => {
    if (to < 0 || to >= scenes.length || from === to) return;
    const ids = scenes.map((s) => s.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    setAnnouncement(`Scene ${from + 1} moved to position ${to + 1}.`);
    void run(reorder.mutateAsync(ids), 'The new order wasn’t saved.');
  };

  const rewriteAll = (instructions?: string) =>
    run(
      flushAll()
        .then(() => regenerate.mutateAsync(instructions))
        .then(({job}) => {
          setRewriteFailure('');
          setConfirmRewriteAll(false);
          setRewriteAllText('');
          // Waits on the job itself: a quick failure can end before the screen ever sees the
          // project "scripting", so the status alone can't tell.
          waitForJob(job.id, leaveSignal())
            .then((done) => {
              if (done.state === 'failed') setRewriteFailure(done.error?.message ?? 'Something went wrong.');
              void project.refetch();
              void jobs.refetch();
            })
            .catch(() => undefined);
        }),
      'It didn’t start.',
    );

  const onGenerate = () => {
    if (starting) return;
    setStarting(true);
    void run(
      flushAll() // generate what is on screen, including the last few keystrokes (QF5-002)
        .then(() => generate.mutateAsync(undefined))
        .then(() => navigate(`/app/p/${id}/edit`)),
      'Generating didn’t start.',
    ).finally(() => setStarting(false));
  };

  return (
    <div className="pb-10">
      <TopBar>
        <nav className="flex items-center gap-2 text-xs text-muted" aria-label="Breadcrumb">
          <Link to="/app/projects" className="hover:text-white">
            Projects
          </Link>
          <span aria-hidden>/</span>
          <span className="text-white">Script</span>
          {generated ? (
            <Link to={`/app/p/${id}/edit`} className="ml-3 inline-flex items-center gap-1 text-cyan hover:underline">
              Open the Reel editor <ArrowRight className="h-3 w-3" aria-hidden />
            </Link>
          ) : null}
        </nav>
      </TopBar>
      <StepHeader current={1} />
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0 space-y-3" aria-label="Script storyboard">
          <TitleField project={p} />
          <p className="text-sm text-muted">
            {scenes.length} scene{scenes.length === 1 ? '' : 's'} · edit the words, mood and on-screen text before
            generating.
          </p>

          {scripting ? (
            <section className="glass flex items-center gap-3 p-6" role="status">
              <Loader2 className="h-5 w-5 animate-spin text-cyan" aria-hidden />
              <div>
                <p className="font-semibold">Writing your script…</p>
                <p className="text-sm text-muted">This takes a few seconds. You can leave and come back.</p>
              </div>
            </section>
          ) : null}

          {!scripting && scenes.length === 0 ? (
            <Notice tone="error">
              The script couldn't be written
              {scriptFailed?.error ? `: ${scriptFailed.error.message}` : '.'} Your credit was refunded.{' '}
              <button type="button" className="font-semibold text-white underline" onClick={() => void rewriteAll()}>
                Try again
              </button>{' '}
              or{' '}
              <Link to={newTopicHref} className="font-semibold text-white underline">
                change the topic
              </Link>
              .
            </Notice>
          ) : null}

          {!scripting && scenes.length > 0 && rewriteFailure ? (
            <Notice tone="error">
              A new script couldn't be written: {rewriteFailure} Your scenes are unchanged and the credit was refunded.
            </Notice>
          ) : null}

          {scenes.map((scene, index) => (
            <div
              key={scene.id}
              onDragOver={(e) => dragging && e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const from = scenes.findIndex((s) => s.id === dragging);
                setDragging(null);
                move(from, index);
              }}
              className={cn(dragging && dragging !== scene.id && 'rounded-2xl ring-1 ring-violet/30')}
            >
              <SceneCard
                scene={scene}
                index={index}
                count={scenes.length}
                startsAt={starts[index]}
                locked={scripting}
                rewriteCost={costs?.rewrite}
                errorText={errorText}
                onSave={(body) => updateScene.mutateAsync({sceneId: scene.id, body})}
                onRewrite={(instructions) => rewrite.mutateAsync({sceneId: scene.id, instructions, signal: leaveSignal()})}
                onDuplicate={() => {
                  setAnnouncement(`Scene ${index + 1} duplicated.`);
                  void run(duplicate.mutateAsync(scene.id), 'It wasn’t duplicated.');
                }}
                onDelete={() => {
                  if (!window.confirm(`Delete scene ${index + 1}?`)) return;
                  setAnnouncement(`Scene ${index + 1} deleted.`);
                  void run(deleteScene.mutateAsync(scene.id), 'It wasn’t deleted.');
                }}
                onMove={(to) => move(index, to)}
                dragProps={{
                  draggable: !scripting,
                  onDragStart: (e) => {
                    e.dataTransfer.effectAllowed = 'move';
                    setDragging(scene.id);
                  },
                  onDragEnd: () => setDragging(null),
                }}
              >
                {index === 0 ? (
                  <div className="mt-3 border-t border-line pt-3">
                    <Button variant="ghost" size="sm" loading={hooks.isPending} disabled={scripting} onClick={() => hooks.mutate(leaveSignal())}>
                      {!hooks.isPending ? <Sparkles className="h-3.5 w-3.5 text-violet-soft" aria-hidden /> : null}
                      Try another opening
                    </Button>
                    {hooks.isError ? <p className="mt-1 text-xs text-red-300">{errorText(hooks.error, 'No ideas this time.')}</p> : null}
                    {hooks.data ? (
                      <ul className="mt-2 space-y-1.5" aria-label="Other openings">
                        {hooks.data.map((hook) => (
                          <li key={hook}>
                            <button
                              type="button"
                              className="w-full rounded-lg border border-line bg-white/[0.03] px-3 py-2 text-left text-[13px] hover:border-violet"
                              onClick={() => {
                                hooks.reset();
                                void run(updateScene.mutateAsync({sceneId: scene.id, body: {narration: hook}}), 'The opening wasn’t saved.');
                              }}
                            >
                              {hook}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
              </SceneCard>
            </div>
          ))}

          {!scripting && scenes.length > 0 ? (
            <form
              className="glass flex flex-wrap items-center gap-2 p-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (!newScene.trim()) return;
                void run(addScene.mutateAsync({narration: newScene.trim()}).then(() => setNewScene('')), 'The scene wasn’t added.');
              }}
            >
              <label htmlFor="new-scene" className="sr-only">
                New scene narration
              </label>
              <input
                id="new-scene"
                value={newScene}
                maxLength={NARRATION_MAX}
                disabled={scenes.length >= SCENES_MAX}
                onChange={(e) => setNewScene(e.target.value)}
                placeholder="Add a scene: type its narration"
                className="min-w-0 flex-1 basis-48 bg-transparent px-2 text-sm focus:outline-none"
              />
              <span className="text-[11px] text-muted">
                {scenes.length} of {SCENES_MAX} scenes
              </span>
              <Button type="submit" variant="secondary" size="sm" loading={addScene.isPending} disabled={scenes.length >= SCENES_MAX}>
                <Plus className="h-3.5 w-3.5" aria-hidden /> Add scene
              </Button>
            </form>
          ) : null}
        </section>

        <aside className="lg:sticky lg:top-6 lg:self-start" aria-label="Summary">
          <section className="glass space-y-5 p-5">
            <div>
              <div className="flex items-baseline justify-between">
                <p className="text-xs font-medium uppercase tracking-wider text-muted">Estimated length</p>
                <p className={cn('font-display text-xl font-semibold tabular-nums', over && 'text-amber-300')}>{length.toFixed(1)}s</p>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden>
                <div className={cn('h-full rounded-full', over ? 'bg-amber-400' : 'bg-brand')} style={{width: `${Math.min(100, (length / target) * 100)}%`}} />
              </div>
              <p className="mt-1.5 text-xs text-muted">
                Target {target}s{over ? ' · over the target' : ''}
                {length > 90 ? ' · over 90 s can’t be rendered' : ''}
              </p>
              {scenes.length && length < 5 ? (
                <p className="mt-1 text-xs text-amber-300">Very short: under 5 seconds. Add a scene or two.</p>
              ) : null}
              {over && !scripting ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-2"
                  loading={regenerate.isPending}
                  onClick={() => void rewriteAll(`Shorten it to about ${target} seconds, keeping the main points.`)}
                >
                  <Scissors className="h-3.5 w-3.5" aria-hidden /> Shorten with AI
                  {costs ? ` · ${costs.script} credit${costs.script === 1 ? '' : 's'}` : ''}
                </Button>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted">Words</p>
                <p className="font-semibold tabular-nums">{p.wordCount}</p>
              </div>
              <div>
                <p className="text-xs text-muted">Scenes</p>
                <p className="font-semibold tabular-nums">{scenes.length}</p>
              </div>
            </div>
            <VoicePicker
              value={p.voiceId}
              disabled={scripting || updateProject.isPending}
              onChange={(voiceId) => void run(updateProject.mutateAsync({voiceId}), 'The voice wasn’t changed.')}
            />
            <div className="flex items-center justify-between rounded-xl border border-line bg-white/[0.03] px-3 py-2.5 text-sm">
              <span className="text-muted">Generating costs</span>
              <span className="font-semibold">
                {estimate.data ? `${estimate.data.credits} credit${estimate.data.credits === 1 ? '' : 's'}` : '…'}
              </span>
            </div>
            <Button fullWidth size="lg" loading={starting || generate.isPending} disabled={scripting || !scenes.length} onClick={onGenerate}>
              <Zap className="h-4 w-4" aria-hidden /> Generate Reel
            </Button>
            <p className="text-center text-xs text-muted">
              Voices, visuals and music for every scene. {estimate.data ? `${estimate.data.balance} credits left.` : ''}
            </p>
            {actionError ? <Notice tone="error">{actionError}</Notice> : null}
          </section>

          <section className="glass mt-4 p-4">
            {confirmRewriteAll ? (
              <div className="space-y-2">
                <p className="text-sm">Write a new script? Every scene is replaced. {costs ? `${costs.script} credit.` : ''}</p>
                <input
                  value={rewriteAllText}
                  maxLength={200}
                  onChange={(e) => setRewriteAllText(e.target.value)}
                  placeholder="Optional: what should change"
                  aria-label="What should change"
                  className="h-9 w-full rounded-lg border border-line bg-white/[0.04] px-3 text-sm focus:outline-none"
                />
                <div className="flex gap-2">
                  <Button size="sm" loading={regenerate.isPending} onClick={() => void rewriteAll(rewriteAllText.trim() || undefined)}>
                    Write a new script
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmRewriteAll(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="ghost" size="sm" fullWidth disabled={scripting} onClick={() => setConfirmRewriteAll(true)}>
                <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Rewrite whole script
              </Button>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
