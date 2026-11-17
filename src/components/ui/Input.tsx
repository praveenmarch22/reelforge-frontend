import {Eye, EyeOff, type LucideIcon} from 'lucide-react';
import {forwardRef, useId, useState, type InputHTMLAttributes} from 'react';
import {cn} from '@/lib/cn';

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  icon?: LucideIcon;
};

/** Labelled text field. Password fields get a show/hide button. */
export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  {label, error, icon: Icon, type = 'text', className, id, ...rest},
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const errorId = `${inputId}-error`;
  const [visible, setVisible] = useState(false);
  const isPassword = type === 'password';

  return (
    <div className={className}>
      <label htmlFor={inputId} className="mb-1.5 block text-[13px] font-medium text-white/80">
        {label}
      </label>
      <div className="relative">
        {Icon ? (
          <Icon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
        ) : null}
        <input
          ref={ref}
          id={inputId}
          type={isPassword && visible ? 'text' : type}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={cn(
            'h-11 w-full rounded-xl border bg-black/30 text-sm text-white placeholder:text-white/30',
            'transition focus:border-violet focus:outline-none focus:ring-2 focus:ring-violet/30',
            Icon ? 'pl-10' : 'pl-3.5',
            isPassword ? 'pr-11' : 'pr-3.5',
            error ? 'border-bad/70' : 'border-line',
          )}
          {...rest}
        />
        {isPassword ? (
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
            className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted hover:text-white"
          >
            {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        ) : null}
      </div>
      {error ? (
        <p id={errorId} role="alert" className="mt-1.5 text-[13px] text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
});
