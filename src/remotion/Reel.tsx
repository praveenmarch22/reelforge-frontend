import React from 'react';
import {AbsoluteFill, Audio, Sequence} from 'remotion';
import {SceneView, type MediaErrorHandler} from './Scene';
import type {Timeline} from './types';
import {resolveSrc} from './util';

const DUCK_RAMP_FRAMES = 8;

/** Music volume for a frame: ducked while the voice speaks, with fades at both ends. */
export const musicVolume = (frame: number, t: Timeline): number => {
  if (!t.music) return 0;
  const {volume, duckedVolume, fadeInSeconds, fadeOutSeconds} = t.music;
  let duck = 0;
  for (const s of t.scenes) {
    const start = s.startFrame;
    if (!s.voice.durationSeconds) continue; // no voice yet: nothing to duck under
    const end = s.startFrame + s.voice.durationSeconds * t.fps;
    if (frame < start - DUCK_RAMP_FRAMES || frame > end + DUCK_RAMP_FRAMES) continue;
    const d =
      frame < start
        ? (frame - (start - DUCK_RAMP_FRAMES)) / DUCK_RAMP_FRAMES
        : frame > end
          ? 1 - (frame - end) / DUCK_RAMP_FRAMES
          : 1;
    duck = Math.max(duck, d);
  }
  const base = volume + (duckedVolume - volume) * duck;
  const fadeIn = Math.min(1, frame / Math.max(1, fadeInSeconds * t.fps));
  const fadeOut = Math.min(1, (t.durationInFrames - frame) / Math.max(1, fadeOutSeconds * t.fps));
  return Math.max(0, base * Math.min(fadeIn, fadeOut));
};

/** The timeline, plus (in the web app's preview only) what to do when a file can't be played. */
export type ReelProps = Timeline & {onMediaError?: MediaErrorHandler};

export const Reel: React.FC<ReelProps> = (t) => (
  <AbsoluteFill style={{backgroundColor: 'black'}}>
    {t.scenes.map((scene) => (
      <Sequence key={scene.id} name={scene.id} from={scene.startFrame} durationInFrames={scene.durationInFrames}>
        <SceneView
          scene={scene}
          fps={t.fps}
          voiceVolume={t.voiceVolume}
          showCaptions={t.showCaptions}
          captionStyle={t.captionStyle}
          onMediaError={t.onMediaError}
        />
      </Sequence>
    ))}
    {t.music ? <Audio src={resolveSrc(t.music.src)} loop volume={(f) => musicVolume(f, t)} onError={t.onMediaError} /> : null}
  </AbsoluteFill>
);
