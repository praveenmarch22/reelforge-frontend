import type {ReactNode} from 'react';
import {cn} from '@/lib/cn';

/** A pill-shaped toggle, as in the Stitch designs (length, mode, tone, mood). */
export function Chip({
  active,
  onClick,
  children,
  disabled,
  className,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'h-8 rounded-full border px-3.5 text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
        active ? 'border-violet bg-violet/20 text-white' : 'border-line bg-white/[0.03] text-muted hover:text-white',
        className,
      )}
    >
      {children}
    </button>
  );
}
