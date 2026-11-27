// Admin console (F8; API I1–I14).

import {useInfiniteQuery, useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {api} from './client';
import type {Job} from './types';

export type AdminUser = {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  isTester: boolean;
  disabled: boolean;
  emailVerified: boolean;
  balance: number;
  monthlyAllowance: number;
  projectCount: number;
  lastLoginAt: string | null;
  createdAt: string;
};
export type AdminUserDetail = AdminUser & {
  niche: string;
  resetsAt: string | null;
  youtube: {status: string; name: string} | null;
  recentJobs: Job[];
};
export type AdminJob = Job & {userEmail: string; attempts: number};
export type Provider = {
  name: string;
  purpose: string;
  enabled: boolean;
  reason: string;
  callsToday: number;
  errorRateToday: number | null;
};
export type UsageRow = {
  day: string;
  provider: string;
  jobType: string;
  calls: number;
  failures: number;
  creditsCharged: number;
  costEstimateUsd: number;
};
export type AdminTrack = {
  id: string;
  title: string;
  durationSeconds: number;
  moods: string[];
  license: string;
  sourceUrl: string;
  previewUrl: string;
  isActive: boolean;
  createdAt: string;
};
export type AdminStats = {users: number; projects: number; failedJobsToday: number; creditsInCirculation: number};

type Page<T> = {items: T[]; nextCursor: string | null};
const qs = (params: Record<string, string | undefined>) =>
  Object.entries(params)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
    .join('&');

export const useAdminStats = () =>
  useQuery({queryKey: ['admin', 'stats'], queryFn: () => api<AdminStats>('/admin/stats')});

export function useAdminUsers(q: string) {
  return useInfiniteQuery({
    queryKey: ['admin', 'users', q],
    initialPageParam: '',
    queryFn: ({pageParam}) => api<Page<AdminUser>>(`/admin/users?${qs({q, limit: '20', cursor: pageParam})}`),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export const useAdminUser = (id: string | null) =>
  useQuery({
    queryKey: ['admin', 'user', id],
    queryFn: async () => (await api<{user: AdminUserDetail}>(`/admin/users/${id}`)).user,
    enabled: !!id,
  });

function useAdminChange<B>(fn: (body: B) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({mutationFn: fn, onSuccess: () => void qc.invalidateQueries({queryKey: ['admin']})});
}

export const useUpdateAdminUser = (id: string) =>
  useAdminChange((body: Partial<{isTester: boolean; isAdmin: boolean; disabled: boolean; monthlyAllowance: number}>) =>
    api(`/admin/users/${id}`, {method: 'PATCH', body}),
  );

export const useAdjustCredits = (id: string) =>
  useAdminChange((body: {amount: number; note: string}) => api(`/admin/users/${id}/credits`, {method: 'POST', body}));

export function useAdminJobs(filters: {state?: string; type?: string; provider?: string}) {
  return useInfiniteQuery({
    queryKey: ['admin', 'jobs', filters],
    initialPageParam: '',
    queryFn: ({pageParam}) => api<Page<AdminJob>>(`/admin/jobs?${qs({...filters, limit: '25', cursor: pageParam})}`),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export const useRetryJob = () => useAdminChange((id: string) => api(`/admin/jobs/${id}/retry`, {method: 'POST'}));

export const useProviders = () =>
  useQuery({
    queryKey: ['admin', 'providers'],
    queryFn: async () => (await api<{items: Provider[]}>('/admin/providers')).items,
  });

export const useSwitchProvider = () =>
  useAdminChange(({name, ...body}: {name: string; enabled: boolean; reason: string}) =>
    api(`/admin/providers/${name}`, {method: 'PATCH', body}),
  );

export const useUsage = () =>
  useQuery({
    queryKey: ['admin', 'usage'],
    queryFn: async () => (await api<{items: UsageRow[]}>('/admin/usage')).items,
  });

export const useAdminMusic = () =>
  useQuery({
    queryKey: ['admin', 'music'],
    queryFn: async () => (await api<{items: AdminTrack[]}>('/admin/music')).items,
  });

export type NewTrack = {
  title: string;
  moods: string[];
  license: string;
  sourceUrl: string;
  file: File;
  durationSeconds: number;
};

/** I11, the upload to the returned link, then I12 to switch the track on. */
export function useAddTrack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({file, ...meta}: NewTrack) => {
      const {track, uploadUrl} = await api<{track: AdminTrack; uploadUrl: string}>('/admin/music', {
        method: 'POST',
        body: {...meta, filename: file.name, contentType: file.type, sizeBytes: file.size},
      });
      const put = await fetch(uploadUrl, {method: 'PUT', body: file, headers: {'Content-Type': file.type}});
      if (!put.ok) throw new Error('The file couldn’t be uploaded. The track was saved switched off; try again.');
      await api(`/admin/music/${track.id}`, {method: 'PATCH', body: {isActive: true}});
      return track;
    },
    onSettled: () => void qc.invalidateQueries({queryKey: ['admin', 'music']}),
  });
}

export const useUpdateTrack = () =>
  useAdminChange(({id, ...body}: {id: string; isActive?: boolean; title?: string; moods?: string[]; license?: string}) =>
    api(`/admin/music/${id}`, {method: 'PATCH', body}),
  );

export const useDeleteTrack = () => useAdminChange((id: string) => api(`/admin/music/${id}`, {method: 'DELETE'}));
