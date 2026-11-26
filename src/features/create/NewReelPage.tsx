import {ArrowRight, Lightbulb, Loader2, Sparkles} from 'lucide-react';
import {useEffect, useRef, useState, type FormEvent} from 'react';
import {useNavigate, useSearchParams} from 'react-router-dom';
import {ApiError} from '@/api/client';
import {useMe} from '@/api/hooks';
import {useCreateProject, useCredits, useIdeas, useLeaveSignal} from '@/api/projects';
import type {Idea, Mode, Tone} from '@/api/types';
import {TopBar} from '@/components/layout/AppShell';
import {Button} from '@/components/ui/Button';
import {Chip} from '@/components/ui/Chip';
import {Notice} from '@/components/ui/Notice';
import {cn} from '@/lib/cn';
import {errorText} from './errors';
import {StepHeader} from './StepHeader';
import {VoicePicker} from './VoicePicker';

const TOPIC_MAX = 300;
const NICHE_MAX = 120;
const KEYWORDS_MAX = 200;
const SCRIPT_MAX = 5000;
const LENGTHS = [15, 30, 60, 90] as const;
const TONES: {value: Tone; label: string}[] = [
  {value: 'educational', label: 'Educational'},
  {value: 'funny', label: 'Funny'},
  {value: 'motivational', label: 'Motivational'},
  {value: 'storytelling', label: 'Storytelling'},
  {value: 'dramatic', label: 'Dramatic'},
];

const lengthFrom = (value: string | null) =>
  LENGTHS.find((s) => String(s) === value) ?? 30;
const modeFrom = (value: string | null): Mode | null =>
  value === 'faceless' || value === 'full_ai' ? value : null; // anything else is ignored (BUG-048)

// Field names the API can return, as the creator knows them (QF5-005).
const FIELD_LABELS: Record<string, string> = {
  topic: 'Topic',
  script: 'Script',
  tone: 'Tone',
  mode: 'Visual style',
  targetSeconds: 'Target length',
  voiceId: 'Narrator',
};

type IdeasState = {status: 'idle' | 'loading' | 'done' | 'error'; items: Idea[]; error: string};

