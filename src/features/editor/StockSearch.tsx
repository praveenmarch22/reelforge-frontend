import {Check, Loader2, Search} from 'lucide-react';
import {useState, type FormEvent} from 'react';
import {useSelectVisual, useStockSearch} from '@/api/projects';
import type {Scene} from '@/api/types';
import {Button} from '@/components/ui/Button';
import {Notice} from '@/components/ui/Notice';
import {errorText} from '@/features/create/errors';

const SOURCE_NAMES: Record<string, string> = {pixabay: 'Pixabay', pexels: 'Pexels'};
const SOURCE_SITES: Record<string, string> = {Pixabay: 'https://pixabay.com/', Pexels: 'https://www.pexels.com/'};

/** C9 and C10: search stock clips for a scene and use one (free). Results show where they come
 * from, as Pixabay's terms ask; the stock site's thumbnails are only shown while searching. */
export function StockSearch({scene, projectId, onClose}: {scene: Scene; projectId: string; onClose: () => void}) {
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const search = useStockSearch(scene.id, query, page, true);
  const select = useSelectVisual(projectId);
  const items = search.data?.items ?? [];
  const sources = [...new Set(items.map((i) => SOURCE_NAMES[i.source] ?? i.source))];
  const current = scene.visual?.sourceUrl;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setQuery(draft);
    setPage(1);
  };

  return (
    <section className="mt-3 rounded-xl border border-line bg-black/30 p-3" aria-label="Stock search">
      <form onSubmit={submit} className="flex gap-2">
        <label htmlFor="stock-q" className="sr-only">
          Search stock videos
        </label>
        <input
          id="stock-q"
          value={draft}
          maxLength={100}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={search.data?.query || scene.stockQuery || 'Search stock videos'}
          className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-white/[0.04] px-2.5 text-[13px] focus:outline-none"
        />
        <Button type="submit" size="sm" variant="secondary" aria-label="Search">
          <Search className="h-3.5 w-3.5" aria-hidden />
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </form>

      {search.isError ? (
        <Notice tone="error" className="mt-2">
          {errorText(search.error, 'The search didn’t work.')}
        </Notice>
      ) : null}
      {select.isError ? (
        <Notice tone="error" className="mt-2">
          {errorText(select.error, 'That clip couldn’t be used.')}
        </Notice>
      ) : null}

      {search.isLoading ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-muted" role="status">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Searching…
        </p>
      ) : (
        <>
          <ul className="mt-3 grid grid-cols-3 gap-2" aria-label="Stock results">
            {items.map((item) => {
              const inUse = current === item.pageUrl;
              return (
                <li key={item.providerId}>
                  <button
                    type="button"
                    disabled={select.isPending || inUse}
                    onClick={() => select.mutate({sceneId: scene.id, stock: item.providerId})}
                    aria-label={`Use a ${Math.round(item.durationSeconds)}-second clip by ${item.author}`}
                    className="group relative block aspect-[9/16] w-full overflow-hidden rounded-lg border border-line bg-white/5 disabled:cursor-default"
                  >
                    <img src={item.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-105" />
                    <span className="absolute bottom-0 left-0 right-0 bg-black/60 px-1.5 py-1 text-left text-[10px] leading-tight text-white">
                      {Math.round(item.durationSeconds)}s · {item.author}
                    </span>
                    {inUse ? (
                      <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-cyan text-ink">
                        <Check className="h-3 w-3" aria-hidden />
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
          {search.isSuccess && !items.length ? <p className="mt-2 text-xs text-muted">Nothing found. Try other words.</p> : null}
          <div className="mt-2 flex items-center justify-between text-[11px] text-muted">
            <span>
              {sources.length ? 'Videos from ' : ''}
              {sources.map((name, i) => (
                <span key={name}>
                  {i ? ' and ' : ''}
                  {/* Pixabay asks apps to show where results come from; a link does it best. */}
                  <a href={SOURCE_SITES[name] ?? '#'} target="_blank" rel="noreferrer" className="underline hover:text-white">
                    {name}
                  </a>
                </span>
              ))}
            </span>
            <span className="flex gap-1">
              <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button size="sm" variant="ghost" disabled={!search.data?.nextPage} onClick={() => setPage((p) => p + 1)}>
                More
              </Button>
            </span>
          </div>
        </>
      )}
    </section>
  );
}
