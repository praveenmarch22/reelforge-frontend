import {keepPreviousData, useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {api, ApiError} from './client';
import type {ProjectList, User, Voice} from './types';

const ME = ['me'] as const;

/** The signed-in user, or null when nobody is signed in. */
export function useMe() {
  return useQuery({
    queryKey: ME,
    queryFn: async (): Promise<User | null> => {
      try {
        return (await api<{user: User}>('/me')).user;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

function useAuthMutation<TBody>(path: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TBody) => api<{user: User}>(path, {method: 'POST', body}),
    onSuccess: ({user}) => qc.setQueryData(ME, user),
  });
}

export const useLogin = () => useAuthMutation<{email: string; password: string}>('/auth/login');
export const useSignup = () => useAuthMutation<{name: string; email: string; password: string}>('/auth/signup');
export const useVerifyEmail = () => useAuthMutation<{token: string}>('/auth/verify-email');

/**
 * Logs out, then loads `redirectTo` with a full page load so no cached data or
 * router state from the old session survives. If the request fails, the user
 * stays signed in and the caller shows the error.
 */
export function useLogout(redirectTo = '/login') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      try {
        await api<void>('/auth/logout', {method: 'POST'});
      } catch (e) {
        // Already signed out on the server: that is the result we wanted.
        if (!(e instanceof ApiError && e.status === 401)) throw e;
      }
    },
    onSuccess: () => {
      qc.clear();
      window.location.assign(redirectTo);
    },
  });
}

export const useResendVerification = () =>
  useMutation({mutationFn: () => api<void>('/auth/resend-verification', {method: 'POST'})});

export const useForgotPassword = () =>
  useMutation({mutationFn: (body: {email: string}) => api<void>('/auth/forgot-password', {method: 'POST', body})});

export function useResetPassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {token: string; password: string}) =>
      api<void>('/auth/reset-password', {method: 'POST', body}),
    // A reset revokes every session, including this browser's if it was signed in.
    onSuccess: () => qc.setQueryData(ME, null),
  });
}

export type ProfileUpdate = {
  name?: string;
  niche?: string;
  defaults?: Partial<User['defaults']>;
  onboardingCompleted?: true;
};

/** A10: updates the profile and keeps the cached user in step. */
export function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ProfileUpdate) => api<{user: User}>('/me', {method: 'PATCH', body}),
    onSuccess: ({user}) => qc.setQueryData(ME, user),
  });
}

/** D3: the curated voice list. It rarely changes, so it is cached for the session. */
export function useVoices() {
  return useQuery({
    queryKey: ['voices'],
    queryFn: async () => (await api<{items: Voice[]}>('/voices')).items,
    staleTime: Infinity,
  });
}

/**
 * F1: asks the API where to send the browser to connect Instagram, then goes there.
 * `returnTo` is the app page Instagram's redirect should end on.
 */
export function useConnectInstagram() {
  return useMutation({
    mutationFn: async (returnTo: string) => {
      const {authorizeUrl} = await api<{authorizeUrl: string}>(
        `/instagram/connect?returnTo=${encodeURIComponent(returnTo)}`,
      );
      // The page is now leaving. The caller keeps its button busy until it does; the request
      // itself is finished, so nothing is left pending if the visitor comes back.
      window.location.assign(authorizeUrl);
    },
  });
}

export type ProjectFilters = {status?: string; q?: string; limit?: number};

export function useProjects(filters: ProjectFilters = {}) {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.q) params.set('q', filters.q);
  if (filters.limit) params.set('limit', String(filters.limit));
  const query = params.toString();
  return useQuery({
    queryKey: ['projects', filters],
    queryFn: () => api<ProjectList>(`/projects${query ? `?${query}` : ''}`),
    placeholderData: keepPreviousData,
    // Poll while anything is in progress, as the API design describes.
    refetchInterval: (q) =>
      q.state.data?.items.some((p) => ['scripting', 'generating', 'rendering', 'posting'].includes(p.status))
        ? 2000
        : false,
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/projects/${id}`, {method: 'DELETE'}),
    onSuccess: () => qc.invalidateQueries({queryKey: ['projects']}),
  });
}
