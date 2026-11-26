// The timeline JSON built by the API (B12, `timeline.py`; see docs/PIPELINE_STRATEGY.md).
// The web app's preview uses a copy of these files (frontend/src/remotion); keep them identical.

export type Word = {text: string; start: number; end: number};

export type Motion = 'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right';

export type TimelineScene = {
  id: string;
  startFrame: number;
  durationInFrames: number;
  mood: string;
  onScreenText: string;
  visual: {
    kind: 'image' | 'video';
    src: string;
    durationSeconds: number | null;
    motion: Motion;
    /** Seconds cut from the start of a video clip; trimEnd is where it stops (null: its end). */
    trimStart?: number;
    trimEnd?: number | null;
  };
  /** An empty src (and a null length) while the scene has no voice yet. */
  voice: {src: string; durationSeconds: number | null};
  words: Word[]; // seconds from the start of this scene
  /** Whether the scene's voice and visual are both made (the editor marks the others). */
  ready?: boolean;
};

export type CaptionStyle = 'bold-pop' | 'clean' | 'neon';

export type Timeline = {
  version: number;
  projectId: string;
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
  captionStyle: CaptionStyle;
  showCaptions: boolean;
  voiceVolume: number;
  transition?: 'cut' | 'fade' | 'slide';
  music: null | {
    src: string;
    volume: number;
    duckedVolume: number;
    fadeInSeconds: number;
    fadeOutSeconds: number;
    /** What plays, for the editor and the posting credit (not used for drawing). */
    trackId?: string | null;
    assetId?: string | null;
    title?: string;
    license?: string;
  };
  scenes: TimelineScene[];
};
