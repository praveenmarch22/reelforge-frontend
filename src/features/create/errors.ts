import {ApiError} from '@/api/client';

const credits = (n: number) => `${n} credit${n === 1 ? '' : 's'}`;

function renewal(iso: unknown): string {
  if (typeof iso !== 'string') return 'at the start of next month';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'at the start of next month';
  return `on ${date.toLocaleDateString(undefined, {day: 'numeric', month: 'long'})}`;
}

/**
 * One plain-language message for any failed request (QF5-008). Out of credits reads the same
 * on every screen, with the renewal date from the API (402 `details.resetsAt`).
 */
export function errorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.code === 'insufficient_credits') {
      const d = (error.details ?? {}) as {needed?: number; balance?: number; resetsAt?: string};
      const need = typeof d.needed === 'number' ? `This needs ${credits(d.needed)}` : 'You need more credits';
      const have = typeof d.balance === 'number' ? ` and you have ${d.balance}` : '';
      return `${need}${have}. Your credits renew ${renewal(d.resetsAt)}.`;
    }
    return Object.values(error.fields)[0] ?? error.message;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}
