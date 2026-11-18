import {zodResolver} from '@hookform/resolvers/zod';
import {Lock} from 'lucide-react';
import {useState} from 'react';
import {useForm} from 'react-hook-form';
import {Link, useNavigate, useSearchParams} from 'react-router-dom';
import {useResetPassword} from '@/api/hooks';
import {AuthHeading, AuthLayout} from '@/components/layout/AuthLayout';
import {Button, ButtonLink} from '@/components/ui/Button';
import {Input} from '@/components/ui/Input';
import {Notice} from '@/components/ui/Notice';
import {applyApiError} from './formErrors';
import {resetSchema, type ResetValues} from './schemas';

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const token = useSearchParams()[0].get('token');
  const reset = useResetPassword();
  const [formError, setFormError] = useState<string | null>(null);
  const {register, handleSubmit, setError, formState} = useForm<ResetValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: {password: '', confirm: ''},
  });

  const onSubmit = handleSubmit(async ({password}) => {
    if (!token) return;
    setFormError(null);
    try {
      await reset.mutateAsync({token, password});
      navigate('/login', {replace: true, state: {notice: 'Password updated. Log in with your new password.'}});
    } catch (e) {
      setFormError(applyApiError(e, setError, ['password']));
    }
  });

  if (!token) {
    return (
      <AuthLayout>
        <AuthHeading title="This link didn't work" subtitle="The reset link is missing or incomplete." />
        <ButtonLink size="lg" fullWidth to="/forgot">
          Get a new link
        </ButtonLink>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <AuthHeading title="Choose a new password" subtitle="Use at least 8 characters." />
      {formError ? (
        <Notice tone="error" className="mb-4">
          {formError}{' '}
          <Link to="/forgot" className="font-semibold text-white underline underline-offset-2">
            Get a new link
          </Link>
        </Notice>
      ) : null}
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Input
          label="New password"
          type="password"
          autoComplete="new-password"
          icon={Lock}
          error={formState.errors.password?.message}
          {...register('password')}
        />
        <Input
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          icon={Lock}
          error={formState.errors.confirm?.message}
          {...register('confirm')}
        />
        <Button type="submit" size="lg" fullWidth loading={reset.isPending}>
          Update password
        </Button>
      </form>
      <p className="mt-6 text-center text-sm">
        <Link to="/login" className="font-medium text-cyan hover:underline">
          Back to log in
        </Link>
      </p>
    </AuthLayout>
  );
}
