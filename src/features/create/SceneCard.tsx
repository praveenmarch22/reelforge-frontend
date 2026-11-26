import {ArrowDown, ArrowUp, Copy, GripVertical, Loader2, MoreHorizontal, Trash2, Wand2} from 'lucide-react';
import {useEffect, useRef, useState, type DragEvent, type ReactNode} from 'react';
import type {Mood, Scene} from '@/api/types';
import {Button} from '@/components/ui/Button';
import {cn} from '@/lib/cn';
import {markUnsaved, registerFlusher} from './autosave';

export const MOODS: Mood[] = [
  'calm', 'joyful', 'excited', 'funny', 'inspiring', 'triumphant', 'serious', 'tense', 'mysterious', 'sad',
];
export const NARRATION_MAX = 1500;
const ON_SCREEN_MAX = 80;
const INSTRUCTIONS_MAX = 200;
const LONG_SCENE = 15;
const SHORT_SCENE = 2;
const SAVE_AFTER_MS = 800;
// A failed save shows its own error on the card; callers that only start a save ignore it.
const ignore = () => undefined;

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
const seconds = (text: string) => Math.round((words(text) / 2.5) * 10) / 10;
export const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

type SceneFields = {narration?: string; onScreenText?: string; mood?: Mood};

type Props = {
  scene: Scene;
  index: number;
  count: number;
  startsAt: number;
  locked: boolean;
  rewriteCost?: number;
  onSave: (body: SceneFields) => Promise<unknown>;
  onRewrite: (instructions: string) => Promise<unknown>;
  onDuplicate: () => void;
  onDelete: () => void;
  onMove: (to: number) => void;
  errorText: (error: unknown, fallback: string) => string;
  dragProps: {draggable: boolean; onDragStart: (e: DragEvent) => void; onDragEnd: () => void};
  children?: ReactNode;
};

/**
 * Saves a scene's text as it is typed (C2). Edits are sent one after another, never in
 * parallel, and the server's text only replaces what is in the box when nothing newer is
 * waiting, so a slow answer can never undo later typing (QF5-001). Unsaved text is sent when
 * the card goes away, not dropped (QF5-002).
 */
