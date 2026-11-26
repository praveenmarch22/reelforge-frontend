import {describe, expect, it} from 'vitest';
import type {Timeline} from '@/remotion/types';
import {stableLinks} from './links';

// QF6-008: presigned links are new on every B12 answer; the editor reuses a link the player already
// has for the same file while it is younger than 90 minutes (links last 2 hours).

const MIN = 60 * 1000;

function timeline(sig: number, files = {voice: 'v1.wav', visual: 'i1.jpg', music: 'm1.mp3'}): Timeline {
  const link = (f: string) => (f ? `http://s3/bucket/${f}?X-Amz-Signature=${sig}` : '');
  return {
    version: sig,
    projectId: 'p1',
    fps: 30,
    width: 1080,
    height: 1920,
    durationInFrames: 90,
    captionStyle: 'bold-pop',
    showCaptions: true,
    voiceVolume: 1,
    music: files.music ? {src: link(files.music), volume: 0.3, duckedVolume: 0.1, fadeInSeconds: 1, fadeOutSeconds: 1} : null,
    scenes: [
      {
        id: 's1',
        startFrame: 0,
        durationInFrames: 90,
        mood: 'calm',
        onScreenText: `v${sig}`,
        visual: {kind: 'image', src: link(files.visual), durationSeconds: null, motion: 'zoom-in'},
        voice: {src: link(files.voice), durationSeconds: 3},
        words: [],
      },
    ],
  };
}

const srcs = (t: Timeline) => [t.scenes[0].voice.src, t.scenes[0].visual.src, t.music?.src];

describe('stableLinks', () => {
  it('the first timeline is used as it is', () => {
    const next = timeline(1);
    expect(srcs(stableLinks(undefined, next, 0))).toEqual(srcs(next));
  });

  it('reuses the earlier link for the same file under 90 minutes; everything else comes from the new timeline', () => {
    const a = stableLinks(undefined, timeline(1), 0);
    const b = stableLinks(a, timeline(2), 89 * MIN);
    expect(srcs(b)).toEqual(srcs(a));
    expect(b.scenes[0].onScreenText).toBe('v2');
    expect(b.version).toBe(2);
  });

  it('takes the new link at 90 minutes, counted from when the old one was first seen, then keeps that one', () => {
    const a = stableLinks(undefined, timeline(1), 0);
    const b = stableLinks(a, timeline(2), 60 * MIN);
    const c = stableLinks(b, timeline(3), 90 * MIN);
    expect(srcs(b)).toEqual(srcs(a));
    expect(srcs(c)).toEqual(srcs(timeline(3)));
    expect(srcs(stableLinks(c, timeline(4), 170 * MIN))).toEqual(srcs(timeline(3)));
  });

  it('a different file (a new take) gets its own new link; empty sources stay empty', () => {
    const a = stableLinks(undefined, timeline(1), 0);
    const b = stableLinks(a, timeline(2, {voice: 'v2.wav', visual: '', music: 'm1.mp3'}), MIN);
    expect(b.scenes[0].voice.src).toBe('http://s3/bucket/v2.wav?X-Amz-Signature=2');
    expect(b.scenes[0].visual.src).toBe('');
    expect(b.music?.src).toBe(a.music?.src);
  });

  it('without the earlier timeline (Reload preview) every link is fresh', () => {
    stableLinks(undefined, timeline(1), 0);
    expect(srcs(stableLinks(undefined, timeline(2), MIN))).toEqual(srcs(timeline(2)));
  });
});
