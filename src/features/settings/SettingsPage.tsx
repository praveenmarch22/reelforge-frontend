import {Coins, Instagram, KeyRound, SlidersHorizontal, User as UserIcon, Youtube} from 'lucide-react';
import {useEffect, useState, type FormEvent} from 'react';
import {useSearchParams} from 'react-router-dom';
import {useChangePassword, useDeleteAccount, useDisconnect, useLedger} from '@/api/account';
import {ApiError} from '@/api/client';
import {useMe, useUpdateMe} from '@/api/hooks';
import {useCredits} from '@/api/projects';
import {useConnect} from '@/api/publishing';
import type {CaptionStyle, Mode, User} from '@/api/types';
import {PageHeader} from '@/components/layout/AppShell';
import {Button} from '@/components/ui/Button';
import {Chip} from '@/components/ui/Chip';
import {FullPageSpinner} from '@/components/ui/FullPageSpinner';
import {Input} from '@/components/ui/Input';
import {Notice} from '@/components/ui/Notice';
import {errorText} from '@/features/create/errors';
import {VoicePicker} from '@/features/create/VoicePicker';
import {cleanCustom, CUSTOM_MAX, joinNiche, MAX_NICHES, NICHE_LABELS, splitNiche} from '@/features/onboarding/niche';
import {ConnectionResult} from '@/features/publish/ConnectionResult';
import {cn} from '@/lib/cn';
import {tabKeys} from '@/lib/tabKeys';

const TABS = [
  {id: 'profile', label: 'Profile', icon: UserIcon},
  {id: 'defaults', label: 'Defaults', icon: SlidersHorizontal},
  {id: 'youtube', label: 'YouTube', icon: Youtube},
  {id: 'credits', label: 'Credits', icon: Coins},
  {id: 'security', label: 'Security', icon: KeyRound},
] as const;
type TabId = (typeof TABS)[number]['id'];

const CAPTION_STYLES: {value: CaptionStyle; label: string}[] = [
  {value: 'bold-pop', label: 'Bold pop'},
  {value: 'clean', label: 'Clean'},
  {value: 'neon', label: 'Neon'},
];
const COST_LABELS: Record<string, string> = {
  script: 'Writing a script',
  voicePer30s: 'Voiceover, per 30 s',
  voiceSceneShort: 'A new voice for one short scene',
  aiImage: 'An AI image',
  aiVideoClip: 'An AI video clip',
  render: 'Rendering a video',
  rewrite: 'Rewriting a scene',
  transcribe: 'Transcribing',
  ideas: 'Ideas',
  hooks: 'Opening-line ideas',
  caption: 'Post text',
  publish: 'Publishing',
};
const KIND_LABELS = {grant: 'Monthly credits', reserve: 'Used', refund: 'Given back', adjust: 'Adjusted by support'};

const date = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString(undefined, {day: 'numeric', month: 'long', year: 'numeric'}) : '';

/** Screen 14 (F8): settings, one tab at a time, the tab kept in the address. */
export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const me = useMe();
  const asked = params.get('tab');
  const tab: TabId = TABS.some((t) => t.id === asked) ? (asked as TabId) : asked === 'instagram' ? 'youtube' : 'profile';

  if (me.isPending) return <FullPageSpinner />;
  const user = me.data;
  if (!user) return null;

  const choose = (id: TabId) => {
    const next = new URLSearchParams(params);
    next.set('tab', id);
    setParams(next, {replace: true});
  };

  return (
    <>
      <ConnectionResult user={user} />
      <PageHeader title="Settings" />
      <div className="grid gap-6 md:grid-cols-[200px_1fr]">
        <div
          role="tablist"
          aria-label="Settings"
          className="flex gap-1 overflow-x-auto md:flex-col"
          onKeyDown={tabKeys(
            TABS.map((t) => t.id),
            tab,
            choose,
          )}
        >
          {TABS.map(({id, label, icon: Icon}) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`panel-${id}`}
              data-tab={id}
              tabIndex={tab === id ? 0 : -1}
              onClick={() => choose(id)}
              className={cn(
                'flex h-10 shrink-0 items-center gap-2 rounded-xl px-3 text-sm transition',
                tab === id ? 'bg-violet/20 text-white' : 'text-muted hover:bg-white/[0.06] hover:text-white',
              )}
            >
              <Icon className="h-4 w-4" aria-hidden /> {label}
            </button>
          ))}
        </div>
        <section role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="glass min-w-0 p-5 sm:p-6">
          {tab === 'profile' ? <ProfileTab user={user} /> : null}
          {tab === 'defaults' ? <DefaultsTab user={user} /> : null}
          {tab === 'youtube' ? <YouTubeTab user={user} /> : null}
          {tab === 'credits' ? <CreditsTab /> : null}
          {tab === 'security' ? <SecurityTab /> : null}
        </section>
      </div>
    </>
  );
}

