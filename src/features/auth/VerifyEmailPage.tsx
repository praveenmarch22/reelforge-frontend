import {Loader2, MailCheck, MailWarning} from 'lucide-react';
import {useEffect, useRef, useState, type ReactNode} from 'react';
import {Link, useNavigate, useSearchParams} from 'react-router-dom';
import {ApiError} from '@/api/client';
import {useLogout, useMe, useResendVerification, useVerifyEmail} from '@/api/hooks';
import {AuthHeading, AuthLayout} from '@/components/layout/AuthLayout';
import {Button} from '@/components/ui/Button';
import {Notice} from '@/components/ui/Notice';
import {DevLink} from './DevLink';

function IconBadge({children}: {children: ReactNode}) {
  return (
    <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-violet/15 text-violet-soft shadow-glow">
      {children}
    </div>
  );
}

/** With ?token=… this confirms the email. Without it, it is the "check your inbox" screen. */
export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  return <AuthLayout>{token ? <ConfirmToken token={token} /> : <CheckInbox />}</AuthLayout>;
}

function ConfirmToken({token}: {token: string}) {
  const navigate = useNavigate();
  const verify = useVerifyEmail();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return; // a one-time token must only be sent once
    started.current = true;
    verify
      .mutateAsync({token})
      .then(() => navigate('/app', {replace: true}))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.'));
  }, [token, verify, navigate]);

  if (!error) {
    return (
      <div className="flex flex-col items-center py-8 text-center" role="status">
        <Loader2 className="mb-4 h-7 w-7 animate-spin text-violet" aria-hidden />
        <p className="text-sm text-muted">Confirming your email...</p>
      </div>
    );
  }
  return (
    <>
      <IconBadge>
        <MailWarning className="h-6 w-6" aria-hidden />
      </IconBadge>
      <AuthHeading title="This link didn't work" subtitle={error} />
      <Link to="/verify">
        <Button size="lg" fullWidth>
          Get a new link
        </Button>
      </Link>
      <p className="mt-5 text-center text-sm">
        <Link to="/login" className="font-medium text-cyan hover:underline">
          Back to log in
        </Link>
      </p>
    </>
  );
}

function CheckInbox() {
  const navigate = useNavigate();
  const {data: user} = useMe();
  const resend = useResendVerification();
  const logout = useLogout();
  const [sentCount, setSentCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user?.emailVerified) navigate('/app', {replace: true});
  }, [user, navigate]);

  const onResend = async () => {
    setError(null);
    try {
      await resend.mutateAsync();
      setSentCount((n) => n + 1);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    }
  };

  return (
    <>
      <IconBadge>
        <MailCheck className="h-6 w-6" aria-hidden />
      </IconBadge>
      <AuthHeading
        title="Check your inbox"
        subtitle={user ? `We sent a verification link to ${user.email}.` : 'Log in to get a new verification link.'}
      />
      {sentCount > 0 ? (
        <Notice tone="success" className="mb-4">
          Sent. It can take a minute to arrive.
        </Notice>
      ) : null}
      {error ? (
        <Notice tone="error" className="mb-4">
          {error}
        </Notice>
      ) : null}
      {user ? (
        <Button variant="secondary" size="lg" fullWidth loading={resend.isPending} onClick={onResend}>
          Resend email
        </Button>
      ) : (
        <Link to="/login">
          <Button size="lg" fullWidth>
            Log in
          </Button>
        </Link>
      )}
      <DevLink kind="verify_email" label="Open the verification link" refreshKey={sentCount} />
      {user ? (
        <p className="mt-5 text-center text-sm text-muted">
          Wrong email?{' '}
          <button
            type="button"
            className="font-medium text-cyan hover:underline"
            onClick={() => logout.mutate(undefined, {onSuccess: () => navigate('/signup', {replace: true})})}
          >
            Start again
          </button>
        </p>
      ) : null}
    </>
  );
}
