import {staticFile} from 'remotion';

/** Timeline paths are inside renderer/public, or full URLs (S3 in the product). */
export const resolveSrc = (src: string): string =>
  /^https?:\/\//.test(src) ? src : staticFile(src);

export const MOOD_GRADIENTS: Record<string, [string, string]> = {
  calm: ['#285a8c', '#0a1e3c'],
  joyful: ['#fab43c', '#dc5a3c'],
  excited: ['#ff5078', '#7828c8'],
  funny: ['#ffd200', '#ff7800'],
  inspiring: ['#3ca0ff', '#8c3cdc'],
  triumphant: ['#ffbe28', '#b43c14'],
  serious: ['#464650', '#14141e'],
  tense: ['#8c141e', '#140a14'],
  mysterious: ['#3c1e6e', '#0a0a28'],
  sad: ['#465a78', '#1e2332'],
};
