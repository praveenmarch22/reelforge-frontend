import {AlertCircle, CheckCircle2, Info} from 'lucide-react';
import type {ReactNode} from 'react';
import {cn} from '@/lib/cn';

type Tone = 'error' | 'success' | 'info';

const tones: Record<Tone, {box: string; Icon: typeof Info}> = {
  error: {box: 'border-bad/40 bg-bad/10 text-red-200', Icon: AlertCircle},
  success: {box: 'border-ok/40 bg-ok/10 text-emerald-200', Icon: CheckCircle2},
  info: {box: 'border-violet/40 bg-violet/10 text-violet-soft', Icon: Info},
};

export function Notice({tone = 'info', children, className}: {tone?: Tone; children: ReactNode; className?: string}) {
  const {box, Icon} = tones[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-[13px] leading-5', box, className)}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
