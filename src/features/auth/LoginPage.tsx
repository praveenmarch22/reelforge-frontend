import {zodResolver} from '@hookform/resolvers/zod';
import {ArrowRight, Lock, Mail} from 'lucide-react';
import {useState} from 'react';
import {useForm} from 'react-hook-form';
import {Link, useLocation, useNavigate} from 'react-router-dom';
import {useLogin} from '@/api/hooks';
import {AuthHeading, AuthLayout} from '@/components/layout/AuthLayout';
import {Button} from '@/components/ui/Button';
import {Input} from '@/components/ui/Input';
import {Notice} from '@/components/ui/Notice';
import {USE_MOCKS} from '@/lib/env';
import {applyApiError} from './formErrors';
import {loginSchema, type LoginValues} from './schemas';

type LocationState = {from?: string; notice?: string} | null;

export function LoginPage() {
  const navigate = useNavigate();
  const state = useLocation().state as LocationState;
  const login = useLogin();
  const [formError, setFormError] = useState<string | null>(null);
  const {register, handleSubmit, setError, setValue, formState} = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {email: '', password: ''},
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await login.mutateAsync(values);
      navigate(state?.from ?? '/app', {replace: true});
    } catch (e) {
      setFormError(applyApiError(e, setError, ['email', 'password']));
    }
  });

  const fillDemo = async () => {
    const {DEMO_EMAIL, DEMO_PASSWORD} = await import('@/mocks/db');
    setValue('email', DEMO_EMAIL);
    setValue('password', DEMO_PASSWORD);
  };

  return (
    <AuthLayout>
      <AuthHeading title="Welcome back" subtitle="Log in to keep creating." />
      {state?.notice ? (
        <Notice tone="success" className="mb-4">
          {state.notice}
        </Notice>
      ) : null}
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
        <div>
          <Input
            label="Password"
            type="password"
            autoComplete="current-password"
            placeholder="Your password"
            icon={Lock}
            error={formState.errors.password?.message}
            {...register('password')}
          />
          <div className="mt-2 text-right">
            <Link to="/forgot" className="text-[13px] font-medium text-cyan hover:underline">
              Forgot password?
            </Link>
          </div>
        </div>
        <Button type="submit" size="lg" fullWidth loading={login.isPending}>
          Log in <ArrowRight className="h-4 w-4" aria-hidden />
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        New here?{' '}
        <Link to="/signup" className="font-medium text-cyan hover:underline">
          Create an account
        </Link>
      </p>
      {USE_MOCKS ? (
        <Notice tone="info" className="mt-5">
          Mock mode: no backend is connected.{' '}
          <button type="button" onClick={fillDemo} className="font-semibold text-white underline underline-offset-2">
            Fill in the demo login
          </button>
        </Notice>
      ) : null}
    </AuthLayout>
  );
}
