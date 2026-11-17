import {Heart, MessageCircle, Send} from 'lucide-react';
import type {ReactNode} from 'react';
import {Link} from 'react-router-dom';
import {thumbBackground} from '@/components/reels/thumb';
import {Logo} from '@/components/ui/Logo';
import {cn} from '@/lib/cn';

type PhoneCardProps = {caption: string; seed: string; delay: string; className?: string; glow?: boolean};

function PhoneCard({caption, seed, delay, className, glow}: PhoneCardProps) {
  return (
    // The outer element positions and tilts the card; the inner one floats.
    // (The float animation sets `transform`, so it can't share an element with the tilt.)
    <div className={cn('absolute w-[210px]', className)} aria-hidden>
     <div
      className={cn(
        'relative aspect-[9/16] animate-float overflow-hidden rounded-[28px] border border-white/15 shadow-card',
        glow && 'shadow-glow',
      )}
      style={{background: thumbBackground(seed), animationDelay: delay}}
     >
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/70" />
      <div className="absolute right-3 top-1/2 flex -translate-y-1/2 flex-col gap-3 text-white/80">
        <Heart className="h-4 w-4" />
        <MessageCircle className="h-4 w-4" />
        <Send className="h-4 w-4" />
      </div>
      <p
        className="absolute inset-x-4 bottom-12 font-display text-[22px] font-bold uppercase leading-6 text-white"
        style={{textShadow: '0 2px 12px rgba(0,0,0,0.8)'}}
      >
        {caption}
      </p>
      <div className="absolute inset-x-4 bottom-6 h-1 rounded-full bg-white/20">
        <div className="h-full w-2/5 rounded-full bg-brand" />
      </div>
     </div>
    </div>
  );
}

/** Two-column layout for the sign-in screens: floating Reels on the left, a glass card on the right. */
export function AuthLayout({children}: {children: ReactNode}) {
  return (
    <div className="grid min-h-full lg:grid-cols-[55fr_45fr]">
      <div className="relative hidden overflow-hidden lg:block">
        <Link to="/" className="absolute left-10 top-9 z-10" aria-label="ReelForge home">
          <Logo />
        </Link>
        <div className="absolute left-1/2 top-1/2 h-[30rem] w-[30rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet/25 blur-[120px]" />
        <div className="absolute left-1/2 top-1/2 h-[420px] w-[620px] -translate-x-1/2 -translate-y-1/2">
          <PhoneCard caption="Wait for it" seed="left" delay="-2s" className="left-0 top-10 -rotate-[8deg] opacity-80" />
          <PhoneCard caption="Did you know?" seed="right" delay="-4s" className="right-0 top-10 rotate-[8deg] opacity-80" />
          <PhoneCard caption="3 habits" seed="center" delay="0s" glow className="left-1/2 top-0 z-10 !w-[230px] -translate-x-1/2" />
        </div>
        <p className="absolute bottom-10 left-10 font-display text-lg text-white/80">
          Idea in. <span className="text-gradient font-semibold">Reel out.</span>
        </p>
      </div>

      <div className="flex min-h-full flex-col items-center justify-center px-5 py-10">
        <Link to="/" className="mb-8 lg:hidden" aria-label="ReelForge home">
          <Logo />
        </Link>
        <main className="glass w-full max-w-[420px] p-7 sm:p-8">{children}</main>
      </div>
    </div>
  );
}

export function AuthHeading({title, subtitle}: {title: string; subtitle?: string}) {
  return (
    <header className="mb-6">
      <h1 className="text-[26px] font-semibold leading-8">{title}</h1>
      {subtitle ? <p className="mt-1.5 text-sm text-muted">{subtitle}</p> : null}
    </header>
  );
}
