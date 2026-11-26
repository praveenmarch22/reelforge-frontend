import {Image as ImageIcon, Mic, RefreshCw, Search, Type} from 'lucide-react';
import {useRef, useState, type KeyboardEvent, type ReactNode} from 'react';
import {useRegenerateVisual, useRegenerateVoice, useUpdateScene, type SceneUpdate} from '@/api/projects';
import type {CreditCosts, Mood, Project, Scene, VisualSource} from '@/api/types';
import {Button} from '@/components/ui/Button';
import {Chip} from '@/components/ui/Chip';
import {Notice} from '@/components/ui/Notice';
import {flushAll, useAutosavedField} from '@/features/create/autosave';
import {errorText} from '@/features/create/errors';
import {MOODS, NARRATION_MAX} from '@/features/create/SceneCard';
import {VoicePicker} from '@/features/create/VoicePicker';
import {cn} from '@/lib/cn';
import {StockSearch} from './StockSearch';

export type Tab = 'visual' | 'voice' | 'text';
const BUSY = ['queued', 'running'];
const SOURCES: {value: VisualSource; label: string}[] = [
  {value: 'stock', label: 'Stock'},
  {value: 'ai_image', label: 'AI image'},
  {value: 'ai_video', label: 'AI video'},
  {value: 'upload', label: 'Upload'},
];

const plural = (n: number) => `${n} credit${n === 1 ? '' : 's'}`;
const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/** What redoing this scene's voice costs (C7): short scenes 1, else 2 per started 30 s. */
export function voiceCost(costs: CreditCosts | undefined, narration: string): number | undefined {
  if (!costs) return undefined;
  const seconds = words(narration) / 2.5;
  return seconds <= 15 ? costs.voiceSceneShort : costs.voicePer30s * Math.ceil(seconds / 30);
}

/** What a new visual costs (C8). Until AI video arrives (milestone B7) an AI video scene gets an
 * AI image with motion and costs what an AI image costs, as the API charges. */
export function visualCost(costs: CreditCosts | undefined, source: VisualSource): number | undefined {
  if (!costs) return undefined;
  return source === 'stock' || source === 'upload' ? 0 : costs.aiImage;
}

