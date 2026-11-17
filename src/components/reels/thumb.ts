// Placeholder artwork for Reels that have no rendered thumbnail yet:
// a stable gradient picked from the Reel's id.

const PALETTES: [string, string, string][] = [
  ['#2B1B5E', '#7C5CFF', '#22D3EE'],
  ['#0B2A3A', '#22D3EE', '#7C5CFF'],
  ['#3A0F3F', '#C026D3', '#7C5CFF'],
  ['#1A1040', '#4F46E5', '#F472B6'],
  ['#062A2E', '#14B8A6', '#6366F1'],
  ['#2A1238', '#9333EA', '#38BDF8'],
];

function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
}

export function thumbBackground(seed: string): string {
  const [base, a, b] = PALETTES[hash(seed) % PALETTES.length];
  const x = 20 + (hash(seed + 'x') % 60);
  return [
    `radial-gradient(120% 70% at ${x}% 0%, ${a}cc 0%, transparent 60%)`,
    `radial-gradient(90% 60% at ${100 - x}% 100%, ${b}99 0%, transparent 65%)`,
    `linear-gradient(180deg, ${base}, #07070B)`,
  ].join(', ');
}

export function formatDuration(seconds: number | null): string {
  if (seconds == null) return '';
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
