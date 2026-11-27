import {ArrowLeft, CheckCircle2, Copy, ExternalLink, Instagram, Sparkles, Youtube} from 'lucide-react';
import {useEffect, useRef, useState, type KeyboardEvent} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {Link, Navigate, useParams} from 'react-router-dom';
import {api, ApiError} from '@/api/client';
import {useMe} from '@/api/hooks';
import {useLeaveSignal, useProject, useUpdateProject} from '@/api/projects';
import {isPostActive, useConnect, usePost, usePublish, useRenders, useWriteCaption} from '@/api/publishing';
import type {Post, Project, User, Visibility} from '@/api/types';
import {TopBar} from '@/components/layout/AppShell';
import {Button, ButtonLink} from '@/components/ui/Button';
import {Chip} from '@/components/ui/Chip';
import {FullPageSpinner} from '@/components/ui/FullPageSpinner';
import {Notice} from '@/components/ui/Notice';
import {errorText} from '@/features/create/errors';
import {StepHeader} from '@/features/create/StepHeader';
import {cn} from '@/lib/cn';
import {ConnectionResult} from './ConnectionResult';

export const TITLE_MAX = 100;
export const CAPTION_MAX = 2200;
export const HASHTAGS_MAX = 30;
const SAVE_MS = 800;

const VISIBILITY: {value: Visibility; label: string}[] = [
  {value: 'public', label: 'Public'},
  {value: 'unlisted', label: 'Unlisted'},
  {value: 'private', label: 'Private'},
];
const TRACKER = [
  {state: 'queued', label: 'Queued'},
  {state: 'uploading', label: 'Uploading'},
  {state: 'processing', label: 'Processing'},
  {state: 'published', label: 'Published'},
] as const;

/** YouTube refuses `<` and `>` in titles and descriptions (YT-11). */
export const hasAngle = (text: string) => /[<>]/.test(text);

/** The chips plus a hashtag still in the box, without a duplicate (BUG-083). */
export function withDraft(tags: string[], draft: string): string[] {
  const tag = cleanTag(draft);
  if (!tag || tags.some((t) => t.toLowerCase() === tag.toLowerCase()) || tags.length >= HASHTAGS_MAX) return tags;
  return [...tags, tag];
}

