// Autosave bookkeeping shared by the editors (QF5-001, QF5-002).
//
// Each field that saves as you type registers a "flush" that sends its unsaved text now. Actions
// that depend on the saved text (Generate, rewrites) wait for every flush first, and closing the
// tab warns while anything is still unsaved.

import {useEffect} from 'react';

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
