import type {KeyboardEvent} from 'react';

/**
 * The WAI-ARIA tabs pattern for a tab list: arrow keys (and Home, End) move between tabs and
 * choose them. Each tab button has `data-tab` with its id, and only the chosen one has
 * tabIndex 0, so the list is a single Tab stop (QF8-002).
 */
export function tabKeys<T extends string>(order: readonly T[], current: T, choose: (id: T) => void) {
  return (e: KeyboardEvent<HTMLElement>) => {
    const at = order.indexOf(current);
    const forward = e.key === 'ArrowRight' || e.key === 'ArrowDown';
    const back = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
    const next = forward
      ? order[(at + 1) % order.length]
      : back
        ? order[(at + order.length - 1) % order.length]
        : e.key === 'Home'
          ? order[0]
          : e.key === 'End'
            ? order[order.length - 1]
            : null;
    if (!next) return;
    e.preventDefault();
    choose(next);
    e.currentTarget.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus();
  };
}
