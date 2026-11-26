import React, {useMemo} from 'react';
import {AbsoluteFill, interpolate, spring, useCurrentFrame} from 'remotion';
import type {CaptionStyle, Word} from './types';

const MAX_WORDS = 3;
const MAX_CHARS = 18;
const PAUSE_BREAK = 0.35; // seconds of silence that starts a new caption chunk
const LINGER = 0.4; // keep the last chunk on screen briefly after its last word

type Chunk = {words: Word[]; start: number; end: number};

export const chunkWords = (words: Word[]): Chunk[] => {
  const chunks: Chunk[] = [];
  let current: Word[] = [];
  const flush = () => {
    if (current.length) {
      chunks.push({words: current, start: current[0].start, end: current[current.length - 1].end});
      current = [];
    }
  };
  for (const w of words) {
    const prev = current[current.length - 1];
    const chars = current.reduce((n, x) => n + x.text.length + 1, 0) + w.text.length;
    if (current.length >= MAX_WORDS || chars > MAX_CHARS || (prev && w.start - prev.end > PAUSE_BREAK)) flush();
    current.push(w);
  }
  flush();
  return chunks;
};

const STYLES: Record<CaptionStyle, {
  base: React.CSSProperties;
  active: React.CSSProperties;
  box?: React.CSSProperties;
}> = {
  'bold-pop': {
    base: {color: 'white', WebkitTextStroke: '10px black', paintOrder: 'stroke fill', textTransform: 'uppercase'},
    active: {color: '#FFE600'},
  },
  clean: {
    base: {color: 'white', fontFamily: "'Segoe UI', Arial, sans-serif", fontWeight: 700},
    active: {textDecoration: 'underline', textDecorationThickness: 8, textUnderlineOffset: 10},
    box: {backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 18, padding: '10px 28px'},
  },
  neon: {
    base: {color: '#B8FFFF', textShadow: '0 0 18px #00E5FF, 0 0 36px #00E5FF', textTransform: 'uppercase'},
    active: {color: 'white', textShadow: '0 0 24px #FF2BD6, 0 0 48px #FF2BD6'},
  },
};

export const Captions: React.FC<{words: Word[]; fps: number; styleName: CaptionStyle}> = ({words, fps, styleName}) => {
  const frame = useCurrentFrame();
  const t = frame / fps;
  const chunks = useMemo(() => chunkWords(words), [words]);
  const index = chunks.findIndex(
    (c, i) => t >= c.start && t < (chunks[i + 1]?.start ?? Infinity) && t <= c.end + LINGER,
  );
  if (index < 0) return null;
  const chunk = chunks[index];
  const style = STYLES[styleName] ?? STYLES['bold-pop'];
  const pop = spring({frame: frame - Math.round(chunk.start * fps), fps, config: {damping: 12, stiffness: 220}});

  return (
    // Inside Instagram's safe zone: clear of the bottom caption area and the right-side buttons.
    <AbsoluteFill style={{justifyContent: 'flex-start', alignItems: 'center', paddingTop: 1150, paddingLeft: 80, paddingRight: 160}}>
      <div
        style={{
          ...style.box,
          transform: `scale(${interpolate(pop, [0, 1], [0.85, 1])})`,
          fontFamily: "'Arial Black', 'Segoe UI Black', Arial, sans-serif",
          fontSize: 78,
          lineHeight: 1.1,
          textAlign: 'center',
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: '0 22px',
        }}
      >
        {chunk.words.map((w, i) => {
          const isActive = t >= w.start && (t < w.end || i === chunk.words.length - 1 || t < chunk.words[i + 1].start);
          return (
            <span key={i} style={{...style.base, ...(isActive ? style.active : {})}}>
              {w.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
