import {Clapperboard, Home, LogOut, Settings, ShieldCheck, Youtube, type LucideIcon} from 'lucide-react';
import {useEffect, useRef, useState, type ReactNode} from 'react';
import {Link, NavLink, Outlet} from 'react-router-dom';
import {ApiError} from '@/api/client';
import {useLogout, useMe, useResendVerification} from '@/api/hooks';
import type {User} from '@/api/types';
import {Button} from '@/components/ui/Button';
import {LogoMark} from '@/components/ui/Logo';
import {cn} from '@/lib/cn';

function NavItem({to, label, icon: Icon, end}: {to: string; label: string; icon: LucideIcon; end?: boolean}) {
  return (
    <NavLink
      to={to}
      end={end}
      aria-label={label}
      className={({isActive}) =>
        cn(
          'group relative flex h-11 w-11 items-center justify-center rounded-xl transition',
          isActive ? 'bg-violet/20 text-white shadow-glow' : 'text-muted hover:bg-white/[0.06] hover:text-white',
        )
      }
    >
      <Icon className="h-5 w-5" aria-hidden />
      <span
        role="tooltip"
        className="pointer-events-none absolute left-full z-20 ml-3 whitespace-nowrap rounded-lg border border-line bg-ink-700 px-2.5 py-1 text-xs text-white opacity-0 shadow-card transition group-hover:opacity-100 group-focus-visible:opacity-100"
      >
        {label}
      </span>
    </NavLink>
  );
}

function UserMenu({user}: {user: User}) {
  const logout = useLogout();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 w-10 items-center justify-center rounded-full bg-brand font-display text-sm font-bold text-ink"
      >
        {(user.name || user.email).charAt(0).toUpperCase()}
      </button>
      {open ? (
        <div role="menu" className="absolute bottom-0 left-full z-20 ml-3 w-56 rounded-xl border border-line bg-ink-700 p-1.5 shadow-card">
          <div className="px-2.5 py-2">
            <p className="truncate text-sm font-medium">{user.name}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
          </div>
          <button
            type="button"
            role="menuitem"
            disabled={logout.isPending}
            onClick={() => logout.mutate()}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-white/80 hover:bg-white/[0.06] hover:text-white disabled:opacity-60"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden /> {logout.isPending ? 'Logging out...' : 'Log out'}
          </button>
          {logout.isError ? (
            <p role="alert" className="px-2.5 pb-1.5 pt-1 text-xs text-bad">
              Couldn't log out. Check your connection and try again.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CreditsPill({user}: {user: User}) {
  const {balance, monthlyAllowance} = user.credits;
  const fraction = monthlyAllowance > 0 ? Math.min(1, balance / monthlyAllowance) : 0;
  const circumference = 2 * Math.PI * 7;
  return (
    <Link
      to="/app/settings?tab=credits"
      className="flex h-9 items-center gap-2 rounded-full border border-line bg-white/[0.04] pl-2.5 pr-3.5 text-[13px] font-medium transition hover:bg-white/[0.08]"
      aria-label={`${balance} of ${monthlyAllowance} credits left`}
    >
      <svg viewBox="0 0 18 18" className="h-[18px] w-[18px] -rotate-90" aria-hidden>
        <circle cx="9" cy="9" r="7" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="2.5" />
        <circle
          cx="9"
          cy="9"
          r="7"
          fill="none"
          stroke="url(#credits-ring)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={`${circumference * fraction} ${circumference}`}
        />
        <defs>
          <linearGradient id="credits-ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#7C5CFF" />
            <stop offset="1" stopColor="#22D3EE" />
          </linearGradient>
        </defs>
      </svg>
      <span className="tabular-nums">{balance} credits</span>
    </Link>
  );
}

/** The publishing account (B6: YouTube first). Nothing shows until a channel is connected;
 * connecting happens on the publish screen. */
function ChannelPill({user}: {user: User}) {
  const youtube = user.connections?.youtube;
  if (!youtube) return null;
  return (
    <Link
      to="/app/settings?tab=youtube"
      className="hidden h-9 items-center gap-2 rounded-full border border-line bg-white/[0.04] px-3.5 text-[13px] font-medium transition hover:bg-white/[0.08] sm:flex"
    >
      <Youtube className="h-4 w-4 text-red-400" aria-hidden />
      {youtube.status === 'connected' ? (
        <>
          <span className="max-w-[10rem] truncate">{youtube.name}</span>
          <span className="h-1.5 w-1.5 rounded-full bg-ok" aria-label="Connected" />
        </>
      ) : (
        <span className="text-warn">Reconnect YouTube</span>
      )}
    </Link>
  );
}

/** The credits and channel pills alone, for screens with their own heading (New Reel, editors). */
export function TopBar({children}: {children?: ReactNode}) {
  const {data: user} = useMe();
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">{children}</div>
      {user ? (
        <div className="ml-auto flex items-center gap-2.5">
          <CreditsPill user={user} />
          <ChannelPill user={user} />
        </div>
      ) : null}
    </div>
  );
}

/** Title row used at the top of every app page, with the credits and channel pills on the right. */
export function PageHeader({title, children}: {title: ReactNode; children?: ReactNode}) {
  const {data: user} = useMe();
  return (
    <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
      <h1 className="min-w-0 max-w-full truncate text-2xl font-semibold">{title}</h1>
      <div className="flex items-center gap-2.5">
        {children}
        {user ? (
          <>
            <CreditsPill user={user} />
            <ChannelPill user={user} />
          </>
        ) : null}
      </div>
    </header>
  );
}

function VerifyBanner() {
  const resend = useResendVerification();
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-amber-100">
      <span>Verify your email to start creating Reels.</span>
      <span className="flex items-center gap-3">
        {resend.isSuccess ? <span className="text-ok">Sent</span> : null}
        {resend.isError ? (
          <span role="alert" className="text-bad">
            {resend.error instanceof ApiError ? resend.error.message : "Couldn't send. Try again."}
          </span>
        ) : null}
        <Button variant="secondary" size="sm" loading={resend.isPending} onClick={() => resend.mutate()}>
          Resend email
        </Button>
        <Link to="/verify" className="text-[13px] font-medium text-white underline underline-offset-2">
          Open
        </Link>
      </span>
    </div>
  );
}

export function AppShell() {
  const {data: user} = useMe();
  if (!user) return null;
  return (
    <div className="flex h-full">
      {/* z-30: the account menu and tooltips open over the page content, which has positioned cards. */}
      <aside className="sticky top-0 z-30 flex h-screen w-[72px] shrink-0 flex-col items-center border-r border-line bg-black/20 py-5">
        <Link to="/app" aria-label="ReelForge home">
          <LogoMark />
        </Link>
        <nav className="mt-8 flex flex-1 flex-col gap-2" aria-label="Main">
          <NavItem to="/app" end label="Home" icon={Home} />
          <NavItem to="/app/projects" label="Projects" icon={Clapperboard} />
          <NavItem to="/app/settings" label="Settings" icon={Settings} />
          {user.isAdmin ? <NavItem to="/admin" label="Admin" icon={ShieldCheck} /> : null}
        </nav>
        <UserMenu user={user} />
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1240px] px-6 py-7 sm:px-10">
          {!user.emailVerified ? <VerifyBanner /> : null}
          <Outlet />
        </div>
      </main>
    </div>
  );
}
