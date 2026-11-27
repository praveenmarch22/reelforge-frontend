import {useEffect, useState, type FormEvent} from 'react';
import {Navigate, useSearchParams} from 'react-router-dom';
import {
  useAddTrack,
  useAdjustCredits,
  useAdminJobs,
  useAdminMusic,
  useAdminStats,
  useAdminUser,
  useAdminUsers,
  useDeleteTrack,
  useProviders,
  useRetryJob,
  useSwitchProvider,
  useUpdateAdminUser,
  useUpdateTrack,
  useUsage,
  type Provider,
} from '@/api/admin';
import {useMe} from '@/api/hooks';
import {PageHeader} from '@/components/layout/AppShell';
import {Button} from '@/components/ui/Button';
import {Chip} from '@/components/ui/Chip';
import {FullPageSpinner} from '@/components/ui/FullPageSpinner';
import {Input} from '@/components/ui/Input';
import {Notice} from '@/components/ui/Notice';
import {errorText} from '@/features/create/errors';
import {MOODS} from '@/features/create/SceneCard';
import {cn} from '@/lib/cn';
import {tabKeys} from '@/lib/tabKeys';

const TABS = ['overview', 'users', 'jobs', 'providers', 'usage', 'music'] as const;
type TabId = (typeof TABS)[number];
const LABELS: Record<TabId, string> = {
  overview: 'Overview',
  users: 'Users',
  jobs: 'Jobs',
  providers: 'Providers',
  usage: 'Usage',
  music: 'Music',
};
const RETRYABLE = ['voice', 'visual'];
const JOB_PROVIDERS = ['', 'gemini', 'groq', 'elevenlabs', 'edge', 'pixabay', 'cloudflare', 'remotion', 'youtube'];
const JOB_STATES = ['', 'failed', 'queued', 'running', 'succeeded', 'cancelled'];
const JOB_TYPES = ['', 'script', 'ideas', 'hooks', 'rewrite_scene', 'caption', 'voice', 'visual', 'render', 'publish'];

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'}) : 'never';
const Badge = ({children, tone = 'muted'}: {children: string; tone?: 'muted' | 'bad' | 'ok'}) => (
  <span
    className={cn(
      'rounded-full px-2 py-0.5 text-[11px]',
      tone === 'bad' ? 'bg-bad/20 text-red-200' : tone === 'ok' ? 'bg-ok/20 text-emerald-200' : 'bg-white/10 text-white/70',
    )}
  >
    {children}
  </span>
);
const Failed = ({error, fallback}: {error: unknown; fallback: string}) => (
  <Notice tone="error" className="mt-3">
    {errorText(error, fallback)}
  </Notice>
);
const th = 'py-2 pr-3 text-left text-xs font-medium uppercase tracking-wider text-muted';
const td = 'py-2 pr-3 align-top';

/** Screen 16 (F8): the admin console. Admins only; the API refuses everyone else too. */
export function AdminPage() {
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const asked = params.get('tab') as TabId | null;
  const tab: TabId = asked && TABS.includes(asked) ? asked : 'overview';
  if (me.isPending) return <FullPageSpinner />;
  if (!me.data?.isAdmin) return <Navigate to="/app" replace />;

  return (
    <>
      <PageHeader title="Admin" />
      <div
        role="tablist"
        aria-label="Admin"
        className="mb-5 flex gap-1.5 overflow-x-auto"
        onKeyDown={tabKeys(TABS, tab, (id) => setParams({tab: id}, {replace: true}))}
      >
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`admin-tab-${id}`}
            aria-selected={tab === id}
            aria-controls="admin-panel"
            data-tab={id}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => setParams({tab: id}, {replace: true})}
            className={cn(
              'h-9 shrink-0 rounded-full px-4 text-sm transition',
              tab === id ? 'bg-violet/25 text-white ring-1 ring-violet/60' : 'text-muted hover:bg-white/[0.06] hover:text-white',
            )}
          >
            {LABELS[id]}
          </button>
        ))}
      </div>
      <section role="tabpanel" id="admin-panel" aria-labelledby={`admin-tab-${tab}`} className="glass min-w-0 p-5">
        {tab === 'overview' ? <Overview /> : null}
        {tab === 'users' ? <Users myId={me.data.id} /> : null}
        {tab === 'jobs' ? <Jobs /> : null}
        {tab === 'providers' ? <Providers /> : null}
        {tab === 'usage' ? <Usage /> : null}
        {tab === 'music' ? <Music /> : null}
      </section>
    </>
  );
}

