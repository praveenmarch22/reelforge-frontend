// Projects, scenes and jobs (API design groups B, C, G, H) for the New Reel and editor screens.

import {useMutation, useQuery, useQueryClient, type QueryClient} from '@tanstack/react-query';
import {useEffect, useRef} from 'react';
import {api, ApiError} from './client';
import type {
  CreditsInfo,
  Estimate,
  Idea,
  Job,
  Mode,
  Mood,
  Project,
  ProjectSettings,
  Scene,
  Tone,
  VisualSource,
} from './types';

const BUSY_STATUSES = ['scripting', 'generating', 'rendering', 'posting'];
const FINISHED = ['succeeded', 'failed', 'cancelled'];
export const POLL_MS = 2000;

export const projectKey = (id: string) => ['project', id] as const;
const estimateKey = (id: string) => ['estimate', id] as const;

/** A fresh key per click, so a retried request is never run twice (API design 1). */
export const newIdempotencyKey = () => crypto.randomUUID();

/** Whether the project has work in progress, so its screen keeps polling (API B4). */
export const isBusy = (p: Project | undefined) =>
  !!p && (BUSY_STATUSES.includes(p.status) || p.activeJobs.length > 0);

// ---------------------------------------------------------------- reading

export function useProject(id: string) {
  return useQuery({
    queryKey: projectKey(id),
    queryFn: async () => (await api<{project: Project}>(`/projects/${id}`)).project,
    refetchInterval: (q) => (isBusy(q.state.data) ? POLL_MS : false),
  });
}

/** G2: the project's latest jobs, newest first (to show why a script failed: QF5-003). */
export function useProjectJobs(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ['project-jobs', id],
    queryFn: async () => (await api<{items: Job[]}>(`/projects/${id}/jobs?limit=10`)).items,
    enabled,
  });
}

export function useEstimate(id: string, enabled = true) {
  return useQuery({
    queryKey: estimateKey(id),
    queryFn: () => api<Estimate>(`/projects/${id}/estimate`),
    enabled,
  });
}

/** H1: the balance and every action's cost. Costs never change in a session, the balance does. */
export function useCredits() {
  return useQuery({queryKey: ['credits'], queryFn: () => api<CreditsInfo>('/credits'), staleTime: 30_000});
}

/**
 * G1 every 2 s until the job has finished (QF5-011). Resolves with the finished job (failed
 * jobs too). A brief network problem is retried; `signal` stops waiting (the screen went away).
 */
export async function waitForJob(jobId: string, signal?: AbortSignal): Promise<Job> {
  let misses = 0;
  for (;;) {
    if (signal?.aborted) throw new DOMException('Stopped waiting', 'AbortError');
    try {
      const {job} = await api<{job: Job}>(`/jobs/${jobId}`);
      misses = 0;
      if (FINISHED.includes(job.state)) return job;
    } catch (e) {
      // Only connection trouble is retried; an answer such as 404 is final.
      if (!(e instanceof ApiError && e.status === 0) || ++misses > 3) throw e;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

/** A finished job's output, or its plain-language error as an exception. */
function outputOf<T>(job: Job): T {
  if (job.state !== 'succeeded') {
    throw new Error(job.error?.message ?? 'That didn’t work. Please try again.');
  }
  return job.output as T;
}

/** After anything that changes the project, its credits or its estimate. */
function refresh(qc: QueryClient, id: string) {
  void qc.invalidateQueries({queryKey: ['project-jobs', id]});
  void qc.invalidateQueries({queryKey: ['timeline', id]});
  void qc.invalidateQueries({queryKey: projectKey(id)});
  void qc.invalidateQueries({queryKey: estimateKey(id)});
  void qc.invalidateQueries({queryKey: ['credits']});
  void qc.invalidateQueries({queryKey: ['me']});
  void qc.invalidateQueries({queryKey: ['projects']});
}

// ---------------------------------------------------------------- New Reel (B1, B3)

export function useIdeas() {
  return useMutation({
    mutationFn: async ({signal, ...body}: {niche: string; keywords?: string; count?: number; signal?: AbortSignal}) => {
      const {job} = await api<{job: Job}>('/ideas', {method: 'POST', body});
      return outputOf<{ideas: Idea[]}>(await waitForJob(job.id, signal)).ideas;
    },
  });
}

export type NewProject = {
  topic?: string;
  script?: string;
  tone: Tone;
  mode: Mode;
  targetSeconds: number;
  voiceId?: string;
};

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: NewProject) => api<{project: Project; job: Job}>('/projects', {method: 'POST', body}),
    onSuccess: ({project}) => {
      qc.setQueryData(projectKey(project.id), project);
      void qc.invalidateQueries({queryKey: ['projects']});
      void qc.invalidateQueries({queryKey: ['credits']});
      void qc.invalidateQueries({queryKey: ['me']});
    },
  });
}

