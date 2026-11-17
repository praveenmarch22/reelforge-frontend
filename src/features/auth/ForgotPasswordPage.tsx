import {zodResolver} from '@hookform/resolvers/zod';
import {Mail, MailCheck} from 'lucide-react';
import {useState} from 'react';
import {useForm} from 'react-hook-form';
import {Link} from 'react-router-dom';
import {useForgotPassword} from '@/api/hooks';
import {AuthHeading, AuthLayout} from '@/components/layout/AuthLayout';
import {Button} from '@/components/ui/Button';
import {Input} from '@/components/ui/Input';
import {Notice} from '@/components/ui/Notice';
import {DevLink} from './DevLink';
import {applyApiError} from './formErrors';
import {forgotSchema, type ForgotValues} from './schemas';

export function ForgotPasswordPage() {
  const forgot = useForgotPassword();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const {register, handleSubmit, setError, formState} = useForm<ForgotValues>({
    resolver: zodResolver(forgotSchema),
    defaultValues: {email: ''},
  });

  const onSubmit = handleSubmit(async ({email}) => {
    setFormError(null);
    try {
      await forgot.mutateAsync({email});
      setSentTo(email);
    } catch (e) {
      setFormError(applyApiError(e, setError, ['email']));
    }
  });

  return (
    <AuthLayout>
      {sentTo ? (
        <>
          <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-violet/15 text-violet-soft shadow-glow">
            <MailCheck className="h-6 w-6" aria-hidden />
          </div>
          <AuthHeading
            title="Check your inbox"
            subtitle={`If an account exists for ${sentTo}, we sent a link to reset your password.`}
          />
          <DevLink kind="reset_password" label="Open the reset link" refreshKey={sentTo} />
        </>
      ) : (
        <>
          <AuthHeading title="Reset your password" subtitle="We'll email you a link to choose a new one." />
          {formError ? (
            <Notice tone="error" className="mb-4">
              {formError}
            </Notice>
          ) : null}
          <form onSubmit={onSubmit} noValidate className="space-y-4">
            <Input
              label="Email address"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              icon={Mail}
              error={formState.errors.email?.message}
              {...register('email')}
            />
            <Button type="submit" size="lg" fullWidth loading={forgot.isPending}>
              Send reset link
            </Button>
          </form>
        </>
      )}
      <p className="mt-6 text-center text-sm">
        <Link to="/login" className="font-medium text-cyan hover:underline">
          Back to log in
        </Link>
      </p>
    </AuthLayout>
  );
}