function Field({label, htmlFor, hint, children}: {label: string; htmlFor: string; hint?: ReactNode; children: ReactNode}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label htmlFor={htmlFor} className="text-xs font-medium uppercase tracking-wider text-muted">
          {label}
        </label>
        {hint ? <span className="text-[11px] text-muted">{hint}</span> : null}
      </div>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function SaveNote({state, error}: {state: string; error: string}) {
  return error ? (
    <p role="alert" className="mt-1 text-xs text-red-300">
      {error}
    </p>
  ) : (
    <p className="mt-1 h-4 text-[11px] text-muted" role="status" aria-live="polite">
      {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : ''}
    </p>
  );
}

const area = 'w-full resize-y rounded-lg border border-line bg-white/[0.04] p-2.5 text-[13px] leading-relaxed focus:border-violet focus:outline-none disabled:opacity-50';

/** The right column of screen 11 for the selected scene: Visual, Voice and Text tabs. */
export function Inspector({
  project,
  scene,
  index,
  costs,
  tab,
  onTab,
}: {
  project: Project;
  scene: Scene;
  index: number;
  costs?: CreditCosts;
  tab: Tab;
  onTab: (tab: Tab) => void;
}) {
  const setTab = onTab;
  const [stockOpen, setStockOpen] = useState(false);
  // Busy from the first click, before unsaved text is sent (BUG-058).
  const [starting, setStarting] = useState<'voice' | 'visual' | null>(null);
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({visual: null, voice: null, text: null});
  const [voiceId, setVoiceId] = useState('');
  const [actionError, setActionError] = useState('');
  const update = useUpdateScene(project.id);
  const voice = useRegenerateVoice(project.id);
  const visual = useRegenerateVisual(project.id);
  const save = (body: SceneUpdate) => update.mutateAsync({sceneId: scene.id, body});
  const describe = (e: unknown) => errorText(e, 'Not saved. Check your connection.');

  const narration = useAutosavedField(scene.narration, (v) => save({narration: v}), describe);
  const prompt = useAutosavedField(scene.visualPrompt, (v) => save({visualPrompt: v}), describe);
  const stockQuery = useAutosavedField(scene.stockQuery, (v) => save({stockQuery: v}), describe);
  const onScreen = useAutosavedField(scene.onScreenText, (v) => save({onScreenText: v}), describe);

  const voiceBusy = BUSY.includes(scene.voiceStatus);
  const visualBusy = BUSY.includes(scene.visualStatus);
  const vCost = voiceCost(costs, narration.value);
  const iCost = visualCost(costs, scene.visualSource);

  const run = (promise: Promise<unknown>, fallback: string) =>
    promise.then(
      () => setActionError(''),
      (e: unknown) => setActionError(errorText(e, fallback)),
    );

  const setSource = (source: VisualSource) => {
    if (source === scene.visualSource || source === 'upload') return;
    void run(save({visualSource: source}), 'The source wasn’t changed.');
  };

  const regenerateVoice = () => {
    let confirm = false;
    if (scene.wordsEdited) {
      // CA-4: hand-fixed caption words are replaced by the new voice's words.
      if (!window.confirm('You fixed caption words in this scene by hand. A new voice replaces them. Continue?')) return;
      confirm = true;
    }
    if (starting) return;
    setStarting('voice');
    void run(
      flushAll().then(() => voice.mutateAsync({sceneId: scene.id, voiceId: voiceId || undefined, confirmReplaceWords: confirm})),
      'The voice didn’t start.',
    ).finally(() => setStarting(null));
  };

  const regenerateVisual = () => {
    if (starting) return;
    setStarting('visual');
    void run(flushAll().then(() => visual.mutateAsync({sceneId: scene.id, body: {}})), 'The visual didn’t start.').finally(() =>
      setStarting(null),
    );
  };

  // The WAI-ARIA tabs pattern: one Tab stop, arrow keys (and Home, End) move between tabs.
  const onTabKey = (e: KeyboardEvent) => {
    const order: Tab[] = ['visual', 'voice', 'text'];
    const at = order.indexOf(tab);
    const next =
      e.key === 'ArrowRight' ? order[(at + 1) % 3] : e.key === 'ArrowLeft' ? order[(at + 2) % 3] : e.key === 'Home' ? order[0] : e.key === 'End' ? order[2] : null;
    if (!next) return;
    e.preventDefault();
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  const tabs: {value: Tab; label: string; Icon: typeof Mic}[] = [
    {value: 'visual', label: 'Visual', Icon: ImageIcon},
    {value: 'voice', label: 'Voice', Icon: Mic},
    {value: 'text', label: 'Text', Icon: Type},
  ];

  return (
    <section className="glass p-4" aria-label={`Scene ${index + 1} settings`}>
      <header className="flex items-center justify-between">
        <h2 className="font-semibold">Scene {String(index + 1).padStart(2, '0')}</h2>
        <span className="text-[11px] capitalize text-muted">
          {scene.mood} · {scene.estimatedSeconds}s est.
        </span>
      </header>
      <div className="mt-3 grid grid-cols-3 gap-1 rounded-xl bg-white/[0.04] p-1" role="tablist" aria-label="Scene settings" onKeyDown={onTabKey}>
        {tabs.map(({value, label, Icon}) => (
          <button
            key={value}
            ref={(el) => (tabRefs.current[value] = el)}
            type="button"
            role="tab"
            id={`tab-${value}`}
            aria-selected={tab === value}
            aria-controls={`panel-${value}`}
            tabIndex={tab === value ? 0 : -1}
            onClick={() => setTab(value)}
            className={cn(
              'flex h-8 items-center justify-center gap-1.5 rounded-lg text-[13px] transition',
              tab === value ? 'bg-violet/30 text-white' : 'text-muted hover:text-white',
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
          </button>
        ))}
      </div>

      {/* Every tab stays mounted (only the open one is shown), so unsaved or failed edits on a
          hidden tab keep being saved and retried (BUG-066). */}
      <div className="mt-4 space-y-4" role="tabpanel" id="panel-visual" aria-labelledby="tab-visual" hidden={tab !== 'visual'}>
        {(
          <>
            <fieldset>
              <legend className="text-xs font-medium uppercase tracking-wider text-muted">Visual source</legend>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {SOURCES.map((s) => (
                  <Chip
                    key={s.value}
                    active={scene.visualSource === s.value}
                    disabled={s.value === 'upload' || visualBusy}
                    onClick={() => setSource(s.value)}
                  >
                    {s.label}
                  </Chip>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-muted">
                {scene.visualSource === 'ai_video'
                  ? 'An AI image with slow motion, until AI video clips arrive.'
                  : 'Uploading your own file comes later.'}
              </p>
            </fieldset>
            {scene.visual ? (
              <p className="text-[11px] text-muted">
                {scene.visual.kind === 'video' ? 'Clip' : 'Image'}
                {scene.visual.author ? (
                  <>
                    {' by '}
                    {scene.visual.sourceUrl ? (
                      <a href={scene.visual.sourceUrl} target="_blank" rel="noreferrer" className="underline hover:text-white">
                        {scene.visual.author}
                      </a>
                    ) : (
                      scene.visual.author
                    )}
                  </>
                ) : null}
                {scene.visual.stockFallback ? ' · an AI image, because no stock clip fitted' : ''}
              </p>
            ) : null}
            <Field label="Visual prompt" htmlFor="visual-prompt">
              <textarea
                id="visual-prompt"
                rows={3}
                maxLength={1000}
                value={prompt.value}
                disabled={visualBusy}
                onChange={(e) => prompt.change(e.target.value)}
                onBlur={prompt.flush}
                className={area}
              />
              <SaveNote state={prompt.state} error={prompt.error} />
            </Field>
            {scene.visualSource === 'stock' ? (
              <Field label="Stock search words" htmlFor="stock-query">
                <input
                  id="stock-query"
                  maxLength={100}
                  value={stockQuery.value}
                  disabled={visualBusy}
                  onChange={(e) => stockQuery.change(e.target.value)}
                  onBlur={stockQuery.flush}
                  className={cn(area, 'h-9 py-0')}
                />
                <SaveNote state={stockQuery.state} error={stockQuery.error} />
              </Field>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={regenerateVisual} loading={starting === 'visual' || visual.isPending || visualBusy} disabled={scene.visualSource === 'upload'}>
                <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Regenerate visual
                {iCost !== undefined ? ` · ${iCost ? plural(iCost) : 'free'}` : ''}
              </Button>
              {scene.visualSource === 'stock' ? (
                <Button size="sm" variant="secondary" aria-expanded={stockOpen} onClick={() => setStockOpen((v) => !v)}>
                  <Search className="h-3.5 w-3.5" aria-hidden /> Search stock
                </Button>
              ) : null}
            </div>
            {stockOpen ? <StockSearch scene={scene} projectId={project.id} onClose={() => setStockOpen(false)} /> : null}
          </>
        )}
      </div>
      <div className="mt-4 space-y-4" role="tabpanel" id="panel-voice" aria-labelledby="tab-voice" hidden={tab !== 'voice'}>
        {(
          <>
            <Field label="Narration" htmlFor="narration" hint={`${words(narration.value)} words`}>
              <textarea
                id="narration"
                rows={4}
                maxLength={NARRATION_MAX}
                value={narration.value}
                disabled={voiceBusy}
                onChange={(e) => narration.change(e.target.value)}
                onBlur={narration.flush}
                className={area}
              />
              <SaveNote state={narration.state} error={narration.error} />
            </Field>
            <Field label="Delivery mood" htmlFor="mood">
              <select
                id="mood"
                value={scene.mood}
                disabled={voiceBusy}
                onChange={(e) => void run(save({mood: e.target.value as Mood}), 'The mood wasn’t changed.')}
                className="h-9 w-full rounded-lg border border-line bg-white/[0.04] px-2.5 text-[13px] capitalize focus:outline-none [&>option]:bg-ink-700"
              >
                {MOODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
            <VoicePicker label="Voice for this take" value={voiceId || scene.voice?.voiceId || project.voiceId} onChange={setVoiceId} disabled={voiceBusy} />
            {scene.voice ? (
              <p className="text-[11px] text-muted">
                Made with {scene.voice.provider === 'edge' ? 'a free backup voice' : 'ElevenLabs'}
                {scene.voice.durationSeconds ? ` · ${scene.voice.durationSeconds.toFixed(1)}s` : ''}
                {scene.voice.estimatedTimings ? ' · captions only roughly in sync' : ''}
              </p>
            ) : null}
            <Button size="sm" onClick={regenerateVoice} loading={starting === 'voice' || voice.isPending || voiceBusy}>
              <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Regenerate voice{vCost !== undefined ? ` · ${plural(vCost)}` : ''}
            </Button>
          </>
        )}
      </div>
      <div className="mt-4 space-y-4" role="tabpanel" id="panel-text" aria-labelledby="tab-text" hidden={tab !== 'text'}>
        {(
          <>
            <Field label="On-screen text" htmlFor="on-screen" hint={`${onScreen.value.length}/80`}>
              <input
                id="on-screen"
                maxLength={80}
                value={onScreen.value}
                onChange={(e) => onScreen.change(e.target.value)}
                onBlur={onScreen.flush}
                className={cn(area, 'h-9 py-0')}
              />
              <SaveNote state={onScreen.state} error={onScreen.error} />
            </Field>
            <CaptionWords scene={scene} disabled={voiceBusy} save={save} />
          </>
        )}
      </div>
      <div className="mt-4 space-y-4">
        {scene.lastError ? <Notice tone="error">{scene.lastError}</Notice> : null}
        {actionError ? <Notice tone="error">{actionError}</Notice> : null}
      </div>
    </section>
  );
}

/** Fix the spelling of caption words; their timings are kept (C2 `words`, CA-4). Saved as typed,
 * like every other field, so a fix is never lost by switching tab or scene (QF6-002). */
function CaptionWords({scene, disabled, save}: {scene: Scene; disabled: boolean; save: (body: SceneUpdate) => Promise<unknown>}) {
  const joined = scene.words.map((w) => w.text).join(' ');
  const field = useAutosavedField(
    joined,
    (value) => save({words: value.split(' ').map((text) => ({text}))}),
    (e) => errorText(e, 'Not saved. Check your connection.'),
  );
  if (!scene.words.length) {
    return <p className="text-[12px] text-muted">Caption words appear here once the voice is made.</p>;
  }
  const draft = field.value.split(' ');
  const setWord = (i: number, text: string) => {
    // Spaces would split a word in two, so they are left out. An emptied word is refused by the
    // API with its own message, shown under the words.
    field.change(draft.map((w, j) => (j === i ? text.replace(/\s/g, '') : w)).join(' '));
  };
  return (
    <fieldset>
      <legend className="text-xs font-medium uppercase tracking-wider text-muted">Caption words</legend>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {draft.map((text, i) => (
          <input
            key={i}
            aria-label={`Caption word ${i + 1}`}
            value={text}
            maxLength={100}
            disabled={disabled}
            size={Math.max(2, text.length)}
            onChange={(e) => setWord(i, e.target.value)}
            onBlur={field.flush}
            className="h-7 rounded-md border border-line bg-white/[0.04] px-1.5 text-[12px] focus:border-violet focus:outline-none disabled:opacity-50"
          />
        ))}
      </div>
      <SaveNote state={field.state} error={field.error} />
      {scene.wordsEdited ? <p className="text-[11px] text-muted">Fixed by hand: a new voice would replace them.</p> : null}
    </fieldset>
  );
}
