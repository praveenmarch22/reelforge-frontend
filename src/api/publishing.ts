// Rendering (API E1–E3) and publishing (API F1, F4–F6; docs/PUBLISHING_YOUTUBE.md) for F7.

import {useMutation, useQuery, useQueryClient, type QueryClient} from '@tanstack/react-query';
import {api} from './client';
import {newIdempotencyKey, projectKey, waitForJob} from './projects';
import type {Job, Platform, Post, Project, Render, Visibility} from './types';

export const RENDER_POLL_MS = 3000;
const RENDER_ACTIVE = ['queued', 'running'];
const POST_ACTIVE = ['queued', 'uploading', 'processing'];

const renderKey = (id: string) => ['render', id] as const;
const rendersKey = (projectId: string) => ['renders', projectId] as const;
const postKey = (id: string) => ['post', id] as const;

function refresh(qc: QueryClient, projectId: string) {
  void qc.invalidateQueries({queryKey: projectKey(projectId)});
  void qc.invalidateQueries({queryKey: rendersKey(projectId)});
  void qc.invalidateQueries({queryKey: ['credits']});
  void qc.invalidateQueries({queryKey: ['me']});
  void qc.invalidateQueries({queryKey: ['projects']});
}

// ---------------------------------------------------------------- rendering

/** E1: renders the Reel as it is now. 2 credits, refunded if it fails. */
export function useStartRender(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<{
        render: Render;
        job: Job;
        creditsReserved: number;
        balance: number;
      }>(`/projects/${projectId}/render`, {
        method: 'POST',
        idempotencyKey: newIdempotencyKey(),
      }),
    onSuccess: ({render}) => {
      qc.setQueryData(renderKey(render.id), render);
      refresh(qc, projectId);
    },
  });
}

/** E2, polled every 3 s while the render is queued or running. */
export function useRender(id: string | undefined) {
  return useQuery({
    queryKey: renderKey(id ?? ''),
    queryFn: async () => (await api<{render: Render}>(`/renders/${id}`)).render,
    enabled: !!id,
    refetchInterval: (q) => (q.state.data && RENDER_ACTIVE.includes(q.state.data.state) ? RENDER_POLL_MS : false),
  });
}

/** E3: the Reel's renders, newest first. */
export function useRenders(projectId: string) {
  return useQuery({
    queryKey: rendersKey(projectId),
    queryFn: async () => (await api<{items: Render[]}>(`/projects/${projectId}/renders`)).items,
  });
}

/** G3: stops a render (or any job); its credits are refunded. */
export function useCancelJob(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => api<{job: Job}>(`/jobs/${jobId}/cancel`, {method: 'POST'}),
    onSuccess: () => {
      void qc.invalidateQueries({queryKey: ['render']});
      refresh(qc, projectId);
    },
  });
}

export const isRenderActive = (r: Render | null | undefined) => !!r && RENDER_ACTIVE.includes(r.state);

// ---------------------------------------------------------------- connections

/** F1: sends the browser to the platform's sign-in, which comes back to `returnTo`. */
export function useConnect() {
  return useMutation({
    mutationFn: async ({platform, returnTo}: {platform: Platform; returnTo: string}) => {
      const {authorizeUrl} = await api<{authorizeUrl: string}>(
        `/connections/${platform}/connect?returnTo=${encodeURIComponent(returnTo)}`,
      );
      // The page is leaving now; the caller keeps its button busy until it has.
      window.location.assign(authorizeUrl);
    },
  });
}

// ---------------------------------------------------------------- publishing

export type PostText = {title: string; caption: string; hashtags: string[]};

/** F4: the title, description and hashtags written by the language model (free). */
export function useWriteCaption(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (signal?: AbortSignal) => {
      const {job} = await api<{job: Job}>(`/projects/${projectId}/caption/generate`, {method: 'POST'});
      const done = await waitForJob(job.id, signal);
      if (done.state !== 'succeeded') throw new Error(done.error?.message ?? 'That didn’t work. Please try again.');
      return done.output as unknown as PostText;
    },
    onSuccess: (text) =>
      qc.setQueryData<Project>(projectKey(projectId), (p) =>
        p
          ? {
              ...p,
              postTitle: text.title,
              postCaption: text.caption,
              hashtags: text.hashtags,
            }
          : p,
      ),
  });
}

export type PublishBody = PostText & {
  platform: Platform;
  visibility: Visibility;
  confirmOutdated?: boolean;
};

/** F5: publishes a finished render. Free. */
export function usePublish(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({renderId, ...body}: PublishBody & {renderId: string}) =>
      api<{post: Post; job: Job}>(`/renders/${renderId}/publish`, {
        method: 'POST',
        body,
        idempotencyKey: newIdempotencyKey(),
      }),
    onSuccess: ({post}) => {
      qc.setQueryData(postKey(post.id), post);
      refresh(qc, projectId);
    },
  });
}

/** F6, polled every 3 s while publishing. */
export function usePost(id: string | undefined) {
  return useQuery({
    queryKey: postKey(id ?? ''),
    queryFn: async () => (await api<{post: Post}>(`/posts/${id}`)).post,
    enabled: !!id,
    refetchInterval: (q) => (q.state.data && POST_ACTIVE.includes(q.state.data.state) ? RENDER_POLL_MS : false),
  });
}

export const isPostActive = (p: Post | null | undefined) => !!p && POST_ACTIVE.includes(p.state);