function useSceneAutosave(scene: Scene, onSave: Props['onSave'], errorText: Props['errorText']) {
  const [narration, setNarration] = useState(scene.narration);
  const [onScreen, setOnScreen] = useState(scene.onScreenText);
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState('');
  const pending = useRef<SceneFields | null>(null);
  const edits = useRef(0); // edits made, including unsent ones
  const settled = useRef(0); // edits whose save has been answered
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const lastError = useRef('');
  const save = useRef(onSave);
  save.current = onSave;

  const dirty = () => edits.current !== settled.current;

  /**
   * Sends the unsaved fields. Resolves once everything typed so far has been saved, and rejects
   * if a save failed: the failed text stays unsaved (it is sent again on the next flush, the
   * page still warns before closing, and Generate doesn't start: QF5-017, BUG-053).
   */
  const flush = (): Promise<void> => {
    clearTimeout(timer.current);
    const body = pending.current;
    if (body) {
      pending.current = null;
      const upTo = edits.current;
      setState('saving');
      chain.current = chain.current.then(async () => {
        try {
          await save.current(body);
          lastError.current = '';
          setError('');
          const wasDirty = dirty();
          settled.current = Math.max(settled.current, upTo);
          if (wasDirty && !dirty()) markUnsaved(-1);
          setState(dirty() ? 'saving' : 'saved');
        } catch (e) {
          // Keep it for the next try; anything typed since is newer and wins.
          pending.current = {...body, ...pending.current};
          lastError.current = errorText(e, 'Not saved. Check your connection.');
          setError(lastError.current);
          setState('idle');
        }
      });
    }
    return chain.current.then(() => {
      // The scene's own reason (a refused text, or the connection), not a guess (QF5-022).
      if (dirty()) throw new Error(`Some changes aren’t saved yet: ${lastError.current || 'still saving'}`);
    });
  };

  const change = (fields: SceneFields, now = false) => {
    if (!dirty()) markUnsaved(1);
    edits.current += 1;
    pending.current = {...pending.current, ...fields};
    clearTimeout(timer.current);
    if (now) flush().catch(ignore);
    else timer.current = setTimeout(() => flush().catch(ignore), SAVE_AFTER_MS);
  };

  // The server's text wins only when the creator has nothing newer on its way.
  useEffect(() => {
    if (!dirty()) {
      setNarration(scene.narration);
      setOnScreen(scene.onScreenText);
    }
  }, [scene.narration, scene.onScreenText]);

  // Leaving the page or deleting the scene sends what is still unsaved.
  useEffect(() => {
    const unregister = registerFlusher(flush);
    return () => {
      unregister();
      // A card that is gone can't try again: once its last save ends, it stops counting as
      // unsaved, so the leave warning doesn't stay on for the rest of the visit.
      flush()
        .catch(ignore)
        .finally(() => dirty() && markUnsaved(-1));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (state !== 'saved') return;
    const t = setTimeout(() => setState('idle'), 1500);
    return () => clearTimeout(t);
  }, [state]);

  return {narration, setNarration, onScreen, setOnScreen, state, error, setError, change, flush};
}

/** One scene of the script storyboard (screen 10). */
export function SceneCard({
  scene, index, count, startsAt, locked, rewriteCost, onSave, onRewrite, onDuplicate, onDelete, onMove,
  errorText, dragProps, children,
}: Props) {
  const auto = useSceneAutosave(scene, onSave, errorText);
  const [menuOpen, setMenuOpen] = useState(false);
  const [rewriting, setRewriting] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [rewriteBusy, setRewriteBusy] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);

  const menuItems = [
    {label: 'Move up', Icon: ArrowUp, run: () => onMove(index - 1), off: index === 0},
    {label: 'Move down', Icon: ArrowDown, run: () => onMove(index + 1), off: index === count - 1},
    {label: 'Duplicate', Icon: Copy, run: onDuplicate, off: false},
    {label: 'Delete', Icon: Trash2, run: onDelete, off: count <= 1},
  ];
  // Focus starts on the first item that can be used (with one scene, that is Duplicate: BUG-056).
  const firstEnabled = menuItems.findIndex((item) => !item.off);

  const closeMenu = () => {
    setMenuOpen(false);
    menuButton.current?.focus();
  };

  const rewrite = async () => {
    setRewriteBusy(true);
    auto.setError('');
    try {
      await auto.flush(); // the AI rewrites the text that is on screen
      await onRewrite(instructions.trim() || 'Make it punchier');
      setRewriting(false);
      setInstructions('');
    } catch (e) {
      auto.setError(errorText(e, 'The rewrite didn’t work.'));
    } finally {
      setRewriteBusy(false);
    }
  };

  const length = seconds(auto.narration);
  const empty = !auto.narration.trim();
  const credits = rewriteCost === undefined ? '' : ` · ${rewriteCost} credit${rewriteCost === 1 ? '' : 's'}`;

  return (
    <article className={cn('glass relative p-4', locked && 'opacity-60')} aria-label={`Scene ${index + 1}`} data-scene-id={scene.id}>
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span {...dragProps} className="cursor-grab text-muted hover:text-white active:cursor-grabbing" title="Drag to reorder" aria-hidden>
          <GripVertical className="h-4 w-4" />
        </span>
        <h3 className="text-sm font-semibold">Scene {String(index + 1).padStart(2, '0')}</h3>
        <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] tabular-nums text-muted">
          {clock(startsAt)}–{clock(startsAt + length)}
        </span>
        <span className="ml-auto text-[11px] text-muted" role="status" aria-live="polite">
          {auto.state === 'saving' ? 'Saving…' : auto.state === 'saved' ? 'Saved' : ''}
        </span>
        <div className="flex items-center">
          <Button variant="ghost" size="sm" disabled={locked || rewriteBusy} aria-expanded={rewriting} onClick={() => setRewriting((v) => !v)}>
            <Wand2 className="h-3.5 w-3.5" aria-hidden /> Rewrite
          </Button>
          <div className="relative">
            <Button
              ref={menuButton}
              variant="ghost"
              size="sm"
              aria-label={`More actions for scene ${index + 1}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              disabled={locked}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden />
            </Button>
            {menuOpen ? (
              <div
                role="menu"
                aria-label={`Scene ${index + 1} actions`}
                className="absolute right-0 z-20 mt-1 w-44 rounded-xl border border-line bg-ink-700 p-1 shadow-xl"
                onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), closeMenu())}
                onBlur={(e) => {
                  // Focus moving to the menu's own button is that button's click, which closes it (BUG-055).
                  const to = e.relatedTarget as Node | null;
                  if (!e.currentTarget.contains(to) && to !== menuButton.current) setMenuOpen(false);
                }}
              >
                {menuItems.map(({label, Icon, run, off}, i) => (
                  <button
                    key={label}
                    type="button"
                    role="menuitem"
                    disabled={off}
                    autoFocus={i === firstEnabled}
                    onClick={() => {
                      closeMenu();
                      run();
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-white/10 focus:bg-white/10 focus:outline-none disabled:opacity-40"
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <label htmlFor={`narration-${scene.id}`} className="sr-only">
        Scene {index + 1} narration
      </label>
      <textarea
        id={`narration-${scene.id}`}
        value={auto.narration}
        maxLength={NARRATION_MAX}
        rows={2}
        disabled={locked}
        onChange={(e) => {
          auto.setNarration(e.target.value);
          if (e.target.value.trim()) auto.change({narration: e.target.value});
        }}
        onBlur={() => (auto.narration.trim() ? auto.flush().catch(ignore) : auto.setNarration(scene.narration))}
        className="mt-3 w-full resize-y rounded-lg bg-transparent text-[15px] leading-relaxed text-white focus:bg-white/[0.04] focus:outline-none"
      />

      {rewriting ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-violet/40 bg-violet/10 p-2">
          <label htmlFor={`instr-${scene.id}`} className="sr-only">
            How should scene {index + 1} change?
          </label>
          <input
            id={`instr-${scene.id}`}
            value={instructions}
            maxLength={INSTRUCTIONS_MAX}
            placeholder="How should it change? For example: make it punchier"
            onChange={(e) => setInstructions(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void rewrite())}
            className="min-w-0 flex-1 basis-48 bg-transparent px-1 text-[13px] focus:outline-none"
          />
          <Button size="sm" onClick={() => void rewrite()} loading={rewriteBusy}>
            Rewrite{credits}
          </Button>
        </div>
      ) : null}

      <footer className="mt-3 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`mood-${scene.id}`}>
          Scene {index + 1} mood
        </label>
        <select
          id={`mood-${scene.id}`}
          value={scene.mood}
          disabled={locked}
          onChange={(e) => auto.change({mood: e.target.value as Mood}, true)}
          className="h-7 rounded-full border border-line bg-white/[0.04] px-2.5 text-[12px] capitalize text-white focus:outline-none [&>option]:bg-ink-700"
        >
          {MOODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor={`onscreen-${scene.id}`}>
          Scene {index + 1} on-screen text
        </label>
        <input
          id={`onscreen-${scene.id}`}
          value={auto.onScreen}
          maxLength={ON_SCREEN_MAX}
          disabled={locked}
          placeholder="On-screen text"
          onChange={(e) => {
            auto.setOnScreen(e.target.value);
            auto.change({onScreenText: e.target.value});
          }}
          onBlur={() => auto.flush().catch(ignore)}
          className="h-7 min-w-0 flex-1 basis-40 rounded-full border border-cyan/30 bg-cyan/10 px-3 text-[12px] text-cyan placeholder:text-cyan/50 focus:outline-none"
        />
        <span className="ml-auto text-[11px] tabular-nums text-muted">
          {words(auto.narration)} words · {length}s est.
        </span>
      </footer>

      {length > LONG_SCENE ? (
        <p className="mt-2 text-xs text-amber-300">Over 15 seconds: viewers may scroll on. Consider splitting it.</p>
      ) : null}
      {!empty && length < SHORT_SCENE ? (
        <p className="mt-2 text-xs text-amber-300">Under 2 seconds: it may flash by too fast to follow.</p>
      ) : null}
      {empty ? <p className="mt-2 text-xs text-amber-300">A scene needs some narration.</p> : null}
      {auto.error ? (
        <p role="alert" className="mt-2 text-xs text-red-300">
          {auto.error}
        </p>
      ) : null}
      {rewriteBusy ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted" role="status">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Rewriting…
        </p>
      ) : null}
      {children}
    </article>
  );
}