function Saved({show}: {show: boolean}) {
  return show ? (
    <p role="status" className="text-sm text-emerald-300">
      Saved.
    </p>
  ) : null;
}

// ---------------------------------------------------------------- profile

function ProfileTab({user}: {user: User}) {
  const update = useUpdateMe();
  const start = splitNiche(user.niche);
  const [name, setName] = useState(user.name);
  const [chosen, setChosen] = useState<string[]>(start.chosen);
  const [custom, setCustom] = useState(start.custom);
  const [saved, setSaved] = useState(false);
  const count = chosen.length + (custom.trim() ? 1 : 0);

  const toggle = (label: string) => {
    setSaved(false);
    setChosen((c) => (c.includes(label) ? c.filter((x) => x !== label) : count < MAX_NICHES ? [...c, label] : c));
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    update.mutate({name: name.trim(), niche: joinNiche(chosen, custom)}, {onSuccess: () => setSaved(true)});
  };

  return (
    <form onSubmit={submit} className="max-w-xl space-y-5" noValidate>
      <h2 className="text-lg font-semibold">Profile</h2>
      <Input
        label="Name"
        value={name}
        maxLength={80}
        onChange={(e) => {
          setSaved(false);
          setName(e.target.value);
        }}
        error={name.trim() ? undefined : 'Enter your name'}
      />
      <div>
        <p className="mb-1.5 text-[13px] font-medium text-white/80">Email</p>
        <p className="text-sm text-muted">{user.email}</p>
      </div>
      <fieldset>
        <legend className="mb-1.5 text-[13px] font-medium text-white/80">
          What you post about <span className="text-muted">({count} of {MAX_NICHES})</span>
        </legend>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Topics">
          {NICHE_LABELS.map((label) => (
            <Chip
              key={label}
              active={chosen.includes(label)}
              onClick={() => toggle(label)}
              disabled={!chosen.includes(label) && count >= MAX_NICHES}
            >
              {label}
            </Chip>
          ))}
        </div>
        <Input
          className="mt-3"
          label="Something else"
          value={custom}
          maxLength={CUSTOM_MAX}
          disabled={!custom && count >= MAX_NICHES}
          onChange={(e) => {
            setSaved(false);
            setCustom(cleanCustom(e.target.value));
          }}
        />
      </fieldset>
      {update.isError ? <Notice tone="error">{errorText(update.error, 'Your profile wasn’t saved.')}</Notice> : null}
      <div className="flex items-center gap-3">
        <Button type="submit" loading={update.isPending} disabled={!name.trim()}>
          Save profile
        </Button>
        <Saved show={saved && !update.isPending} />
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- defaults

function DefaultsTab({user}: {user: User}) {
  const update = useUpdateMe();
  const [saved, setSaved] = useState(false);
  const save = (defaults: Partial<User['defaults']>) => {
    setSaved(false);
    update.mutate({defaults}, {onSuccess: () => setSaved(true)});
  };
  return (
    <div className="max-w-xl space-y-6">
      <h2 className="text-lg font-semibold">Defaults for new Reels</h2>
      <VoicePicker
        label="Narrator"
        value={user.defaults.voiceId}
        disabled={update.isPending}
        onChange={(voiceId) => save({voiceId})}
      />
      <fieldset>
        <legend className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted">Caption style</legend>
        <div className="flex flex-wrap gap-1.5">
          {CAPTION_STYLES.map((s) => (
            <Chip key={s.value} active={user.defaults.captionStyle === s.value} onClick={() => save({captionStyle: s.value})}>
              {s.label}
            </Chip>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted">Visual style</legend>
        <div className="flex flex-wrap gap-1.5">
          {(['faceless', 'full_ai'] as Mode[]).map((m) => (
            <Chip key={m} active={user.defaults.mode === m} onClick={() => save({mode: m})}>
              {m === 'faceless' ? 'Faceless' : 'Full AI'}
            </Chip>
          ))}
        </div>
      </fieldset>
      {update.isError ? <Notice tone="error">{errorText(update.error, 'That wasn’t saved.')}</Notice> : null}
      <Saved show={saved && !update.isPending} />
    </div>
  );
}

// ---------------------------------------------------------------- YouTube

function YouTubeTab({user}: {user: User}) {
  const connect = useConnect();
  const disconnect = useDisconnect();
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => e.persisted && setLeaving(false);
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);
  const channel = user.connections?.youtube ?? null;
  const go = () =>
    connect.mutate({platform: 'youtube', returnTo: '/app/settings?tab=youtube'}, {onSuccess: () => setLeaving(true)});
  const busy = connect.isPending || leaving;

  return (
    <div className="max-w-xl space-y-5">
      <h2 className="text-lg font-semibold">Publishing</h2>
      <div className="rounded-xl border border-line bg-white/[0.03] p-4">
        <p className="flex items-center gap-2 font-medium">
          <Youtube className="h-4 w-4 text-red-400" aria-hidden /> YouTube Shorts
        </p>
        {channel?.status === 'connected' ? (
          <>
            <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              {channel.pictureUrl ? (
                <img src={channel.pictureUrl} alt="" className="h-7 w-7 rounded-full" referrerPolicy="no-referrer" />
              ) : null}
              Connected as <span className="font-medium">{channel.name}</span>
              {channel.connectedAt ? <span className="text-muted"> since {date(channel.connectedAt)}</span> : null}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" loading={busy} onClick={go}>
                Change channel
              </Button>
              <Button
                variant="danger"
                size="sm"
                loading={disconnect.isPending}
                onClick={() =>
                  window.confirm('Disconnect YouTube? Your published Shorts stay on YouTube and in ReelForge.') &&
                  disconnect.mutate('youtube')
                }
              >
                Disconnect
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-muted">
              {channel?.status === 'reconnect_required'
                ? 'Your YouTube connection has expired. Connect again to keep publishing.'
                : 'Connect the channel to publish to. While ReelForge is in testing with Google, only accounts added as testers can connect.'}
            </p>
            <Button size="sm" className="mt-3" loading={busy} onClick={go}>
              {channel?.status === 'reconnect_required' ? 'Reconnect YouTube' : 'Connect YouTube'}
            </Button>
          </>
        )}
        {connect.isError ? (
          <Notice tone="error" className="mt-3">
            {errorText(connect.error, "Connecting YouTube couldn't start.")}
          </Notice>
        ) : null}
        {disconnect.isError ? (
          <Notice tone="error" className="mt-3">
            {errorText(disconnect.error, "YouTube couldn't be disconnected.")}
          </Notice>
        ) : null}
      </div>
      <div className="rounded-xl border border-line p-4 text-muted">
        <p className="flex items-center gap-2 font-medium">
          <Instagram className="h-4 w-4" aria-hidden /> Instagram Reels
        </p>
        <p className="mt-2 text-sm">Coming soon.</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- credits

function CreditsTab() {
  const info = useCredits();
  const ledger = useLedger();
  if (info.isPending) return <FullPageSpinner />;
  if (info.isError) return <Notice tone="error">{errorText(info.error, 'Your credits could not be loaded.')}</Notice>;
  const {balance, monthlyAllowance, resetsAt, costs} = info.data;
  const entries = ledger.data?.pages.flatMap((p) => p.items) ?? [];
  const share = monthlyAllowance ? Math.min(100, Math.round((balance / monthlyAllowance) * 100)) : 0;

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Credits</h2>
      <div>
        <p className="text-3xl font-semibold tabular-nums">
          {balance} <span className="text-base font-normal text-muted">of {monthlyAllowance} left</span>
        </p>
        <div
          className="mt-2 h-2 max-w-md overflow-hidden rounded-full bg-white/10"
          role="meter"
          aria-label="Credits left"
          aria-valuemin={0}
          aria-valuemax={monthlyAllowance}
          aria-valuenow={balance}
        >
          <div className="h-full rounded-full bg-brand" style={{width: `${share}%`}} />
        </div>
        <p className="mt-2 text-sm text-muted">Your credits renew on {date(resetsAt)}. Buying more isn't available yet.</p>
      </div>

      <div>
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted">What things cost</h3>
        <dl className="mt-2 grid max-w-md grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
          {Object.entries(costs).map(([key, cost]) => (
            <div key={key} className="contents">
              <dt className="text-white/80">{COST_LABELS[key] ?? key}</dt>
              <dd className="text-right tabular-nums">{cost === 0 ? 'Free' : `${cost} credit${cost === 1 ? '' : 's'}`}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div>
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted">History</h3>
        {ledger.isError ? <Notice tone="error">{errorText(ledger.error, 'The history could not be loaded.')}</Notice> : null}
        {entries.length ? (
          <table className="mt-2 w-full text-sm">
            <thead className="sr-only">
              <tr>
                <th>Date</th>
                <th>What</th>
                <th>Credits</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-line/60">
                  <td className="py-2 pr-3 text-muted">{date(e.createdAt)}</td>
                  <td className="py-2 pr-3">{e.note || KIND_LABELS[e.kind]}</td>
                  <td className={cn('py-2 text-right tabular-nums', e.amount > 0 ? 'text-emerald-300' : 'text-white/80')}>
                    {e.amount > 0 ? `+${e.amount}` : e.amount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : ledger.isPending || ledger.isError ? null : (
          <p className="mt-2 text-sm text-muted">Nothing yet.</p>
        )}
        {ledger.hasNextPage ? (
          <Button variant="secondary" size="sm" className="mt-3" loading={ledger.isFetchingNextPage} onClick={() => void ledger.fetchNextPage()}>
            Load more
          </Button>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- security

function SecurityTab() {
  const change = useChangePassword();
  const remove = useDeleteAccount();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [done, setDone] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const mismatch = again.length > 0 && next !== again;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!current || next.length < 8 || mismatch) return;
    setDone(false);
    change.mutate(
      {currentPassword: current, newPassword: next},
      {
        onSuccess: () => {
          setDone(true);
          setCurrent('');
          setNext('');
          setAgain('');
        },
      },
    );
  };
  const wrong = (e: unknown) => e instanceof ApiError && e.code === 'invalid_credentials';
  const fieldErrors = (e: unknown) =>
    e instanceof ApiError ? ((e.details?.fields ?? {}) as Record<string, string>) : ({} as Record<string, string>);

  return (
    <div className="max-w-xl space-y-8">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <h2 className="text-lg font-semibold">Change password</h2>
        <Input
          label="Current password"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          error={wrong(change.error) ? 'That isn’t your current password' : undefined}
        />
        <Input
          label="New password"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          error={fieldErrors(change.error).newPassword ?? (next && next.length < 8 ? 'Use at least 8 characters' : undefined)}
        />
        <Input
          label="New password again"
          type="password"
          autoComplete="new-password"
          value={again}
          onChange={(e) => setAgain(e.target.value)}
          error={mismatch ? 'The two passwords don’t match' : undefined}
        />
        {change.isError && !wrong(change.error) && !fieldErrors(change.error).newPassword ? (
          <Notice tone="error">{errorText(change.error, 'Your password wasn’t changed.')}</Notice>
        ) : null}
        {done ? <Notice tone="success">Password changed. You were signed out everywhere else.</Notice> : null}
        <Button type="submit" loading={change.isPending} disabled={!current || next.length < 8 || mismatch || !again}>
          Change password
        </Button>
      </form>

      <div className="space-y-3 rounded-xl border border-bad/40 p-4">
        <h2 className="text-lg font-semibold">Delete account</h2>
        <p className="text-sm text-muted">
          Your Reels, files and credits are deleted, and you're signed out everywhere. This can't be undone; everything is
          removed for good after 7 days. Shorts you published stay on YouTube.
        </p>
        <Input
          label="Password"
          type="password"
          autoComplete="off"
          value={deletePassword}
          onChange={(e) => setDeletePassword(e.target.value)}
          error={wrong(remove.error) ? 'That isn’t your password' : undefined}
        />
        {remove.isError && !wrong(remove.error) ? (
          <Notice tone="error">{errorText(remove.error, 'Your account wasn’t deleted.')}</Notice>
        ) : null}
        <Button
          variant="danger"
          loading={remove.isPending}
          disabled={!deletePassword}
          onClick={() =>
            window.confirm(
              'Delete your ReelForge account? You are signed out everywhere now, and your Reels, files and credits are removed for good after 7 days. This cannot be undone.',
            ) && remove.mutate({password: deletePassword})
          }
        >
          Delete my account
        </Button>
      </div>
    </div>
  );
}
