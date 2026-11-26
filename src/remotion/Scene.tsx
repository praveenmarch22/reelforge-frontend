import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Freeze,
  Img,
  interpolate,
  OffthreadVideo,
  spring,
  useCurrentFrame,
} from 'remotion';
import {Captions} from './Captions';
import type {CaptionStyle, Motion, TimelineScene} from './types';
import {MOOD_GRADIENTS, resolveSrc} from './util';

const MIN_PLAYBACK_RATE = 0.8;
const cover: React.CSSProperties = {width: '100%', height: '100%', objectFit: 'cover'};

/** Slow zoom or pan, so stills feel like video. progress goes from 0 to 1 across the scene. */
const motionTransform = (motion: Motion, progress: number): string => {
  const p = Math.min(1, Math.max(0, progress));
  switch (motion) {
    case 'zoom-out':
      return `scale(${1.15 - 0.15 * p})`;
    case 'pan-left':
      return `scale(1.15) translateX(${3 - 6 * p}%)`;
    case 'pan-right':
      return `scale(1.15) translateX(${-3 + 6 * p}%)`;
    default:
      return `scale(${1 + 0.15 * p})`;
  }
};

/**
 * Called when a file can't be played. Only the web app's preview passes it (to show a message and
 * a way to reload); without it Remotion fails loudly, which is what a render must do with a
 * broken file.
 */
export type MediaErrorHandler = (error: Error) => void;

const Visual: React.FC<{scene: TimelineScene; fps: number; onMediaError?: MediaErrorHandler}> = ({scene, fps, onMediaError}) => {
  const frame = useCurrentFrame();
  const {visual, durationInFrames, mood} = scene;
  const progress = frame / Math.max(1, durationInFrames - 1);

  if (!visual.src) {
    const [a, b] = MOOD_GRADIENTS[mood] ?? MOOD_GRADIENTS.calm;
    return <AbsoluteFill style={{background: `linear-gradient(180deg, ${a}, ${b})`}} />;
  }

  if (visual.kind === 'image') {
    return (
      <AbsoluteFill style={{overflow: 'hidden'}}>
        <Img src={resolveSrc(visual.src)} onError={onMediaError ? () => onMediaError(new Error('The image could not be loaded')) : undefined} style={{...cover, transform: motionTransform(visual.motion, progress)}} />
      </AbsoluteFill>
    );
  }

  // Video: fit the clip to the scene (see "Fitting a video clip" in the strategy doc).
  const sceneSeconds = durationInFrames / fps;
  // A trimmed clip starts later and may stop early; the rest of the fitting works on what is left.
  const trimStart = Math.max(0, visual.trimStart ?? 0);
  const trimmedEnd = visual.trimEnd ?? visual.durationSeconds;
  const clipSeconds = trimmedEnd ? Math.max(0, trimmedEnd - trimStart) : visual.durationSeconds;
  const startFrom = Math.round(trimStart * fps);
  const src = resolveSrc(visual.src);

  if (!clipSeconds || clipSeconds >= sceneSeconds) {
    return (
      <AbsoluteFill style={{overflow: 'hidden'}}>
        <OffthreadVideo src={src} muted startFrom={startFrom} onError={onMediaError} style={cover} />
      </AbsoluteFill>
    );
  }

  // Shorter clip: slow it down (not below 0.8x), then hold the last frame with a slow zoom.
  const rate = Math.max(MIN_PLAYBACK_RATE, clipSeconds / sceneSeconds);
  const playFrames = Math.max(1, Math.floor((clipSeconds / rate) * fps) - 1);
  if (frame < playFrames) {
    return (
      <AbsoluteFill style={{overflow: 'hidden'}}>
        <OffthreadVideo src={src} muted startFrom={startFrom} onError={onMediaError} playbackRate={rate} style={cover} />
      </AbsoluteFill>
    );
  }
  const holdProgress = (frame - playFrames) / Math.max(1, durationInFrames - playFrames);
  return (
    <AbsoluteFill style={{overflow: 'hidden'}}>
      <Freeze frame={playFrames - 1}>
        <OffthreadVideo src={src} muted startFrom={startFrom} onError={onMediaError} playbackRate={rate} style={{...cover, transform: `scale(${1 + 0.08 * holdProgress})`}} />
      </Freeze>
    </AbsoluteFill>
  );
};

const OnScreenText: React.FC<{text: string; fps: number}> = ({text, fps}) => {
  const frame = useCurrentFrame();
  if (!text) return null;
  const enter = spring({frame, fps, config: {damping: 14, stiffness: 160}});
  return (
    <AbsoluteFill style={{justifyContent: 'flex-start', alignItems: 'center', paddingTop: 260}}>
      <div
        style={{
          transform: `scale(${interpolate(enter, [0, 1], [0.7, 1])})`,
          opacity: enter,
          maxWidth: 860,
          padding: '18px 34px',
          borderRadius: 20,
          backgroundColor: 'rgba(0,0,0,0.55)',
          color: 'white',
          fontFamily: "'Arial Black', 'Segoe UI Black', Arial, sans-serif",
          fontSize: 64,
          lineHeight: 1.15,
          textAlign: 'center',
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

export const SceneView: React.FC<{
  scene: TimelineScene;
  fps: number;
  voiceVolume: number;
  showCaptions: boolean;
  captionStyle: CaptionStyle;
  onMediaError?: MediaErrorHandler;
}> = ({scene, fps, voiceVolume, showCaptions, captionStyle, onMediaError}) => (
  <AbsoluteFill>
    <Visual scene={scene} fps={fps} onMediaError={onMediaError} />
    {/* Darken the lower half slightly so captions stay readable on bright footage. */}
    <AbsoluteFill style={{background: 'linear-gradient(180deg, rgba(0,0,0,0) 45%, rgba(0,0,0,0.45) 100%)'}} />
    <OnScreenText text={scene.onScreenText} fps={fps} />
    {showCaptions ? <Captions words={scene.words} fps={fps} styleName={captionStyle} /> : null}
    {scene.voice.src ? <Audio src={resolveSrc(scene.voice.src)} volume={voiceVolume} onError={onMediaError} /> : null}
  </AbsoluteFill>
);
