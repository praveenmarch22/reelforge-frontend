import {AlertTriangle, Image as ImageIcon, Loader2, Mic, RotateCw, Video} from 'lucide-react';
import {useRef, useState} from 'react';
import type {PartStatus, Scene} from '@/api/types';
import {Button} from '@/components/ui/Button';
import {cn} from '@/lib/cn';

const BUSY: PartStatus[] = ['queued', 'running'];

const STATUS_TEXT: Record<PartStatus, string> = {
  missing: 'not made yet',
  outdated: 'out of date',
  queued: 'waiting',
  running: 'being made',
  ready: 'ready',
  failed: 'failed',
};

function Dot({status, label}: {status: PartStatus; label: string}) {
  return (
    <span
      title={`${label}: ${STATUS_TEXT[status]}`}
      className={cn(
        'inline-block h-2 w-2 rounded-full',
        status === 'ready' && 'bg-cyan',
        BUSY.includes(status) && 'animate-pulse bg-violet-soft',
        status === 'failed' && 'bg-bad',
        (status === 'missing' || status === 'outdated') && 'bg-white/25',
      )}
    />
  );
}

/** The left column of screen 11: one row per scene with its parts' status. */
export function SceneList({
  scenes,
  selectedId,
  onSelect,
  onRetry,
  onMove,
  retrying,
}: {
  scenes: Scene[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRetry: (id: string) => void;
  onMove: (from: number, to: number) => void;
  retrying: boolean;
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  // Thumbnails keep the link they were first shown with (it is valid for 2 hours), so polling
  // and edits don't download them again (QF6-019).
  const thumbs = useRef(new Map<string, {url: string; since: number}>());
  const thumbFor = (url: string | null | undefined) => {
    if (!url) return url;
    const path = url.split('?')[0];
    const known = thumbs.current.get(path);
    if (known && Date.now() - known.since < 90 * 60 * 1000) return known.url;
    thumbs.current.set(path, {url, since: Date.now()});
    return url;
  };
  return (
    <ol className="space-y-2" aria-label="Scenes">
      {scenes.map((scene, i) => {
        const busy = BUSY.includes(scene.voiceStatus) || BUSY.includes(scene.visualStatus);
        const failed = scene.voiceStatus === 'failed' || scene.visualStatus === 'failed';
        const thumb = thumbFor(scene.visual?.thumbnailUrl);
        const selected = scene.id === selectedId;
        return (
          <li
            key={scene.id}
            // Drag a scene onto another to reorder (C5); the script editor's menu has the keyboard way.
            onDragOver={(e) => dragging !== null && e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (dragging !== null) onMove(dragging, i);
              setDragging(null);
            }}
          >
            <div
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                setDragging(i);
              }}
              onDragEnd={() => setDragging(null)}
              className={cn(
                'relative flex gap-2.5 rounded-xl border p-2 transition',
                dragging !== null && dragging !== i && 'border-dashed',
                selected ? 'border-violet bg-violet/10' : 'border-line bg-white/[0.03] hover:bg-white/[0.06]',
                failed && 'border-bad/50 bg-bad/10',
              )}
            >
              <button
                type="button"
                aria-current={selected || undefined}
                aria-label={`Scene ${i + 1}: ${scene.narration.slice(0, 60)}`}
                onClick={() => onSelect(scene.id)}
                className="flex min-w-0 flex-1 gap-2.5 text-left focus:outline-none"
              >
                <span className="relative h-16 w-9 shrink-0 overflow-hidden rounded-md bg-white/[0.06]">
                  {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" /> : null}
                  {busy ? (
                    <span className="absolute inset-0 grid place-items-center bg-black/50">
                      <Loader2 className="h-4 w-4 animate-spin text-cyan" aria-hidden />
                    </span>
                  ) : null}
                  {failed && !busy ? (
                    <span className="absolute inset-0 grid place-items-center bg-black/40">
                      <AlertTriangle className="h-4 w-4 text-red-300" aria-hidden />
                    </span>
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-xs font-semibold">
                    {String(i + 1).padStart(2, '0')} · <span className="capitalize text-muted">{scene.mood}</span>
                  </span>
                  <span className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-white/85">{scene.narration}</span>
                  <span className="mt-1 flex items-center gap-2 text-[10px] text-muted">
                    <Mic className="h-3 w-3" aria-hidden /> <Dot status={scene.voiceStatus} label="Voice" />
                    {scene.visual?.kind === 'video' ? <Video className="h-3 w-3" aria-hidden /> : <ImageIcon className="h-3 w-3" aria-hidden />}
                    <Dot status={scene.visualStatus} label="Visual" />
                    <span className="sr-only">
                      Voice {STATUS_TEXT[scene.voiceStatus]}, visual {STATUS_TEXT[scene.visualStatus]}.
                    </span>
                  </span>
                </span>
              </button>
              {failed && !busy ? (
                <Button
                  variant="danger"
                  size="sm"
                  className="self-center"
                  loading={retrying}
                  onClick={() => onRetry(scene.id)}
                  aria-label={`Retry scene ${i + 1}`}
                >
                  <RotateCw className="h-3.5 w-3.5" aria-hidden /> Retry
                </Button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
