import {cn} from '@/lib/cn';

export function LogoMark({className}: {className?: string}) {
  return (
    <span
      className={cn('inline-flex h-9 w-9 items-center justify-center rounded-xl bg-brand shadow-glow', className)}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
        <path d="M13.5 2 5 13.5h5.5L9.5 22 19 9.5h-6L13.5 2Z" fill="#07070B" />
      </svg>
    </span>
  );
}

export function Logo({className}: {className?: string}) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark />
      <span className="font-display text-lg font-semibold tracking-tight">ReelForge</span>
    </span>
  );
}
