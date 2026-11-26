import type {Timeline} from '@/remotion/types';

// Presigned links stay valid for 2 hours. A link the player already has is reused while it has
// more than half an hour left, so a timeline fetched again (after any edit) doesn't make the
// player download every file again (QF6-008).
const REUSE_FOR_MS = 90 * 60 * 1000;

type Known = Map<string, {url: string; since: number}>;
const known = new WeakMap<Timeline, Known>();

const pathOf = (url: string) => url.split('?')[0];

/** The new timeline, with each file's link replaced by the earlier one for the same file. */
export function stableLinks(previous: Timeline | undefined, next: Timeline, now = Date.now()): Timeline {
  const before: Known = (previous && known.get(previous)) || new Map();
  const after: Known = new Map();
  const keep = (url: string): string => {
    if (!url) return url;
    const path = pathOf(url);
    const old = before.get(path);
    const chosen = old && now - old.since < REUSE_FOR_MS ? old : {url, since: now};
    after.set(path, chosen);
    return chosen.url;
  };
  const result: Timeline = {
    ...next,
    music: next.music ? {...next.music, src: keep(next.music.src)} : null,
    scenes: next.scenes.map((s) => ({
      ...s,
      visual: {...s.visual, src: keep(s.visual.src)},
      voice: {...s.voice, src: keep(s.voice.src)},
    })),
  };
  known.set(result, after);
  return result;
}