/** Screen 9 (docs/SCREENS_F5_F6.md): the idea step. Creates the project (B3) and opens its script. */
export function NewReelPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const {data: user} = useMe();
  const credits = useCredits();
  const ideasRequest = useIdeas();
  const leaveSignal = useLeaveSignal();
  const create = useCreateProject();

  const [pasting, setPasting] = useState(false);
  const [topic, setTopic] = useState(params.get('topic') ?? '');
  const [script, setScript] = useState('');
  const [tone, setTone] = useState<Tone>('educational');
  const [seconds, setSeconds] = useState<number>(lengthFrom(params.get('length')));
  const [mode, setMode] = useState<Mode>(modeFrom(params.get('mode')) ?? user?.defaults.mode ?? 'faceless');
  // Kept in this screen's own state, not the request's: a request started while the screen
  // mounts must still show its ideas when React mounts the screen twice in development (BUG-046).
  const [ideas, setIdeas] = useState<IdeasState>({status: 'idle', items: [], error: ''});
  const [voiceId, setVoiceId] = useState(user?.defaults.voiceId ?? '');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const askedForIdeas = useRef(false);
  const latestIdeasRequest = useRef(0);

  const askForIdeas = (stopOnLeave = true) => {
    // Within the ideas endpoint's limits (QF5-012).
    const niche = (user?.niche || topic.trim() || 'everyday life').slice(0, NICHE_MAX);
    const keywords = user?.niche ? topic.trim().slice(0, KEYWORDS_MAX) || undefined : undefined;
    // Only the latest request's answer is shown; an older one that is still finishing (or was
    // stopped) never overwrites it.
    const request = ++latestIdeasRequest.current;
    setIdeas({status: 'loading', items: [], error: ''});
    ideasRequest
      .mutateAsync({niche, keywords, count: 5, signal: stopOnLeave ? leaveSignal() : undefined})
      .then((items) => request === latestIdeasRequest.current && setIdeas({status: 'done', items, error: ''}))
      .catch(
        (e: unknown) =>
          request === latestIdeasRequest.current &&
          setIdeas({status: 'error', items: [], error: errorText(e, "We couldn't get ideas.")}),
      );
  };

  // Arriving from the dashboard's "Ideas" button asks straight away.
  useEffect(() => {
    if (params.get('ideas') === '1' && user && !askedForIdeas.current) {
      askedForIdeas.current = true;
      // Not tied to leaving: React's double mount in development would stop it (BUG-046).
      askForIdeas(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const pickIdea = (idea: Idea) => {
    setPasting(false);
    setTopic(idea.title.slice(0, TOPIC_MAX));
    setFieldErrors({});
  };

  const text = pasting ? script : topic;
  const limit = pasting ? SCRIPT_MAX : TOPIC_MAX;
  const cost = credits.data?.costs.script;
  const balance = credits.data?.balance ?? user?.credits.balance;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) {
      setFieldErrors({[pasting ? 'script' : 'topic']: pasting ? 'Paste your script' : 'Write what your Reel is about'});
      return;
    }
    setFieldErrors({});
    create.mutate(
      {
        ...(pasting ? {script: script.trim()} : {topic: topic.trim()}),
        tone,
        mode,
        targetSeconds: seconds,
        ...(voiceId ? {voiceId} : {}),
      },
      {
        onSuccess: ({project}) => navigate(`/app/p/${project.id}/script`),
        onError: (error) => {
          if (error instanceof ApiError && error.code === 'validation_error') setFieldErrors(error.fields);
        },
      },
    );
  };

  const error = create.error instanceof ApiError ? create.error : null;
  const otherFieldErrors = Object.entries(fieldErrors).filter(([field]) => field !== 'topic' && field !== 'script');

  return (
    <form onSubmit={onSubmit} className="mx-auto max-w-4xl pb-10" noValidate>
      <TopBar />
      <StepHeader current={0} />
      <h1 className="mt-6 text-center font-display text-3xl font-semibold">Craft your next Reel</h1>
      <p className="mt-2 text-center text-sm text-muted">
        Write what it's about, pick an idea, or paste a script you already have.
      </p>

      <section className="glass ring-brand mt-6 rounded-2xl p-4" aria-label="What your Reel is about">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="secondary" size="sm" onClick={() => askForIdeas()} loading={ideas.status === 'loading'} disabled={pasting}>
            {ideas.status !== 'loading' ? <Sparkles className="h-4 w-4 text-violet-soft" aria-hidden /> : null} Get ideas
          </Button>
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-muted">
            <input
              type="checkbox"
              checked={pasting}
              onChange={(e) => {
                setPasting(e.target.checked);
                setFieldErrors({});
              }}
              className="accent-violet"
            />
            Paste my own script
          </label>
        </div>
        <label htmlFor="reel-text" className="sr-only">
          {pasting ? 'Your script' : 'What is your Reel about?'}
        </label>
        <textarea
          id="reel-text"
          value={text}
          maxLength={limit}
          rows={pasting ? 8 : 3}
          aria-invalid={!!fieldErrors.topic || !!fieldErrors.script || undefined}
          aria-describedby="reel-text-count reel-text-error"
          // A topic is one line: line breaks become spaces, as the API wants (QF5-014).
          onChange={(e) => (pasting ? setScript(e.target.value) : setTopic(e.target.value.replace(/[\r\n]+/g, ' ')))}
          placeholder={
            pasting
              ? 'Paste your script. Each paragraph becomes at least one scene; your words are kept exactly.'
              : "What's your next Reel about? For example: 5 money habits nobody teaches you"
          }
          className="mt-3 w-full resize-y bg-transparent text-base text-white placeholder:text-white/40 focus:outline-none"
        />
        <div className="flex items-center justify-between text-xs text-muted">
          <span id="reel-text-error" className="text-red-300">
            {fieldErrors.topic || fieldErrors.script || ''}
          </span>
          <span id="reel-text-count" className="tabular-nums">
            {text.length} / {limit}
          </span>
        </div>
      </section>

      {ideas.status === 'error' ? (
        <Notice tone="error" className="mt-4">
          {ideas.error}{' '}
          <button type="button" className="font-semibold text-white underline" onClick={() => askForIdeas()}>
            Try again
          </button>
        </Notice>
      ) : null}

      {ideas.status === 'loading' || ideas.status === 'done' ? (
        <section className="mt-6" aria-label="Ideas">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Lightbulb className="h-4 w-4 text-cyan" aria-hidden /> Ideas for you
          </h2>
          {ideas.status === 'loading' ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-muted" role="status">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Thinking of ideas…
            </p>
          ) : (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {ideas.items.map((idea) => (
                <article key={idea.title} className="glass flex flex-col p-4">
                  <h3 className="font-semibold leading-snug">{idea.title}</h3>
                  <p className="mt-1.5 text-[13px] text-white/85">“{idea.hook}”</p>
                  {idea.angle ? <p className="mt-1.5 flex-1 text-xs text-muted">{idea.angle}</p> : <span className="flex-1" />}
                  <Button variant="secondary" size="sm" className="mt-3" onClick={() => pickIdea(idea)}>
                    Use this <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}

      <section className="glass mt-6 grid grid-cols-1 gap-6 p-5 md:grid-cols-3" aria-label="Settings">
        <fieldset>
          <legend className="text-xs font-medium uppercase tracking-wider text-muted">Tone</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {TONES.map((t) => (
              <Chip key={t.value} active={tone === t.value} onClick={() => setTone(t.value)}>
                {t.label}
              </Chip>
            ))}
          </div>
        </fieldset>
        <div className="space-y-5">
          <fieldset>
            <legend className="text-xs font-medium uppercase tracking-wider text-muted">Target length</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {LENGTHS.map((s) => (
                <Chip key={s} active={seconds === s} onClick={() => setSeconds(s)}>
                  {s}s
                </Chip>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="text-xs font-medium uppercase tracking-wider text-muted">Visual style</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              <Chip active={mode === 'faceless'} onClick={() => setMode('faceless')}>
                Faceless
              </Chip>
              <Chip active={mode === 'full_ai'} onClick={() => setMode('full_ai')}>
                Full AI
              </Chip>
            </div>
            {mode === 'full_ai' ? (
              <p className="mt-2 text-xs text-muted">AI images with slow motion, until AI video clips arrive.</p>
            ) : null}
          </fieldset>
        </div>
        <VoicePicker value={voiceId || user?.defaults.voiceId || ""} onChange={setVoiceId} />
      </section>

      {error && error.code !== 'validation_error' ? (
        <Notice tone="error" className="mt-4">
          {errorText(error, 'The script couldn’t be started.')}
        </Notice>
      ) : null}
      {otherFieldErrors.length ? (
        <Notice tone="error" className="mt-4">
          {otherFieldErrors.map(([field, message]) => (
            <span key={field} className="block">
              {FIELD_LABELS[field] ?? field}: {message}
            </span>
          ))}
        </Notice>
      ) : null}

      <footer className="mt-6 flex flex-wrap items-center justify-end gap-4">
        <p className={cn('text-right text-xs text-muted', cost === undefined && 'invisible')}>
          <span className="font-semibold text-white">
            {cost} credit{cost === 1 ? '' : 's'}
          </span>{' '}
          to write the script
          <br />
          {balance ?? '…'} remaining
        </p>
        <Button type="submit" size="lg" loading={create.isPending}>
          Write script <ArrowRight className="h-4 w-4" aria-hidden />
        </Button>
      </footer>
    </form>
  );
}
