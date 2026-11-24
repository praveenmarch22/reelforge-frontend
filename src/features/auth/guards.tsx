import {Navigate, Outlet, useLocation} from 'react-router-dom';
import {useMe} from '@/api/hooks';
import {Button} from '@/components/ui/Button';
import {FullPageSpinner} from '@/components/ui/FullPageSpinner';

function LoadError({onRetry}: {onRetry: () => void}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-muted">We couldn't load your account. Check your connection and try again.</p>
      <Button variant="secondary" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

/** Pages that need a signed-in user. Others are sent to the login page and brought back afterwards. */
export function RequireAuth() {
  const location = useLocation();
  const {data: user, isPending, isError, refetch} = useMe();
  if (isPending) return <FullPageSpinner />;
  if (isError) return <LoadError onRetry={() => void refetch()} />;
  if (!user) return <Navigate to="/login" replace state={{from: location.pathname + location.search}} />;
  return <Outlet />;
}

/**
 * App pages: a verified user who hasn't been through first-run setup is sent there once.
 * Unverified users are not (they see the "verify your email" banner first; PRD flow 1).
 */
export function OnboardingGate() {
  const {data: user} = useMe();
  const {search} = useLocation();
  if (user?.emailVerified && !user.onboardingCompleted) {
    // An Instagram connection that failed outright comes back to the default page
    // (/app/settings?instagram=error...). Carry that result into setup's Instagram step
    // instead of dropping it, so the failure is shown.
    const result = new URLSearchParams(search);
    const instagram = result.get('instagram');
    if (instagram) {
      const next = new URLSearchParams({step: '3', instagram});
      const reason = result.get('reason');
      if (reason) next.set('reason', reason);
      return <Navigate to={`/onboarding?${next}`} replace />;
    }
    return <Navigate to="/onboarding" replace />;
  }
  return <Outlet />;
}

/** Login, sign-up and password pages: signed-in users go straight to the app. */
export function GuestOnly() {
  const {data: user, isPending, isError, refetch} = useMe();
  // Set by RequireAuth when it sent the visitor here; this is where they wanted to go.
  const from = (useLocation().state as {from?: string} | null)?.from;
  if (isPending) return <FullPageSpinner />;
  if (isError) return <LoadError onRetry={() => void refetch()} />;
  if (user) return <Navigate to={user.emailVerified ? (from ?? '/app') : '/verify'} replace />;
  return <Outlet />;
}
