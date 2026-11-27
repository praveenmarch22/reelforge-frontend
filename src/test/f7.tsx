// Shared objects and a page opener for the F7 render and publish tests (docs/SCREENS_F7.md).
// The backend is the fake `fetch` from ./fakeApi.

import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {render} from '@testing-library/react';
import {useEffect, type ReactElement} from 'react';
import {MemoryRouter, Route, Routes, useLocation} from 'react-router-dom';
import {vi} from 'vitest';
import type {Connection, Post, Render} from '@/api/types';

export const CHANNEL: Connection = {
  status: 'connected',
  name: 'Asha Shorts',
  pictureUrl: 'https://yt3.example/asha.jpg',
  connectedAt: '2026-11-26T09:00:00Z',
};
export const EXPIRED: Connection = {...CHANNEL, status: 'reconnect_required'};

export function aRender(over: Partial<Render> = {}): Render {
  return {
    id: 'r1',
    projectId: 'p1',
    jobId: 'j-render',
    state: 'succeeded',
    progress: 100,
    timelineVersion: 1,
    outdated: false,
    video: {url: '/media/r1.mp4', downloadUrl: '/media/r1.mp4?download', durationSeconds: 29.4, sizeBytes: 12_000_000},
    thumbnailUrl: '/media/r1.jpeg',
    error: null,
    createdAt: '2026-11-26T10:00:00Z',
    finishedAt: '2026-11-26T10:17:00Z',
    ...over,
  };
}

/** A finished render with its own id and files. */
export function aVideo(id: string, over: Partial<Render> = {}): Render {
  return aRender({
    id,
    video: {url: `/media/${id}.mp4`, downloadUrl: `/media/${id}.mp4?download`, durationSeconds: 29.4, sizeBytes: 12_000_000},
    thumbnailUrl: `/media/${id}.jpeg`,
    ...over,
  });
}

export function aPost(over: Partial<Post> = {}): Post {
  return {
    id: 'post1',
    renderId: 'r1',
    projectId: 'p1',
    platform: 'youtube',
    state: 'queued',
    progress: 0,
    title: 'My Short',
    caption: '',
    visibility: 'public',
    credits: [],
    url: null,
    privateUntilVerified: false,
    error: null,
    createdAt: '2026-11-26T10:20:00Z',
    publishedAt: null,
    ...over,
  };
}

/** The address the app is at, as text (path and query). */
export function Where() {
  const at = useLocation();
  return <p data-testid="where">{at.pathname + at.search}</p>;
}

/** Records every address the router shows, so a parameter that was removed can be checked. */
export const visited: string[] = [];
function Recorder() {
  const at = useLocation();
  useEffect(() => {
    visited.push(at.pathname + at.search);
  }, [at]);
  return null;
}

export function newClient() {
  return new QueryClient({defaultOptions: {queries: {retry: false}, mutations: {retry: false}}});
}

/** Renders `routes` at `path`, with a catch-all that shows where the app went. */
export function openAt(path: string, routes: {path: string; element: ReactElement}[], client = newClient()) {
  visited.length = 0;
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]} future={{v7_startTransition: true, v7_relativeSplatPath: true}}>
        <Recorder />
        <Routes>
          {routes.map((r) => (
            <Route key={r.path} path={r.path} element={r.element} />
          ))}
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return {...view, client};
}

/** jsdom has no <dialog> methods. */
export function polyfillDialog() {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
}

/** `window.location.assign` replaced, so "going to Google" can be checked. */
export function stubAssign() {
  const assign = vi.fn();
  vi.stubGlobal('location', {...window.location, assign});
  return assign;
}