/** A hashtag as typed: without `#` and spaces. */
export const cleanTag = (raw: string) => raw.trim().replace(/^#+/, '').replace(/\s+/g, '');

/** Screens 13 and 20 (F7): publish the latest render to YouTube, follow it, then "Your Short is live". */
export function PublishPage() {
  const {id = ''} = useParams();
  const project = useProject(id);
  const me = useMe();

  if (project.isPending || me.isPending) return <FullPageSpinner />;
  if (project.isError) {
    return project.error instanceof ApiError && project.error.status === 404 ? (
      <Navigate to="/app/projects" replace />
    ) : (
      <Notice tone="error">{errorText(project.error, 'This Reel could not be loaded.')}</Notice>
    );
  }
  const p = project.data;
  return (
    <div className="mx-auto max-w-5xl">
      <ConnectionResult user={me.data ?? undefined} />
      <TopBar>
        <div className="flex min-w-0 items-center gap-2">
          <Link
            to={`/app/p/${id}/render`}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg hover:bg-white/10"
            aria-label="Back to the video"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Link>
          <h1 className="truncate text-lg font-semibold">{p.title}</h1>
        </div>
      </TopBar>
      <StepHeader current={3} publish />
      <PublishBody project={p} user={me.data ?? undefined} />
    </div>
  );
}

function PublishBody({project: p, user}: {project: Project; user: User | undefined}) {
  const history = useRenders(p.id);
  // The newest finished video (an attempt stopped or failed since doesn't hide it).
  const render =
    p.latestRender?.state === 'succeeded' && p.latestRender.video
      ? p.latestRender
      : (history.data?.find((r) => r.state === 'succeeded' && r.video) ?? null);
  // The post this screen follows: the one just started, else the Reel's latest.
  const [postId, setPostId] = useState<string | undefined>(p.latestPost?.id);
  const followed = usePost(postId);
  const post: Post | null = followed.data ?? (p.latestPost?.id === postId ? p.latestPost : null);
  const [again, setAgain] = useState(false);
  const qc = useQueryClient();
  const failedCode = post?.state === 'failed' ? post.error?.code : undefined;
  useEffect(() => {
    if (failedCode === 'reconnect_required') void qc.invalidateQueries({queryKey: ['me']}); // QF7-021
  }, [failedCode, qc]);

  if (!render && history.isPending) return <FullPageSpinner />;
  if (!render) {
    return (
      <div className="glass mx-auto mt-8 max-w-md p-6 text-center">
        <p className="font-medium">Render the Reel first</p>
        <p className="mt-1 text-sm text-muted">Publishing sends the finished video, so it needs a render.</p>
        <ButtonLink to={`/app/p/${p.id}/render`} variant="secondary" className="mt-4">
          Go to the render
        </ButtonLink>
      </div>
    );
  }

  const showTracker = post && isPostActive(post);
  const showLive = post && post.state === 'published' && !again;
  return (
    <div className="mt-8 grid gap-6 md:grid-cols-[minmax(0,300px)_1fr]">
      <div className="mx-auto w-full max-w-[300px]">
        <div className="aspect-[9/16] overflow-hidden rounded-2xl border border-line bg-black">
          <video
            key={render.id}
            src={render.video!.url}
            poster={render.thumbnailUrl ?? undefined}
            controls
            playsInline
            className="h-full w-full object-contain"
            aria-label={`Video of ${p.title}`}
          />
        </div>
      </div>
      {showTracker ? (
        <Tracker post={post} />
      ) : showLive ? (
        <Live post={post} onAgain={() => setAgain(true)} renderIsNewer={post.renderId !== render.id} />
      ) : (
        <PublishForm
          project={p}
          user={user}
          renderId={render.id}
          outdated={render.outdated}
          failed={post?.state === 'failed' ? post : null}
          sameRender={post?.renderId === render.id}
          latestPostUrl={post?.state === 'published' && post.renderId === render.id ? post.url : null}
          renderRunning={p.status === 'rendering'}
          onStarted={(id) => {
            setAgain(false);
            setPostId(id);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- the form

function PublishForm({
  project: p,
  user,
  renderId,
  outdated,
  failed,
  sameRender,
  latestPostUrl,
  renderRunning,
  onStarted,
}: {
  project: Project;
  user: User | undefined;
  renderId: string;
  outdated: boolean;
  failed: Post | null;
  sameRender: boolean;
  latestPostUrl: string | null;
  renderRunning: boolean;
  onStarted: (postId: string) => void;
}) {
  const [title, setTitle] = useState(p.postTitle || p.title.slice(0, TITLE_MAX));
  const [caption, setCaption] = useState(p.postCaption);
  const [tags, setTags] = useState<string[]>(p.hashtags);
  const [tagDraft, setTagDraft] = useState('');
  // Try again keeps what the failed try asked for (BUG-080).
  const [visibility, setVisibility] = useState<Visibility>(failed?.visibility ?? 'public');
  const [confirmOutdated, setConfirmOutdated] = useState(false);
  // The API may find the render outdated although the page didn't know yet (QF7-003).
  const [refusedFor, setRefusedFor] = useState<string | null>(null);
  const mustConfirm = outdated || refusedFor === renderId;
  const [problem, setProblem] = useState<{text: string; postedUrl?: string | null} | null>(null);
  const qc = useQueryClient();
  const leaveSignal = useLeaveSignal();
  const write = useWriteCaption(p.id);
  const publish = usePublish(p.id);
  const save = useUpdateProject(p.id);
  const connection = user?.connections?.youtube ?? null;

  // The text is kept on the project as it is typed, so leaving and coming back keeps it. Each
  // field is sent only when the API would accept it, and counts as saved only once it is
  // (QF7-004). Saving post text is not an edit of the Reel (QF7-001, backend).
  const saved = useRef({title: p.postTitle, caption: p.postCaption, tags: p.hashtags.join(' ')});
  const latest = useRef({title, caption, tags});
  latest.current = {title, caption, tags};
  const sendText = () => {
    const now = latest.current;
    const body: {postTitle?: string; postCaption?: string; hashtags?: string[]} = {};
    const t = now.title.trim();
    if (t !== saved.current.title && t && t.length <= TITLE_MAX && !hasAngle(t)) body.postTitle = t;
    if (now.caption !== saved.current.caption && now.caption.length <= CAPTION_MAX && !hasAngle(now.caption)) {
      body.postCaption = now.caption;
    }
    if (now.tags.join(' ') !== saved.current.tags) body.hashtags = now.tags;
    if (!Object.keys(body).length) return Promise.resolve();
    return save.mutateAsync(body).then(
      () => {
        if (body.postTitle !== undefined) saved.current.title = body.postTitle;
        if (body.postCaption !== undefined) saved.current.caption = body.postCaption;
        if (body.hashtags !== undefined) saved.current.tags = body.hashtags.join(' ');
      },
      () => undefined, // shown under the form; tried again with the next change
    );
  };
  const send = useRef(sendText);
  send.current = sendText;
  useEffect(() => {
    const timer = setTimeout(() => void send.current(), SAVE_MS);
    return () => clearTimeout(timer);
  }, [title, caption, tags]);
  // Whatever is still unsent goes when the screen closes inside the app. Going to Google waits
  // for it first (QF7-018); a reload or a closed tab can lose the last 0.8 s of typing.
  useEffect(() => () => void send.current(), []);

  const addTag = (raw: string) => {
    const tag = cleanTag(raw);
    if (!tag) return;
    setTags((t) =>
      t.some((x) => x.toLowerCase() === tag.toLowerCase()) || t.length >= HASHTAGS_MAX ? t : [...t, tag],
    );
    setTagDraft('');
  };
  const onTagKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(tagDraft);
    } else if (e.key === 'Backspace' && !tagDraft && tags.length) {
      setTags((t) => t.slice(0, -1));
    }
  };

  const writeWithAi = () => {
    const typed = title.trim() !== p.title.trim() || caption.trim() || tags.length;
    if (typed && !window.confirm('Replace the title, description and hashtags with new ones?')) return;
    // Stops waiting when the page closes (QF7-015); F4 saved the text on the project itself.
    write.mutate(leaveSignal(), {
      onSuccess: (text) => {
        setTitle(text.title);
        setCaption(text.caption);
        setTags(text.hashtags);
        saved.current = {title: text.title, caption: text.caption, tags: text.hashtags.join(' ')};
      },
    });
  };

  const titleError = !title.trim()
    ? 'Add a title'
    : title.length > TITLE_MAX
      ? `Use ${TITLE_MAX} characters or fewer`
      : hasAngle(title)
        ? 'Remove the < and > characters'
        : null;
  const captionError =
    caption.length > CAPTION_MAX
      ? `Use ${CAPTION_MAX} characters or fewer`
      : hasAngle(caption)
        ? 'Remove the < and > characters'
        : null;
  const blocked =
    !connection ||
    connection.status !== 'connected' ||
    !!titleError ||
    !!captionError ||
    (mustConfirm && !confirmOutdated) ||
    renderRunning;

  const submit = () => {
    setProblem(null);
    if (tagDraft.trim()) addTag(tagDraft);
    publish.mutate(
      {
        renderId,
        platform: 'youtube',
        title: title.trim(),
        caption: caption.trim(),
        hashtags: withDraft(tags, tagDraft),
        visibility,
        confirmOutdated: mustConfirm ? confirmOutdated : undefined,
      },
      {
        onSuccess: ({post}) => onStarted(post.id),
        onError: (e) => {
          const code = e instanceof ApiError ? e.code : '';
          // Each refusal points to what to do (QF7-003).
          if (code === 'not_connected' || code === 'reconnect_required') void qc.invalidateQueries({queryKey: ['me']});
          if (code === 'render_outdated') setRefusedFor(renderId);
          if (code === 'already_posted') {
            // The page may not know that post (published from another tab): read it now (BUG-081).
            void api<{project: Project}>(`/projects/${p.id}`)
              .then(({project}) => {
                const live = project.latestPost;
                if (live?.state === 'published' && live.renderId === renderId && live.url) {
                  setProblem((now) => (now ? {...now, postedUrl: live.url} : now));
                }
                qc.setQueryData(['project', p.id], project);
              })
              .catch(() => undefined);
          }
          setProblem({
            text:
              code === 'reconnect_required'
                ? 'Your YouTube connection has expired. Reconnect YouTube above, then publish.'
                : code === 'not_connected'
                  ? 'Connect your YouTube channel above first.'
                  : code === 'render_outdated'
                    ? 'You edited the Reel after this render. Tick "Publish this version anyway", or render again.'
                    : errorText(e, "Publishing couldn't start."),
            postedUrl: code === 'already_posted' && latestPostUrl ? latestPostUrl : null,
          });
        },
      },
    );
  };

  return (
    <section className="glass space-y-5 p-5" aria-labelledby="publish-title">
      <h2 id="publish-title" className="text-lg font-semibold">
        Publish
      </h2>

      <fieldset>
        <legend className="text-xs font-medium uppercase tracking-wider text-muted">Where</legend>
        <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Platform">
          <div
            className="flex items-center gap-2 rounded-xl border border-violet bg-violet/15 px-3 py-2.5 text-sm"
            role="radio"
            aria-checked="true"
          >
            <Youtube className="h-4 w-4 text-red-400" aria-hidden /> YouTube Shorts
          </div>
          <div
            className="flex items-center gap-2 rounded-xl border border-line px-3 py-2.5 text-sm text-muted"
            role="radio"
            aria-checked="false"
            aria-disabled="true"
          >
            <Instagram className="h-4 w-4" aria-hidden /> Instagram Reels
            <span className="ml-auto text-[11px]">Coming soon</span>
          </div>
        </div>
      </fieldset>

      <AccountRow projectId={p.id} user={user} beforeLeave={() => send.current()} />

      <div>
        <div className="flex justify-between text-xs font-medium uppercase tracking-wider text-muted">
          <label htmlFor="post-title">Title</label>
          <span
            id="post-title-count"
            className={cn('tabular-nums normal-case', title.length > TITLE_MAX && 'text-red-300')}
          >
            {title.length}/{TITLE_MAX}
          </span>
        </div>
        <input
          id="post-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-invalid={!!titleError}
          aria-describedby={titleError ? 'post-title-error post-title-count' : 'post-title-count'}
          className="mt-1.5 h-10 w-full rounded-xl border border-line bg-white/[0.04] px-3 text-sm focus:outline-none focus:ring-1 focus:ring-violet"
        />
        {titleError ? (
          <p id="post-title-error" className="mt-1 text-xs text-red-300">
            {titleError}
          </p>
        ) : null}
      </div>

      <div>
        <div className="flex justify-between text-xs font-medium uppercase tracking-wider text-muted">
          <label htmlFor="post-caption">Description</label>
          <span
            id="post-caption-count"
            className={cn('tabular-nums normal-case', caption.length > CAPTION_MAX && 'text-red-300')}
          >
            {caption.length}/{CAPTION_MAX}
          </span>
        </div>
        <textarea
          id="post-caption"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          rows={4}
          aria-invalid={!!captionError}
          aria-describedby="post-caption-note post-caption-count"
          className="mt-1.5 w-full rounded-xl border border-line bg-white/[0.04] p-3 text-sm focus:outline-none focus:ring-1 focus:ring-violet"
        />
        <p id="post-caption-note" className={cn('mt-1 text-xs', captionError ? 'text-red-300' : 'text-muted')}>
          {captionError ?? 'Credits for the music and voice are added at the end of the description.'}
        </p>
      </div>

      <div>
        <label
          htmlFor="post-tags"
          className="flex justify-between text-xs font-medium uppercase tracking-wider text-muted"
        >
          <span>Hashtags</span>
          <span className="tabular-nums normal-case">
            {tags.length}/{HASHTAGS_MAX}
          </span>
        </label>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-xl border border-line bg-white/[0.04] p-2">
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-full bg-violet/20 px-2.5 py-1 text-[12px]"
            >
              #{tag}
              <button
                type="button"
                onClick={() => setTags((t) => t.filter((x) => x !== tag))}
                aria-label={`Remove #${tag}`}
                className="text-white/60 hover:text-white"
              >
                ×
              </button>
            </span>
          ))}
          <input
            id="post-tags"
            value={tagDraft}
            onChange={(e) => {
              const value = e.target.value;
              if (/[,\s]/.test(value.trim())) {
                value.split(/[,\s]+/).filter(Boolean).forEach(addTag); // pasted several at once
                setTagDraft('');
              } else setTagDraft(value);
            }}
            onKeyDown={onTagKey}
            onBlur={() => addTag(tagDraft)}
            disabled={tags.length >= HASHTAGS_MAX}
            placeholder={tags.length ? '' : 'Type a hashtag and press Enter'}
            className="min-w-[8rem] flex-1 bg-transparent px-1 text-sm focus:outline-none"
          />
        </div>
      </div>

      <div>
        <Button variant="secondary" size="sm" loading={write.isPending} onClick={writeWithAi}>
          <Sparkles className="h-3.5 w-3.5" aria-hidden /> Write with AI
        </Button>
        <span className="ml-2 text-xs text-muted">Free</span>
        {write.isError ? (
          <Notice tone="error" className="mt-2">
            {errorText(write.error, "The text couldn't be written.")}
          </Notice>
        ) : null}
      </div>

      <fieldset>
        <legend className="text-xs font-medium uppercase tracking-wider text-muted">Visibility</legend>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {VISIBILITY.map((v) => (
            <Chip key={v.value} active={visibility === v.value} onClick={() => setVisibility(v.value)}>
              {v.label}
            </Chip>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-muted">YouTube may keep it private until ReelForge is verified by Google.</p>
      </fieldset>

      {mustConfirm ? (
        <Notice>
          You edited the Reel after this render, so this video is the earlier version.{' '}
          <label className="mt-1 flex items-center gap-2">
            <input type="checkbox" checked={confirmOutdated} onChange={(e) => setConfirmOutdated(e.target.checked)} />
            Publish this version anyway
          </label>
          <Link to={`/app/p/${p.id}/render`} className="mt-1 inline-block underline">
            Or render it again
          </Link>
        </Notice>
      ) : null}

      {renderRunning ? (
        <Notice>A new render is running. Publishing opens again when it's done.</Notice>
      ) : null}
      {failed ? (
        <Notice tone="error">
          {failed.error?.message ?? "The last try didn't work."}{' '}
          {sameRender ? 'Press Try again; it continues where it stopped.' : 'This video is a newer render.'}
        </Notice>
      ) : null}
      {problem ? (
        <Notice tone="error">
          {problem.text}
          {problem.postedUrl ? (
            <>
              {' '}
              <a href={problem.postedUrl} target="_blank" rel="noreferrer" className="underline">
                Open it on YouTube
              </a>
            </>
          ) : null}
        </Notice>
      ) : null}
      {save.isError ? <p className="text-xs text-red-300">{errorText(save.error, 'The text isn’t saved.')}</p> : null}

      <Button size="lg" fullWidth disabled={blocked} loading={publish.isPending} onClick={submit}>
        <Youtube className="h-4 w-4" aria-hidden /> {failed && sameRender ? 'Try again' : 'Publish now'}
      </Button>
    </section>
  );
}

function AccountRow({
  projectId,
  user,
  beforeLeave,
}: {
  projectId: string;
  user: User | undefined;
  beforeLeave: () => Promise<unknown>;
}) {
  const connect = useConnect();
  const [leaving, setLeaving] = useState(false);
  const connection = user?.connections?.youtube ?? null;
  useEffect(() => {
    // Back from Google's page: the browser may show this page as it was left.
    const onShow = (e: PageTransitionEvent) => e.persisted && setLeaving(false);
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);
  const [saving, setSaving] = useState(false);
  const go = () => {
    setSaving(true);
    void beforeLeave().finally(() => {
      setSaving(false);
      connect.mutate({platform: 'youtube', returnTo: `/app/p/${projectId}/publish`}, {onSuccess: () => setLeaving(true)});
    });
  };
  const busy = saving || connect.isPending || leaving;

  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-muted">Channel</p>
      {connection && connection.status === 'connected' ? (
        <div className="mt-2 flex items-center gap-2.5 rounded-xl border border-line bg-white/[0.03] px-3 py-2">
          {connection.pictureUrl ? (
            <img src={connection.pictureUrl} alt="" className="h-7 w-7 rounded-full" referrerPolicy="no-referrer" />
          ) : (
            <Youtube className="h-5 w-5 text-red-400" aria-hidden />
          )}
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{connection.name}</span>
          <Button variant="ghost" size="sm" loading={busy} onClick={go}>
            Change
          </Button>
        </div>
      ) : null}
      {connection && connection.status === 'connected' && connect.isError ? (
        <Notice tone="error" className="mt-2">
          {errorText(connect.error, "Connecting YouTube couldn't start.")}
        </Notice>
      ) : null}
      {connection && connection.status === 'connected' ? null : (
        <div className="mt-2 rounded-xl border border-line bg-white/[0.03] p-3">
          {connection?.status === 'reconnect_required' ? (
            <p className="text-sm text-amber-200">Your YouTube connection has expired.</p>
          ) : (
            <p className="text-sm text-muted">
              Connect the YouTube channel to publish to. While ReelForge is in testing with Google, only accounts added
              as testers can connect.
            </p>
          )}
          <Button size="sm" className="mt-2" loading={busy} onClick={go}>
            <Youtube className="h-3.5 w-3.5" aria-hidden />{' '}
            {connection?.status === 'reconnect_required' ? 'Reconnect YouTube' : 'Connect YouTube'}
          </Button>
          {connect.isError ? (
            <Notice tone="error" className="mt-2">
              {errorText(connect.error, "Connecting YouTube couldn't start.")}
            </Notice>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- following it

function Tracker({post}: {post: Post}) {
  const reached = TRACKER.findIndex((s) => s.state === post.state);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []); // the form it replaced is gone (QF7-007)
  return (
    <section className="glass p-5" aria-labelledby="tracker-title">
      <h2 id="tracker-title" ref={heading} tabIndex={-1} className="text-lg font-semibold focus:outline-none">
        Publishing to YouTube
      </h2>
      <p className="sr-only" role="status">
        {TRACKER[Math.max(0, reached)]?.label}
      </p>
      <p className="mt-1 truncate text-sm text-muted">{post.title}</p>
      <ol className="mt-5 space-y-3" aria-label="Publishing steps">
        {TRACKER.map((step, i) => (
          <li
            key={step.state}
            className="flex items-center gap-3 text-sm"
            aria-current={i === reached ? 'step' : undefined}
          >
            <span
              className={cn(
                'grid h-6 w-6 place-items-center rounded-full border text-[11px]',
                i < reached
                  ? 'border-ok bg-ok/20 text-emerald-200'
                  : i === reached
                    ? 'border-violet bg-violet/25'
                    : 'border-line text-muted',
              )}
            >
              {i < reached ? '✓' : i + 1}
            </span>
            <span className={i <= reached ? 'text-white' : 'text-muted'}>{step.label}</span>
          </li>
        ))}
      </ol>
      <div
        className="mt-5 h-2 overflow-hidden rounded-full bg-white/10"
        role="progressbar"
        aria-label="Publishing progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={post.progress}
      >
        <div className="h-full rounded-full bg-brand transition-[width]" style={{width: `${post.progress}%`}} />
      </div>
      <p className="mt-3 text-[13px] text-muted">You can leave this page; publishing carries on.</p>
    </section>
  );
}

function Live({post, onAgain, renderIsNewer}: {post: Post; onAgain: () => void; renderIsNewer: boolean}) {
  const [copied, setCopied] = useState<'' | 'yes' | 'no'>('');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const copy = () => {
    if (!post.url) return;
    const done = navigator.clipboard?.writeText(post.url);
    if (!done) return setCopied('no');
    void done.then(
      () => setCopied('yes'),
      () => setCopied('no'),
    );
  };
  return (
    <section className="glass p-6 text-center" aria-labelledby="live-title">
      <CheckCircle2 className="mx-auto h-10 w-10 text-ok" aria-hidden />
      <h2 id="live-title" ref={heading} tabIndex={-1} className="mt-3 font-display text-2xl font-semibold focus:outline-none">
        Your Short is live
      </h2>
      <p className="mt-1 truncate text-sm text-muted">{post.title}</p>
      {post.privateUntilVerified ? (
        <Notice className="mt-4 text-left">
          YouTube kept it private until ReelForge is verified by Google. You can change its visibility in YouTube
          Studio.
        </Notice>
      ) : null}
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {post.url ? (
          <a
            href={post.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-ink"
          >
            <ExternalLink className="h-4 w-4" aria-hidden /> Open on YouTube
          </a>
        ) : null}
        <Button variant="secondary" onClick={copy} disabled={!post.url}>
          <Copy className="h-4 w-4" aria-hidden /> {copied === 'yes' ? 'Link copied' : copied === 'no' ? 'Copy failed; select the link' : 'Copy link'}
        </Button>
      </div>
      <div className="mt-6 flex flex-wrap justify-center gap-2 border-t border-line pt-5">
        <ButtonLink to="/app/new" variant="secondary" size="sm">
          Create another Reel
        </ButtonLink>
        <ButtonLink to="/app" variant="ghost" size="sm">
          Back to the dashboard
        </ButtonLink>
        {renderIsNewer ? (
          <Button variant="ghost" size="sm" onClick={onAgain}>
            Publish again
          </Button>
        ) : null}
      </div>
    </section>
  );
}