// ---------------------------------------------------------------- the project (B5, B8, B9, B11)

export type ProjectUpdate = Partial<{
  title: string;
  tone: Tone;
  voiceId: string;
  musicMood: Mood;
  music: {trackId: string} | null;
  settings: Partial<ProjectSettings>;
}>;

export function useUpdateProject(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ProjectUpdate) =>
      api<{project: Project; estimate: Estimate}>(`/projects/${id}`, {method: 'PATCH', body}),
    onSuccess: ({project, estimate}) => {
      qc.setQueryData(projectKey(id), project);
      qc.setQueryData(estimateKey(id), estimate);
      void qc.invalidateQueries({queryKey: ['projects']});
    },
  });
}

export function useRegenerateScript(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (instructions?: string) =>
      api<{job: Job}>(`/projects/${id}/script/regenerate`, {
        method: 'POST',
        body: instructions ? {instructions} : {},
      }),
    onSuccess: () => refresh(qc, id),
  });
}

export function useHooks(id: string) {
  return useMutation({
    mutationFn: async (signal?: AbortSignal) => {
      const {job} = await api<{job: Job}>(`/projects/${id}/hooks`, {method: 'POST'});
      return outputOf<{hooks: string[]}>(await waitForJob(job.id, signal)).hooks;
    },
  });
}

export function useGenerate(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sceneIds?: string[]) =>
      api<{jobs: Job[]; creditsReserved: number; balance: number}>(`/projects/${id}/generate`, {
        method: 'POST',
        body: sceneIds ? {sceneIds} : {},
        idempotencyKey: newIdempotencyKey(),
      }),
    onSuccess: () => refresh(qc, id),
  });
}

// ---------------------------------------------------------------- scenes (C1 to C6)

export type SceneUpdate = Partial<{
  narration: string;
  onScreenText: string;
  visualPrompt: string;
  stockQuery: string;
  mood: Mood;
  visualSource: VisualSource;
  words: {text: string}[];
}>;

/** Puts a changed scene into the cached project at once, so edits never flicker back. */
function putScene(qc: QueryClient, id: string, scene: Scene, estimate?: Estimate) {
  qc.setQueryData<Project>(projectKey(id), (p) =>
    p ? {...p, scenes: p.scenes.map((s) => (s.id === scene.id ? scene : s))} : p,
  );
  if (estimate) qc.setQueryData(estimateKey(id), estimate);
}

export function useUpdateScene(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({sceneId, body}: {sceneId: string; body: SceneUpdate}) =>
      api<{scene: Scene; estimate: Estimate}>(`/scenes/${sceneId}`, {method: 'PATCH', body}),
    onSuccess: ({scene, estimate}) => {
      putScene(qc, projectId, scene, estimate);
      void qc.invalidateQueries({queryKey: projectKey(projectId)});
    },
  });
}

export function useAddScene(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {narration: string; position?: number}) =>
      api<{scene: Scene; estimate: Estimate}>(`/projects/${projectId}/scenes`, {method: 'POST', body}),
    onSuccess: () => refresh(qc, projectId),
  });
}

export function useDeleteScene(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sceneId: string) => api<void>(`/scenes/${sceneId}`, {method: 'DELETE'}),
    onSuccess: () => refresh(qc, projectId),
  });
}

export function useDuplicateScene(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sceneId: string) =>
      api<{scene: Scene; estimate: Estimate}>(`/scenes/${sceneId}/duplicate`, {method: 'POST'}),
    onSuccess: () => refresh(qc, projectId),
  });
}

export function useReorderScenes(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sceneIds: string[]) =>
      api<{scenes: Scene[]; estimate: Estimate}>(`/projects/${projectId}/scenes/reorder`, {
        method: 'POST',
        body: {sceneIds},
      }),
    onMutate: (sceneIds) => {
      // Show the new order straight away; the answer confirms it.
      qc.setQueryData<Project>(projectKey(projectId), (p) =>
        p
          ? {
              ...p,
              scenes: sceneIds
                .map((sid, i) => {
                  const scene = p.scenes.find((s) => s.id === sid);
                  return scene ? {...scene, position: i + 1} : undefined;
                })
                .filter((s): s is Scene => !!s),
            }
          : p,
      );
    },
    onSettled: () => refresh(qc, projectId),
  });
}