function Overview() {
  const stats = useAdminStats();
  if (stats.isError) return <Failed error={stats.error} fallback="The numbers could not be loaded." />;
  const s = stats.data;
  const tiles: [string, number | undefined][] = [
    ['Users', s?.users],
    ['Reels', s?.projects],
    ['Failed jobs today', s?.failedJobsToday],
    ['Credits held by users', s?.creditsInCirculation],
  ];
  return (
    <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {tiles.map(([label, value]) => (
        <div key={label} className="rounded-xl border border-line bg-white/[0.03] p-4">
          <dt className="text-xs uppercase tracking-wider text-muted">{label}</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums">{value ?? '…'}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------- users

function Users({myId}: {myId: string}) {
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setQ(typed.trim()), 300);
    return () => clearTimeout(timer);
  }, [typed]);
  const users = useAdminUsers(q);
  const rows = users.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      <div className="min-w-0">
        <Input label="Search by email or name" value={typed} onChange={(e) => setTyped(e.target.value)} className="max-w-sm" />
        {users.isError ? <Failed error={users.error} fallback="The users could not be loaded." /> : null}
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={th}>User</th>
                <th className={th}>Credits</th>
                <th className={th}>Reels</th>
                <th className={th}>Last login</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className={cn('border-t border-line/60', openId === u.id && 'bg-violet/10')}>
                  <td className={td}>
                    <button type="button" className="text-left hover:underline" onClick={() => setOpenId(u.id)}>
                      <span className="font-medium">{u.email}</span>
                      <span className="block text-xs text-muted">{u.name}</span>
                    </button>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {u.isAdmin ? <Badge>Admin</Badge> : null}
                      {u.isTester ? <Badge>Tester</Badge> : null}
                      {u.disabled ? <Badge tone="bad">Disabled</Badge> : null}
                      {!u.emailVerified ? <Badge>Not verified</Badge> : null}
                    </span>
                  </td>
                  <td className={cn(td, 'tabular-nums')}>
                    {u.balance} / {u.monthlyAllowance}
                  </td>
                  <td className={cn(td, 'tabular-nums')}>{u.projectCount}</td>
                  <td className={cn(td, 'text-muted')}>{when(u.lastLoginAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && !users.isPending ? <p className="mt-3 text-sm text-muted">No users match.</p> : null}
        </div>
        {users.hasNextPage ? (
          <Button variant="secondary" size="sm" className="mt-3" loading={users.isFetchingNextPage} onClick={() => void users.fetchNextPage()}>
            Load more
          </Button>
        ) : null}
      </div>
      {openId ? <UserPanel key={openId} id={openId} isMe={openId === myId} /> : <p className="text-sm text-muted">Choose a user to see more.</p>}
    </div>
  );
}

function UserPanel({id, isMe}: {id: string; isMe: boolean}) {
  const detail = useAdminUser(id);
  const update = useUpdateAdminUser(id);
  const adjust = useAdjustCredits(id);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [allowance, setAllowance] = useState('');
  if (detail.isPending) return <p className="text-sm text-muted">Loading…</p>;
  if (detail.isError) return <Failed error={detail.error} fallback="This user could not be loaded." />;
  const u = detail.data;
  const flag = (key: 'isTester' | 'isAdmin' | 'disabled', label: string, value: boolean, locked = false) => (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={value}
        disabled={locked || update.isPending}
        onChange={(e) => {
          const next = e.target.checked;
          if (key !== 'isTester' && !window.confirm(`${next ? 'Set' : 'Remove'} "${label}" for ${u.email}?`)) return;
          update.mutate({[key]: next});
        }}
      />
      {label}
    </label>
  );
  const submitAdjust = (e: FormEvent) => {
    e.preventDefault();
    const n = Number(amount);
    if (!Number.isInteger(n) || n === 0 || !note.trim()) return;
    adjust.mutate({amount: n, note: note.trim()}, {onSuccess: () => (setAmount(''), setNote(''))});
  };

  return (
    <aside className="rounded-xl border border-line bg-white/[0.03] p-4" aria-label={`Details of ${u.email}`}>
      <h3 className="truncate font-semibold">{u.email}</h3>
      <p className="text-sm text-muted">
        {u.name} · joined {when(u.createdAt)}
      </p>
      <p className="mt-1 text-sm text-muted">YouTube: {u.youtube ? `${u.youtube.name} (${u.youtube.status})` : 'not connected'}</p>

      <div className="mt-4 space-y-1.5">
        {flag('isTester', 'Tester (more monthly credits)', u.isTester)}
        {flag('isAdmin', 'Admin', u.isAdmin, isMe)}
        {flag('disabled', 'Disabled (signed out, can’t log in)', u.disabled, isMe)}
      </div>
      {update.isError ? <Failed error={update.error} fallback="That wasn’t saved." /> : null}

      <form
        className="mt-4 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(allowance);
          if (allowance !== '' && Number.isInteger(n) && n >= 0) update.mutate({monthlyAllowance: n}, {onSuccess: () => setAllowance('')});
        }}
      >
        <Input label={`Monthly allowance (now ${u.monthlyAllowance})`} inputMode="numeric" value={allowance} onChange={(e) => setAllowance(e.target.value)} className="flex-1" />
        <Button type="submit" variant="secondary" disabled={allowance === ''} loading={update.isPending}>
          Set
        </Button>
      </form>

      <form className="mt-4 space-y-2" onSubmit={submitAdjust}>
        <p className="text-sm font-medium">Adjust credits (balance {u.balance})</p>
        <Input
          label="Amount (start with - to take away)"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace('−', '-'))}
          error={amount && (!Number.isInteger(Number(amount)) || Number(amount) === 0) ? 'Use a whole number other than 0' : undefined}
        />
        <p className="text-xs text-muted">The user sees the note in their credit history.</p>
        <Input label="Note (required)" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
        <Button type="submit" size="sm" loading={adjust.isPending} disabled={!Number.isInteger(Number(amount)) || Number(amount) === 0 || !note.trim()}>
          Adjust
        </Button>
        {adjust.isError ? <Failed error={adjust.error} fallback="The credits weren’t adjusted." /> : null}
      </form>

      <h4 className="mt-5 text-xs font-medium uppercase tracking-wider text-muted">Recent jobs</h4>
      <ul className="mt-1 space-y-1 text-[13px]">
        {u.recentJobs.slice(0, 8).map((j) => (
          <li key={j.id} className="flex justify-between gap-2">
            <span>{j.type}</span>
            <span className={j.state === 'failed' ? 'text-red-300' : 'text-muted'}>{j.state}</span>
          </li>
        ))}
        {!u.recentJobs.length ? <li className="text-muted">None yet.</li> : null}
      </ul>
    </aside>
  );
}

