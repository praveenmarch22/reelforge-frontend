import {Loader2} from 'lucide-react';
import {forwardRef, type ButtonHTMLAttributes} from 'react';
import {Link, type LinkProps} from 'react-router-dom';
import {cn} from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  fullWidth?: boolean;
};

const variants: Record<Variant, string> = {
  primary:
    'bg-brand text-ink font-semibold shadow-[0_8px_30px_-8px_rgba(124,92,255,0.7)] hover:brightness-110 active:brightness-95',
  secondary: 'border border-line bg-white/[0.05] text-white hover:bg-white/[0.09]',
  ghost: 'text-muted hover:bg-white/[0.06] hover:text-white',
  danger: 'border border-bad/40 bg-bad/10 text-bad hover:bg-bad/20',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] rounded-lg gap-1.5',
  md: 'h-10 px-4 text-sm rounded-xl gap-2',
  lg: 'h-12 px-6 text-[15px] rounded-xl gap-2',
};

type StyleProps = {variant?: Variant; size?: Size; fullWidth?: boolean; className?: string};

const buttonClass = ({variant = 'primary', size = 'md', fullWidth, className}: StyleProps) =>
  cn(
    'inline-flex select-none items-center justify-center whitespace-nowrap transition duration-150',
    variants[variant],
    sizes[size],
    fullWidth && 'w-full',
    className,
  );

/** A link that looks like a button. Use it for navigation, so it is one tab stop with the link role. */
export function ButtonLink({variant, size, fullWidth, className, ...rest}: StyleProps & LinkProps) {
  return <Link className={buttonClass({variant, size, fullWidth, className})} {...rest} />;
}

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  {variant = 'primary', size = 'md', loading, fullWidth, className, children, disabled, type = 'button', ...rest},
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex select-none items-center justify-center whitespace-nowrap transition duration-150',
        'disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        sizes[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
});