export function useRewriteScene(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({sceneId, instructions, signal}: {sceneId: string; instructions: string; signal?: AbortSignal}) => {
      const {job} = await api<{job: Job}>(`/scenes/${sceneId}/rewrite`, {method: 'POST', body: {instructions}});
      void qc.invalidateQueries({queryKey: ['credits']});
      return outputOf<{narration: string; onScreenText: string}>(await waitForJob(job.id, signal));
    },
    onSettled: () => refresh(qc, projectId),
  });
}

/**
 * The signal that fires when the screen goes away, for waits on jobs (QF5-011). A new one per
 * mount, so React's double mount in development doesn't leave it already fired. Read it when
 * starting a wait: `leaveSignal()`.
 */
export function useLeaveSignal(): () => AbortSignal | undefined {
  const controller = useRef<AbortController>();
  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    return () => c.abort();
  }, []);
  return () => controller.current?.signal;
}

// ---------------------------------------------------------------- the Reel editor (F6)

export type TimelineAnswer = {
  timelineVersion: number;
  timeline: import('@/remotion/types').Timeline;
  durationSeconds: number;
  tooLong: boolean;
  ready: boolean;
};

/** B12, fetched again whenever the project's timeline version or its scenes' files change. */
export function useTimeline(id: string, version: string | undefined) {
  return useQuery({
    queryKey: ['timeline', id, version],
    queryFn: () => api<TimelineAnswer>(`/projects/${id}/timeline`),
    enabled: version !== undefined,
    placeholderData: (previous) => previous,
    // Links to the files expire after 2 hours; fetch fresh ones well before.
    staleTime: 60 * 60 * 1000,
  });
}

export function useRegenerateVoice(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({sceneId, voiceId, confirmReplaceWords}: {sceneId: string; voiceId?: string; confirmReplaceWords?: boolean}) =>
      api<{job: Job}>(`/scenes/${sceneId}/voice/regenerate`, {
        method: 'POST',
        body: {...(voiceId ? {voiceId} : {}), ...(confirmReplaceWords ? {confirmReplaceWords} : {})},
        idempotencyKey: newIdempotencyKey(),
      }),
    onSuccess: () => refresh(qc, projectId),
  });
}

export type VisualChange = Partial<{visualSource: 'stock' | 'ai_image' | 'ai_video'; visualPrompt: string; stockQuery: string}>;

export function useRegenerateVisual(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({sceneId, body}: {sceneId: string; body: VisualChange}) =>
      api<{job: Job}>(`/scenes/${sceneId}/visual/regenerate`, {
        method: 'POST',
        body,
        idempotencyKey: newIdempotencyKey(),
      }),
    onSuccess: () => refresh(qc, projectId),
  });
}

export type StockItem = {
  providerId: string;
  thumbnailUrl: string;
  previewUrl: string;
  durationSeconds: number;
  width: number;
  height: number;
  author: string;
  source: string;
  pageUrl: string;
};

/** C9: one page of stock clips for a scene (kept for 24 hours by the API). */
export function useStockSearch(sceneId: string, query: string, page: number, enabled: boolean) {
  return useQuery({
    queryKey: ['stock', sceneId, query, page],
    queryFn: () => {
      const params = new URLSearchParams({page: String(page)});
      if (query.trim()) params.set('q', query.trim());
      return api<{items: StockItem[]; nextPage: number | null; query: string}>(`/scenes/${sceneId}/stock-search?${params}`);
    },
    enabled,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
}

export function useSelectVisual(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({sceneId, stock}: {sceneId: string; stock: string}) =>
      api<{job?: Job; scene?: Scene}>(`/scenes/${sceneId}/visual/select`, {method: 'POST', body: {stock}}),
    onSuccess: () => refresh(qc, projectId),
  });
}

export type MusicTrack = {
  id: string;
  title: string;
  durationSeconds: number;
  moods: Mood[];
  license: string;
  sourceUrl: string;
  previewUrl: string;
};

/** D4: the music library, all of it or one mood's tracks. */
export function useMusic(mood?: Mood) {
  return useQuery({
    queryKey: ['music', mood ?? 'all'],
    queryFn: async () => (await api<{items: MusicTrack[]}>(`/music${mood ? `?mood=${mood}` : ''}`)).items,
    staleTime: 30 * 60 * 1000,
  });
}
