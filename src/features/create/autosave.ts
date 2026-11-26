// Autosave bookkeeping shared by the editors (QF5-001, QF5-002).
//
// Each field that saves as you type registers a "flush" that sends its unsaved text now. Actions
// that depend on the saved text (Generate, rewrites) wait for every flush first, and closing the
// tab warns while anything is still unsaved.

import {useEffect, useRef, useState} from 'react';

type Flusher = () => Promise<unknown>;

const flushers = new Set<Flusher>();
let unsaved = 0;

export function registerFlusher(flush: Flusher): () => void {
  flushers.add(flush);
  return () => {
    flushers.delete(flush);
  };
}

/** Sends every unsaved edit and waits for all of them. Rejects if any couldn't be saved, so
 * the action that asked (Generate, a rewrite) doesn't go ahead with the old text. */
export async function flushAll(): Promise<void> {
  const results = await Promise.allSettled([...flushers].map((flush) => flush()));
  const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failed) throw failed.reason;
}

export function markUnsaved(delta: 1 | -1): void {
  unsaved = Math.max(0, unsaved + delta);
}

export const hasUnsaved = () => unsaved > 0;

/** Warns before the tab is closed or reloaded while an edit hasn't reached the server. */
export function useWarnBeforeLeaving(): void {
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!hasUnsaved()) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);
}

/**
 * One text field saved as it is typed, with the same guarantees as the script editor's scenes:
 * saves go one at a time and in order, the server's value only replaces the box when nothing
 * newer is waiting, a failed save stays unsaved (shown, retried on blur, blocking flushAll),
 * and leaving sends what is unsaved.
 */
export function useAutosavedField(
  serverValue: string,
  save: (value: string) => Promise<unknown>,
  describeError: (error: unknown) => string,
  delayMs = 800,
) {
  const [value, setValue] = useState(serverValue);
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState('');
  const pending = useRef<string | null>(null);
  const edits = useRef(0);
  const settled = useRef(0);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const saveRef = useRef(save);
  saveRef.current = save;
  const lastError = useRef('');
  const dirty = () => edits.current !== settled.current;

  const flush = (): Promise<void> => {
    clearTimeout(timer.current);
    const next = pending.current;
    if (next !== null) {
      pending.current = null;
      const upTo = edits.current;
      setState('saving');
      chain.current = chain.current.then(async () => {
        try {
          await saveRef.current(next);
          lastError.current = '';
          setError('');
          const wasDirty = dirty();
          settled.current = Math.max(settled.current, upTo);
          if (wasDirty && !dirty()) markUnsaved(-1);
          setState(dirty() ? 'saving' : 'saved');
        } catch (e) {
          pending.current ??= next;
          lastError.current = describeError(e);
          setError(lastError.current);
          setState('idle');
        }
      });
    }
    return chain.current.then(() => {
      if (dirty()) throw new Error(`Some changes aren’t saved yet: ${lastError.current || 'still saving'}`);
    });
  };

  const change = (next: string) => {
    setValue(next);
    if (!dirty()) markUnsaved(1);
    edits.current += 1;
    pending.current = next;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flush().catch(() => undefined), delayMs);
  };

  useEffect(() => {
    if (!dirty()) setValue(serverValue);
  }, [serverValue]);

  useEffect(() => {
    const unregister = registerFlusher(flush);
    return () => {
      unregister();
      flush()
        .catch(() => undefined)
        .finally(() => dirty() && markUnsaved(-1));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (state !== 'saved') return;
    const t = setTimeout(() => setState('idle'), 1500);
    return () => clearTimeout(t);
  }, [state]);

  return {value, change, flush: () => flush().catch(() => undefined), state, error};
}
