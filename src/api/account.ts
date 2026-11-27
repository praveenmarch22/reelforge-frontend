// Settings (F8): password, account deletion, credit history, disconnecting a channel.

import {useInfiniteQuery, useMutation, useQueryClient} from '@tanstack/react-query';
import {api} from './client';
import type {Platform} from './types';

export type LedgerEntry = {
  id: string;
  amount: number;
  kind: 'grant' | 'reserve' | 'refund' | 'adjust';
  note: string;
  jobId: string | null;
  projectId: string | null;
  createdAt: string;
};

/** A11. Other sessions are signed out; this one stays. */
export const useChangePassword = () =>
  useMutation({
    mutationFn: (body: {currentPassword: string; newPassword: string}) =>
      api<void>('/me/password', {method: 'POST', body}),
  });

/** A12. The account is gone at once (purged after 7 days); the browser goes to the login page. */
export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {password: string}) => api<void>('/me', {method: 'DELETE', body}),
    onSuccess: () => {
      qc.clear();
      window.location.assign('/login?deleted=1');
    },
  });
}

/** H2, page by page. */
export function useLedger() {
  return useInfiniteQuery({
    queryKey: ['ledger'],
    initialPageParam: '',
    queryFn: ({pageParam}) =>
      api<{items: LedgerEntry[]; nextCursor: string | null}>(
        `/credits/ledger?limit=20${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** F3. Posts are kept; the token is revoked. */
export function useDisconnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (platform: Platform) => api<void>(`/connections/${platform}`, {method: 'DELETE'}),
    onSuccess: () => void qc.invalidateQueries({queryKey: ['me']}),
  });
}
