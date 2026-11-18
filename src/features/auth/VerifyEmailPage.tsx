import {Loader2, MailCheck, MailWarning} from 'lucide-react';
import {useEffect, useRef, useState, type ReactNode} from 'react';
import {Link, useNavigate, useSearchParams} from 'react-router-dom';
import {ApiError} from '@/api/client';
import {useLogout, useMe, useResendVerification, useVerifyEmail} from '@/api/hooks';
import {AuthHeading, AuthLayout} from '@/components/layout/AuthLayout';
import {Button, ButtonLink} from '@/components/ui/Button';
import {Notice} from '@/components/ui/Notice';
import {DevLink} from './DevLink';

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');

function IconBadge({children}: {children: ReactNode}) {
  return (
    <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-violet/15 text-violet-soft shadow-glow">
      {children}
    </div>
  );
}

function Busy({label}: {label: string}) {
  return (
    <div className="flex flex-col items-center py-8 text-center" role="status">
      <Loader2 className="mb-4 h-7 w-7 animate-spin text-violet" aria-hidden />
      <p className="text-sm text-muted">{label}</p>
    </div>
  );
}

/** Resend button with its own sent and error messages, plus the mock-mode link. */
function ResendBlock() {
  const resend = useResendVerification();
  const [sentCount, setSentCount] = useState(0);
  return (
    <>
      {sentCount > 0 && !resend.isError ? (
        <Notice tone="success" className="mb-4">
          Sent. It can take a minute to arrive.
        </Notice>
      ) : null}
      {resend.isError ? (
        <Notice tone="error" className="mb-4">
          {errorText(resend.error)}
        </Notice>
      ) : null}
      <Button
        variant="secondary"
        size="lg"
        fullWidth
        loading={resend.isPending}
        onClick={() => resend.mutate(undefined, {onSuccess: () => setSentCount((n) => n + 1)})}
      >
        Resend email
      </Button>
      <DevLink kind="verify_email" label="Open the verification link" refreshKey={sentCount} />
    </>
  );
}

/** With ?token=… this confirms the email. Without it, it is the "check your inbox" screen. */
export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  // Keyed by token: a different link (for example after "Resend email") starts a fresh confirmation.
  return <AuthLayout>{token ? <ConfirmToken key={token} token={token} /> : <CheckInbox />}</AuthLayout>;
}

function ConfirmToken({token}: {token: string}) {
  const navigate = useNavigate();
  const verify = useVerifyEmail();
  const me = useMe();
  const user = me.data;
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return; // a one-time token must only be sent once
    started.current = true;
    verify
      .mutateAsync({token})
      .then(() => navigate('/app', {replace: true}))
      .catch((e) => setError(errorText(e)));
  }, [token, verify, navigate]);

  if (!error) return <Busy label="Confirming your email..." />;
  // Until we know whether someone is signed in, don't show the signed-out version of this screen.
  if (me.isPending) return <Busy label="Loading..." />;

  // An old link opened by someone whose email is already verified is not a problem.
  if (user?.emailVerified) {
    return (
      <>
        <IconBadge>
          <MailCheck className="h-6 w-6" aria-hidden />
        </IconBadge>
        <AuthHeading title="Your email is already verified" subtitle="There's nothing more to do." />
        <ButtonLink size="lg" fullWidth to="/app" replace>
          Go to ReelForge
        </ButtonLink>
      </>
    );
  }

  return (
    <>
      <IconBadge>
        <MailWarning className="h-6 w-6" aria-hidden />
      </IconBadge>
      <AuthHeading title="This link didn't work" subtitle={error} />
      {user ? (
        <ResendBlock />
      ) : (
        <ButtonLink size="lg" fullWidth to="/login" state={{from: '/verify'}}>
          Log in to get a new link
        </ButtonLink>
      )}
      <p className="mt-5 text-center text-sm">
        <Link to={user ? '/app' : '/login'} className="font-medium text-cyan hover:underline">
          {user ? 'Back to ReelForge' : 'Back to log in'}
        </Link>
      </p>
    </>
  );
}

function CheckInbox() {
  const navigate = useNavigate();
  const me = useMe();
  const user = me.data;
  const startAgain = useLogout('/signup');

  useEffect(() => {
    if (user?.emailVerified) navigate('/app', {replace: true});
  }, [user, navigate]);

  if (me.isPending) return <Busy label="Loading..." />;

  if (me.isError) {
    return (
      <>
        <AuthHeading title="We couldn't load your account" subtitle="Check your connection and try again." />
        <Button variant="secondary" size="lg" fullWidth loading={me.isFetching} onClick={() => void me.refetch()}>
          Try again
        </Button>
      </>
    );
  }

  return (
    <>
      <IconBadge>
        <MailCheck className="h-6 w-6" aria-hidden />
      </IconBadge>
      <AuthHeading
        title="Check your inbox"
        subtitle={user ? `We sent a verification link to ${user.email}.` : 'Log in to get a new verification link.'}
      />
      {user ? (
        <ResendBlock />
      ) : (
        <ButtonLink size="lg" fullWidth to="/login" state={{from: '/verify'}}>
          Log in
        </ButtonLink>
      )}
      {user ? (
        <p className="mt-5 text-center text-sm text-muted">
          Wrong email?{' '}
          <button
            type="button"
            className="font-medium text-cyan hover:underline disabled:opacity-60"
            disabled={startAgain.isPending}
            onClick={() => startAgain.mutate()}
          >
            Start again
          </button>
          {startAgain.isError ? (
            <span role="alert" className="mt-2 block text-bad">
              Couldn't sign you out. Try again.
            </span>
          ) : null}
        </p>
      ) : null}
    </>
  );
}
