import {describe, expect, it} from 'vitest';
import {musicVolume} from './Reel';
import type {Timeline, TimelineScene} from './types';

// The music level the preview (and the renderer: these files are the same, see sync.test.ts) plays
// at each frame: ducked under the voice, faded at both ends. The renderer now also accepts scenes
// whose voice has no length yet (B12: scenes not made yet have an empty src and a null length).

const FPS = 30;

function sceneAt(startFrame: number, durationInFrames: number, voiceSeconds: number | null): TimelineScene {
  return {
    id: `s${startFrame}`,
    startFrame,
    durationInFrames,
    mood: 'calm',
    onScreenText: '',
    visual: {kind: 'image', src: '', durationSeconds: null, motion: 'zoom-in'},
    voice: {src: voiceSeconds ? 'v.mp3' : '', durationSeconds: voiceSeconds},
    words: [],
  };
}

function timeline(scenes: TimelineScene[], music: Partial<NonNullable<Timeline['music']>> = {}): Timeline {
  const durationInFrames = scenes.reduce((n, s) => Math.max(n, s.startFrame + s.durationInFrames), 0);
  return {
    version: 1,
    projectId: 'p1',
    fps: FPS,
    width: 1080,
    height: 1920,
    durationInFrames,
    captionStyle: 'bold-pop',
    showCaptions: true,
    voiceVolume: 1,
    music: {src: 'm.mp3', volume: 0.3, duckedVolume: 0.1, fadeInSeconds: 1, fadeOutSeconds: 1, ...music},
    scenes,
  };
}

describe('music volume in the preview', () => {
  it('is ducked while a voice speaks and back to full between voices', () => {
    // Scene 1: 0-150 with a 3 s voice (frames 0-90); scene 2: 150-300 with a 2 s voice.
    const t = timeline([sceneAt(0, 150, 3), sceneAt(150, 150, 2)]);
    expect(musicVolume(60, t)).toBeCloseTo(0.1); // under scene 1's voice
    expect(musicVolume(120, t)).toBeCloseTo(0.3); // silence between voices
    expect(musicVolume(180, t)).toBeCloseTo(0.1); // under scene 2's voice
  });

  it('a scene whose voice has no length yet does not duck (and does not break)', () => {
    const t = timeline([sceneAt(0, 150, null), sceneAt(150, 150, null)]);
    for (const frame of [40, 100, 200]) {
      expect(Number.isFinite(musicVolume(frame, t))).toBe(true);
      expect(musicVolume(frame, t)).toBeCloseTo(0.3);
    }
  });

  it('with ducking off (duckedVolume equals volume, as B12 sends it) the level is steady', () => {
    const t = timeline([sceneAt(0, 150, 3)], {duckedVolume: 0.3});
    expect(musicVolume(60, t)).toBeCloseTo(0.3);
    expect(musicVolume(120, t)).toBeCloseTo(0.3);
  });

  it('fades in at the start and out at the end, and is silent without music', () => {
    const t = timeline([sceneAt(0, 300, null)]);
    expect(musicVolume(0, t)).toBe(0);
    expect(musicVolume(15, t)).toBeCloseTo(0.15);
    expect(musicVolume(300, t)).toBe(0);
    expect(musicVolume(60, {...t, music: null})).toBe(0);
  });
});