// ---------------------------------------------------------------- jobs

function Jobs() {
  const [state, setState] = useState('failed');
  const [type, setType] = useState('');
  const [provider, setProvider] = useState('');
  const jobs = useAdminJobs({state: state || undefined, type: type || undefined, provider: provider || undefined});
  const [retried, setRetried] = useState<string[]>([]);
  const retry = useRetryJob();
  const rows = jobs.data?.pages.flatMap((p) => p.items) ?? [];
  const select = 'h-9 rounded-lg border border-line bg-white/[0.04] px-2 text-sm [&>option]:bg-ink-700';
  return (
    <div>
      <div className="flex flex-wrap gap-3">
        <label className="text-sm">
          <span className="mr-2 text-muted">State</span>
          <select className={select} value={state} onChange={(e) => setState(e.target.value)}>
            {JOB_STATES.map((s) => (
              <option key={s} value={s}>
                {s || 'Any'}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mr-2 text-muted">Type</span>
          <select className={select} value={type} onChange={(e) => setType(e.target.value)}>
            {JOB_TYPES.map((s) => (
              <option key={s} value={s}>
                {s || 'Any'}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mr-2 text-muted">Provider</span>
          <select className={select} value={provider} onChange={(e) => setProvider(e.target.value)}>
            {JOB_PROVIDERS.map((s) => (
              <option key={s} value={s}>
                {s || 'Any'}
              </option>
            ))}
          </select>
        </label>
      </div>
      {jobs.isError ? <Failed error={jobs.error} fallback="The jobs could not be loaded." /> : null}
      {retry.isError ? <Failed error={retry.error} fallback="The job couldn’t be retried." /> : null}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={th}>When</th>
              <th className={th}>Job</th>
              <th className={th}>User</th>
              <th className={th}>Result</th>
              <th className={th}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((j) => (
              <tr key={j.id} className="border-t border-line/60">
                <td className={cn(td, 'whitespace-nowrap text-muted')}>{when(j.queuedAt)}</td>
                <td className={td}>
                  {j.type}
                  {j.provider ? <span className="block text-xs text-muted">{j.provider}</span> : null}
                </td>
                <td className={cn(td, 'max-w-[14rem] truncate')}>{j.userEmail}</td>
                <td className={td}>
                  <Badge tone={j.state === 'failed' ? 'bad' : j.state === 'succeeded' ? 'ok' : 'muted'}>{j.state}</Badge>
                  {j.error ? <span className="mt-1 block text-xs text-muted">{j.error.code}: {j.error.message}</span> : null}
                </td>
                <td className={td}>
                  {j.output?.retriedAs || retried.includes(j.id) ? (
                    <span className="text-xs text-muted">Retried</span>
                  ) : j.state === 'failed' && RETRYABLE.includes(j.type) ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={retry.isPending && retry.variables === j.id}
                      onClick={() => retry.mutate(j.id, {onSuccess: () => setRetried((r) => [...r, j.id])})}
                    >
                      Retry
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && !jobs.isPending ? <p className="mt-3 text-sm text-muted">No jobs match.</p> : null}
      </div>
      {jobs.hasNextPage ? (
        <Button variant="secondary" size="sm" className="mt-3" loading={jobs.isFetchingNextPage} onClick={() => void jobs.fetchNextPage()}>
          Load more
        </Button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- providers

function Providers() {
  const providers = useProviders();
  const change = useSwitchProvider();
  const toggle = (p: Provider) => {
    if (p.enabled) {
      const reason = window.prompt(`Why is ${p.name} being switched off? (shown to other admins)`);
      if (!reason?.trim()) return;
      change.mutate({name: p.name, enabled: false, reason: reason.trim()});
    } else change.mutate({name: p.name, enabled: true, reason: ''});
  };
  if (providers.isError) return <Failed error={providers.error} fallback="The providers could not be loaded." />;
  return (
    <div>
      <p className="text-sm text-muted">Switched off, jobs skip that provider and use the next one for the same work.</p>
      {change.isError ? <Failed error={change.error} fallback="The switch wasn’t saved." /> : null}
      <ul className="mt-3 divide-y divide-line/60">
        {(providers.data ?? []).map((p) => (
          <li key={p.name} className="flex flex-wrap items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {p.name} <span className="text-sm font-normal text-muted">· {p.purpose}</span>
              </p>
              <p className="text-xs text-muted">
                {p.callsToday} calls today
                {p.errorRateToday !== null ? ` · ${Math.round(p.errorRateToday * 100)}% failed` : ''}
                {!p.enabled && p.reason ? ` · off: ${p.reason}` : ''}
              </p>
            </div>
            <Badge tone={p.enabled ? 'ok' : 'bad'}>{p.enabled ? 'On' : 'Off'}</Badge>
            <Button size="sm" variant={p.enabled ? 'danger' : 'secondary'} loading={change.isPending && change.variables?.name === p.name} onClick={() => toggle(p)}>
              {p.enabled ? 'Switch off' : 'Switch on'}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- usage

function Usage() {
  const usage = useUsage();
  if (usage.isError) return <Failed error={usage.error} fallback="The usage could not be loaded." />;
  const rows = usage.data ?? [];
  return (
    <div className="overflow-x-auto">
      <p className="text-sm text-muted">The last 30 days, per day, provider and kind of job.</p>
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr>
            <th className={th}>Day</th>
            <th className={th}>Provider</th>
            <th className={th}>Job</th>
            <th className={th}>Calls</th>
            <th className={th}>Failed</th>
            <th className={th}>Credits</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.day}-${r.provider}-${r.jobType}`} className="border-t border-line/60 tabular-nums">
              <td className={td}>{r.day}</td>
              <td className={td}>{r.provider}</td>
              <td className={td}>{r.jobType}</td>
              <td className={td}>{r.calls}</td>
              <td className={cn(td, r.failures ? 'text-red-300' : '')}>{r.failures}</td>
              <td className={td}>{r.creditsCharged}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && !usage.isPending ? <p className="mt-3 text-sm text-muted">No usage in this period.</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------- music

const AUDIO_TYPES = ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg'];

/** The length of an audio file, read by the browser. */
function audioSeconds(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    const url = URL.createObjectURL(file);
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      Number.isFinite(audio.duration) && audio.duration > 0 ? resolve(audio.duration) : reject(new Error('unknown length'));
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('not audio'));
    };
    audio.src = url;
  });
}

function Music() {
  const tracks = useAdminMusic();
  const add = useAddTrack();
  const update = useUpdateTrack();
  const remove = useDeleteTrack();
  const [title, setTitle] = useState('');
  const [license, setLicense] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [moods, setMoods] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState('');
  const [fileKey, setFileKey] = useState(0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setProblem('');
    if (!file || !title.trim() || !license.trim() || !moods.length) return setProblem('Fill in the title, licence, at least one mood, and choose a file.');
    if (file.size > 30 * 1024 * 1024) return setProblem('That file is over 30 MB.');
    if (!AUDIO_TYPES.includes(file.type)) return setProblem('Use an MP3, WAV or OGG file.');
    let durationSeconds: number;
    try {
      durationSeconds = Math.round((await audioSeconds(file)) * 1000) / 1000;
    } catch {
      return setProblem('That file couldn’t be read as audio.');
    }
    add.mutate(
      {title: title.trim(), license: license.trim(), sourceUrl: sourceUrl.trim(), moods, file, durationSeconds},
      {
        onSuccess: () => {
          setTitle('');
          setLicense('');
          setSourceUrl('');
          setMoods([]);
          setFile(null);
          setFileKey((k) => k + 1); // empties the file box (QF8-006)
        },
      },
    );
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="min-w-0">
        {tracks.isError ? <Failed error={tracks.error} fallback="The library could not be loaded." /> : null}
        {update.isError ? <Failed error={update.error} fallback="That wasn’t saved." /> : null}
        {remove.isError ? <Failed error={remove.error} fallback="The track wasn’t deleted." /> : null}
        <ul className="divide-y divide-line/60">
          {(tracks.data ?? []).map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{t.title}</p>
                <p className="truncate text-xs text-muted">
                  {t.moods.join(', ')} · {Math.round(t.durationSeconds)} s · {t.license}
                </p>
              </div>
              <Badge tone={t.isActive ? 'ok' : 'muted'}>{t.isActive ? 'Active' : 'Off'}</Badge>
              <Button size="sm" variant="secondary" onClick={() => update.mutate({id: t.id, isActive: !t.isActive})}>
                {t.isActive ? 'Switch off' : 'Switch on'}
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => window.confirm(`Delete "${t.title}"? If a Reel uses it, it is switched off instead.`) && remove.mutate(t.id)}
              >
                Delete
              </Button>
            </li>
          ))}
        </ul>
        {!tracks.data?.length && !tracks.isPending ? <p className="text-sm text-muted">The library is empty.</p> : null}
      </div>

      <form onSubmit={(e) => void submit(e)} className="space-y-3 rounded-xl border border-line bg-white/[0.03] p-4" noValidate>
        <h3 className="font-semibold">Add a track</h3>
        <Input label="Title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        <Input label="Licence and credit line" value={license} maxLength={300} onChange={(e) => setLicense(e.target.value)} />
        <Input label="Source link (optional)" value={sourceUrl} maxLength={300} onChange={(e) => setSourceUrl(e.target.value)} />
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-medium text-white/80">Moods</legend>
          <div className="flex flex-wrap gap-1.5">
            {MOODS.map((m) => (
              <Chip key={m} active={moods.includes(m)} onClick={() => setMoods((c) => (c.includes(m) ? c.filter((x) => x !== m) : [...c, m]))} className="h-7 px-2.5 text-[12px] capitalize">
                {m}
              </Chip>
            ))}
          </div>
        </fieldset>
        <label className="block text-[13px] font-medium text-white/80">
          Audio file (MP3, WAV or OGG, up to 30 MB)
          <input
            type="file"
            key={fileKey}
            accept="audio/mpeg,audio/wav,audio/x-wav,audio/ogg"
            className="mt-1.5 block w-full text-sm text-muted"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        {problem ? <Notice tone="error">{problem}</Notice> : null}
        {add.isError ? <Notice tone="error">{errorText(add.error, 'The track wasn’t added.')}</Notice> : null}
        <Button type="submit" loading={add.isPending}>
          Add track
        </Button>
      </form>
    </div>
  );
}
