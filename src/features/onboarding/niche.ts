// How the "niche" profile field is built from the onboarding choices.
// The profile stores one text value: up to three topics separated by commas,
// for example "Fitness, Finance, gardening" (API A10).

export const NICHE_LABELS = [
  'Fitness',
  'Finance',
  'Tech',
  'Food',
  'Travel',
  'Motivation',
  'Education',
  'Comedy',
  'Beauty',
  'Gaming',
  'Business',
  'Lifestyle',
] as const;

export const MAX_NICHES = 3;
/** Longest free-text topic, in Unicode code points (the unit the server counts in, API A10). */
export const CUSTOM_MAX = 40;

const known = new Map<string, string>(NICHE_LABELS.map((label) => [label.toLowerCase(), label]));

/** The listed topic that matches this text regardless of case, if any. */
export const matchingLabel = (text: string): string | undefined => known.get(text.trim().toLowerCase());

type Segmenter = {segment(text: string): Iterable<{segment: string}>};
type SegmenterClass = new (locale?: string, options?: {granularity: 'grapheme'}) => Segmenter;

/**
 * Splits text into characters as a person sees them. A flag, a skin-toned emoji or a
 * family is one such character although it is made of several code points.
 */
function visibleCharacters(text: string): string[] {
  const Segmenter = (Intl as unknown as {Segmenter?: SegmenterClass}).Segmenter;
  if (!Segmenter) return Array.from(text); // very old browsers: code points
  return Array.from(new Segmenter(undefined, {granularity: 'grapheme'}).segment(text), (s) => s.segment);
}

/**
 * Cleans what is typed in "Something else": it is one topic, so commas (the separator
 * in the stored value) become spaces. It is limited to CUSTOM_MAX code points (what the
 * server counts, API A10), and the cut never goes through the middle of an emoji: one
 * that doesn't fit whole is left out.
 */
export function cleanCustom(text: string): string {
  const oneTopic = text.replace(/[,\n\r\t]+/g, ' ').replace(/ {2,}/g, ' ').replace(/^ /, '');
  let kept = '';
  let length = 0;
  for (const character of visibleCharacters(oneTopic)) {
    length += Array.from(character).length;
    if (length > CUSTOM_MAX) break;
    kept += character;
  }
  return kept;
}

/**
 * Reads a stored value back into the screen's choices. Values that break the rules
 * (too many topics, repeats, an over-long free text) are brought within them.
 */
export function splitNiche(niche: string): {chosen: string[]; custom: string} {
  const chosen: string[] = [];
  let custom = '';
  for (const part of niche.split(',').map((p) => p.trim()).filter(Boolean)) {
    if (chosen.length + (custom ? 1 : 0) >= MAX_NICHES) break;
    const label = matchingLabel(part);
    if (label) {
      if (!chosen.includes(label)) chosen.push(label);
    } else if (!custom) {
      custom = cleanCustom(part).trim();
    }
  }
  return {chosen, custom};
}

/** Builds the stored value: listed topics first, then the free text, never more than three, no repeats. */
export function joinNiche(chosen: string[], custom: string): string {
  const topics: string[] = [];
  for (const label of chosen) {
    if (!topics.includes(label)) topics.push(label);
  }
  const text = cleanCustom(custom).trim();
  if (text) {
    const label = matchingLabel(text);
    const value = label ?? text;
    if (!topics.includes(value)) topics.push(value);
  }
  return topics.slice(0, MAX_NICHES).join(', ');
}

/** How many topics the current choices amount to. */
export function countTopics(chosen: string[], custom: string): number {
  return joinNiche(chosen, custom).split(',').filter((p) => p.trim()).length;
}
