import {useEffect, useRef, useState} from 'react';

/** Plays one sample at a time (voice samples, music tracks); a second click stops it. */
export function useAudioPreview() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);

  useEffect(() => () => audioRef.current?.pause(), []);

  const toggle = (id: string, url: string) => {
    audioRef.current?.pause();
    if (playingId === id || !url) {
      setPlayingId(null);
      return;
    }
    const audio = new Audio(url);
    audioRef.current = audio;
    setFailedId(null);
    setPlayingId(id);
    const stop = () => setPlayingId((current) => (current === id ? null : current));
    audio.addEventListener('ended', stop);
    audio.play().catch((error: unknown) => {
      // Switching before a sample has started rejects with AbortError: the visitor's own action.
      const interrupted = error instanceof DOMException && error.name === 'AbortError';
      if (interrupted || audioRef.current !== audio) return;
      stop();
      setFailedId(id);
    });
  };

  return {playingId, failedId, toggle};
}
