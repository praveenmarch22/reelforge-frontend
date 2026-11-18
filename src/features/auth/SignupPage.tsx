import {zodResolver} from '@hookform/resolvers/zod';
import {ArrowRight, Lock, Mail, User as UserIcon} from 'lucide-react';
import {useState} from 'react';
import {useForm} from 'react-hook-form';
import {Link, useNavigate} from 'react-router-dom';
import {ApiError} from '@/api/client';
import {useSignup} from '@/api/hooks';
import {AuthHeading, AuthLayout} from '@/components/layout/AuthLayout';
import {Button} from '@/components/ui/Button';
import {Input} from '@/components/ui/Input';
import {Notice} from '@/components/ui/Notice';
import {cn} from '@/lib/cn';
import {applyApiError} from './formErrors';
import {passwordStrength, signupSchema, type SignupValues} from './schemas';

const STRENGTH = [
  {label: '', bar: ''},
  {label: 'Weak', bar: 'bg-bad'},
  {label: 'Fair', bar: 'bg-warn'},
  {label: 'Good', bar: 'bg-cyan'},
  {label: 'Strong', bar: 'bg-ok'},
];

export function SignupPage() {
  const navigate = useNavigate();
  const signup = useSignup();
  const [formError, setFormError] = useState<string | null>(null);
  const [emailTaken, setEmailTaken] = useState(false);
  const {register, handleSubmit, setError, watch, formState} = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: {name: '', email: '', password: ''},
  });
  const strength = passwordStrength(watch('password'));

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    setEmailTaken(false);
    try {
      await signup.mutateAsync(values);
      navigate('/verify', {replace: true});
    } catch (e) {
      if (e instanceof ApiError && e.code === 'email_taken') {
        setEmailTaken(true);
        return;
      }
      setFormError(applyApiError(e, setError, ['name', 'email', 'password']));
    }
  });

  return (
    <AuthLayout>
      <AuthHeading title="Create your studio" subtitle="100 free credits every month." />
      {formError ? (
        <Notice tone="error" className="mb-4">
          {formError}
        </Notice>
      ) : null}
      {emailTaken ? (
        <Notice tone="error" className="mb-4">
          An account with this email already exists.{' '}
          <Link to="/login" className="font-semibold text-white underline underline-offset-2">
            Log in
          </Link>{' '}
          or{' '}
          <Link to="/forgot" className="font-semibold text-white underline underline-offset-2">
            reset your password
          </Link>
          .
        </Notice>
      ) : null}
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Input
          label="Name"
          autoComplete="name"
          placeholder="Your name"
          icon={UserIcon}
          error={formState.errors.name?.message}
          {...register('name')}
        />
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
            autoComplete="new-password"
            placeholder="At least 8 characters"
            icon={Lock}
            error={formState.errors.password?.message}
            {...register('password')}
          />
          <div className="mt-2 flex items-center gap-3" aria-live="polite">
            <div className="flex flex-1 gap-1.5">
              {[1, 2, 3, 4].map((step) => (
                <span
                  key={step}
                  className={cn('h-1 flex-1 rounded-full transition-colors', step <= strength ? STRENGTH[strength].bar : 'bg-white/10')}
                />
              ))}
            </div>
            <span className="w-12 text-right text-xs text-muted">{STRENGTH[strength].label}</span>
          </div>
        </div>
        <Button type="submit" size="lg" fullWidth loading={signup.isPending}>
          Create account <ArrowRight className="h-4 w-4" aria-hidden />
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-cyan hover:underline">
          Log in
        </Link>
      </p>
    </AuthLayout>
  );
}
