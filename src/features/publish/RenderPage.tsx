import {ArrowLeft, Clapperboard, Download, Film, RotateCcw, Send, X} from 'lucide-react';
import {Link, Navigate, useNavigate, useParams} from 'react-router-dom';
import {ApiError} from '@/api/client';
import {useCredits, useProject} from '@/api/projects';
import {isRenderActive, useCancelJob, useRender, useRenders, useStartRender} from '@/api/publishing';
import type {Render} from '@/api/types';
import {TopBar} from '@/components/layout/AppShell';
import {Button, ButtonLink} from '@/components/ui/Button';
import {FullPageSpinner} from '@/components/ui/FullPageSpinner';
import {Notice} from '@/components/ui/Notice';
import {errorText} from '@/features/create/errors';
import {StepHeader} from '@/features/create/StepHeader';

export const megabytes = (bytes: number | null | undefined) => (bytes ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : '');
export const seconds = (s: number | null | undefined) => (s ? `${Math.round(s)} s` : '');
const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

const STATE_LABEL: Record<Render['state'], string> = {
  queued: 'Waiting for the renderer',
  running: 'Rendering',
  succeeded: 'Ready',
  failed: 'Failed',
  cancelled: 'Stopped',
};

/** Screen 12 (F7): a render's progress, then its video with Download and Publish. */
export function RenderPage() {
  const {id = ''} = useParams();
  const navigate = useNavigate();
  const project = useProject(id);
  const history = useRenders(id);
  const start = useStartRender(id);
  const cancel = useCancelJob(id);
  const fresh = useRender(isRenderActive(project.data?.latestRender) ? project.data?.latestRender?.id : undefined);
  const cost = useCredits().data?.costs.render ?? 2;

  if (project.isPending) return <FullPageSpinner />;
  if (project.isError) {
    return project.error instanceof ApiError && project.error.status === 404 ? (
      <Navigate to="/app/projects" replace />
    ) : (
      <Notice tone="error">{errorText(project.error, 'This Reel could not be loaded.')}</Notice>
    );
  }
  const p = project.data;
  const render = fresh.data && fresh.data.id === p.latestRender?.id ? fresh.data : p.latestRender;
  const active = isRenderActive(render);
  // The newest finished video: after a stopped or failed attempt, the earlier video still counts.
  const video = render?.state === 'succeeded' ? render : (history.data?.find((x) => x.state === 'succeeded') ?? null);
  const shown = video && !active ? video : render;
  const renderAgain = () => {
    if (window.confirm(`Render this Reel again? ${cost} credits, given back if it fails.`)) start.mutate(undefined);
  };

  return (
    <div className="mx-auto max-w-5xl">
      <TopBar>
        <div className="flex min-w-0 items-center gap-2">
          <Link
            to={`/app/p/${id}/edit`}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg hover:bg-white/10"
            aria-label="Back to the editor"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Link>
          <h1 className="truncate text-lg font-semibold">{p.title}</h1>
        </div>
      </TopBar>
      <StepHeader current={2} publish />

      {!render ? (
        <div className="glass mx-auto mt-8 max-w-md p-6 text-center">
          <Clapperboard className="mx-auto h-8 w-8 text-muted" aria-hidden />
          <p className="mt-3 font-medium">This Reel hasn't been rendered yet</p>
          <p className="mt-1 text-sm text-muted">Press Render in the editor when every scene is ready.</p>
          <ButtonLink to={`/app/p/${id}/edit`} variant="secondary" className="mt-4">
            Open the editor
          </ButtonLink>
        </div>
      ) : (
        <div className="mt-8 grid gap-6 md:grid-cols-[minmax(0,320px)_1fr]">
          <div className="mx-auto w-full max-w-[320px]">
            <div className="relative aspect-[9/16] overflow-hidden rounded-2xl border border-line bg-black">
              {shown && shown.state === 'succeeded' && shown.video ? (
                <video
                  key={shown.id}
                  src={shown.video.url}
                  poster={shown.thumbnailUrl ?? undefined}
                  controls
                  playsInline
                  className="h-full w-full object-contain"
                  aria-label={`Rendered video of ${p.title}`}
                />
              ) : (
                <div className="grid h-full place-items-center bg-gradient-to-b from-violet/25 to-cyan/10 p-6 text-center">
                  <div>
                    <Film className="mx-auto h-8 w-8 text-white/70" aria-hidden />
                    <p className="mt-2 text-sm text-white/80">
                      {active ? 'Your video is being made' : STATE_LABEL[render.state]}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <section className="glass p-5" aria-labelledby="render-status">
            <h2 id="render-status" className="text-lg font-semibold" aria-live="polite">
              {active
                ? STATE_LABEL[render.state]
                : video
                  ? 'Your video is ready'
                  : history.isPending
                    ? 'Checking your videos…'
                    : STATE_LABEL[render.state]}
            </h2>

            {active ? (
              <>
                <div
                  className="mt-4 h-2 overflow-hidden rounded-full bg-white/10"
                  role="progressbar"
                  aria-label="Render progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={render.progress}
                >
                  <div
                    className="h-full rounded-full bg-brand transition-[width]"
                    style={{width: `${render.progress}%`}}
                  />
                </div>
                <p className="mt-2 text-sm tabular-nums text-muted" role="status" aria-live="polite">
                  {Math.floor(render.progress / 10) * 10}%
                </p>
                <p className="mt-3 text-[13px] text-muted">
                  This can take a while. You can leave this page; the render carries on and the Reel shows it on the
                  dashboard.
                </p>
                {render.jobId ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-4"
                    loading={cancel.isPending}
                    onClick={() =>
                      window.confirm('Stop this render? Its credits are given back.') && cancel.mutate(render.jobId!)
                    }
                  >
                    <X className="h-3.5 w-3.5" aria-hidden /> Stop rendering
                  </Button>
                ) : null}
              </>
            ) : null}

            {!active && video?.video ? (
              <>
                <p className="mt-1 text-sm text-muted">
                  {[seconds(video.video.durationSeconds), megabytes(video.video.sizeBytes)].filter(Boolean).join(' · ')}
                </p>
                {video.outdated ? (
                  <Notice className="mt-4">
                    You edited the Reel after this render, so the video shows the earlier version.
                  </Notice>
                ) : null}
                <div className="mt-5 flex flex-wrap gap-2">
                  <Button onClick={() => navigate(`/app/p/${id}/publish`)}>
                    <Send className="h-4 w-4" aria-hidden /> Publish
                  </Button>
                  <a
                    href={video.video.downloadUrl}
                    className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-white/[0.05] px-4 text-sm hover:bg-white/[0.09]"
                  >
                    <Download className="h-4 w-4" aria-hidden /> Download
                  </a>
                  {video.outdated && video === render ? (
                    <Button variant="secondary" loading={start.isPending} onClick={renderAgain}>
                      <RotateCcw className="h-4 w-4" aria-hidden /> Render again · {cost} credits
                    </Button>
                  ) : null}
                </div>
              </>
            ) : null}

            {(render.state === 'failed' || render.state === 'cancelled') && !history.isPending ? (
              <div className={video ? 'mt-6 border-t border-line pt-4' : undefined}>
                {render.state === 'failed' ? (
                  <Notice tone="error" className="mt-4">
                    {video ? 'Your last render failed: ' : ''}
                    {render.error?.message ?? "The video couldn't be made."} Your credits were given back.
                  </Notice>
                ) : (
                  <p className="mt-2 text-sm text-muted">
                    {video ? 'Your last render was stopped' : 'The render was stopped'} and its credits given back.
                  </p>
                )}
                <Button
                  className="mt-3"
                  variant={video ? 'secondary' : 'primary'}
                  size={video ? 'sm' : 'md'}
                  loading={start.isPending}
                  onClick={renderAgain}
                >
                  <RotateCcw className="h-4 w-4" aria-hidden /> {video ? 'Render again' : 'Try again'} · {cost} credits
                </Button>
              </div>
            ) : null}

            {start.isError ? (
              <Notice tone="error" className="mt-4">
                {errorText(start.error, "The render couldn't start.")}
              </Notice>
            ) : null}
            {cancel.isError ? (
              <Notice tone="error" className="mt-4">
                {errorText(cancel.error, "The render couldn't be stopped.")}
              </Notice>
            ) : null}

            {history.data && history.data.some((x) => x.id !== render?.id && x.id !== video?.id) ? (
              <div className="mt-6 border-t border-line pt-4">
                <h3 className="text-xs font-medium uppercase tracking-wider text-muted">Earlier renders</h3>
                <ul className="mt-2 space-y-1.5">
                  {history.data
                    .filter((x) => x.id !== render?.id && x.id !== video?.id)
                    .slice(0, 5)
                    .map((r) => (
                      <li key={r.id} className="flex items-center justify-between gap-3 text-[13px]">
                        <span className="text-muted">
                          {when(r.createdAt)} · {STATE_LABEL[r.state]}
                          {r.video ? ` · ${seconds(r.video.durationSeconds)}` : ''}
                        </span>
                        {r.video ? (
                          <a href={r.video.downloadUrl} className="text-violet-soft hover:underline">
                            Download
                          </a>
                        ) : null}
                      </li>
                    ))}
                </ul>
              </div>
            ) : null}
          </section>
        </div>
      )}
    </div>
  );
}
