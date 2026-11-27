import {Youtube} from 'lucide-react';
import {useState} from 'react';
import {useSearchParams} from 'react-router-dom';
import {Button} from '@/components/ui/Button';
import {Input} from '@/components/ui/Input';
import {Notice} from '@/components/ui/Notice';
import {finishYouTubeConnect, type YouTubeOutcome} from './db';

const CHOICES: {outcome: YouTubeOutcome; label: string; variant: 'primary' | 'secondary'}[] = [
  {outcome: 'allow', label: 'Allow', variant: 'primary'},
  {outcome: 'denied', label: 'Deny the permissions', variant: 'secondary'},
  {outcome: 'missing_permission', label: 'Allow, but untick "Manage your YouTube videos"', variant: 'secondary'},
  {outcome: 'no_channel', label: 'This account has no YouTube channel', variant: 'secondary'},
];

/**
 * Mock mode only. Stands in for Google's sign-in and consent screen so the YouTube connect flow
 * (F7) can be tried, including each way it can fail. The route exists only when mocks are on.
 */
export default function MockYouTubePage() {
  const state = useSearchParams()[0].get('state') ?? '';
  const [channel, setChannel] = useState('My Channel');
  const choose = (outcome: YouTubeOutcome) => window.location.assign(finishYouTubeConnect(state, outcome, channel));

  return (
    <main className="flex min-h-full items-center justify-center px-5 py-10">
      <div className="glass w-full max-w-[440px] p-7">
        <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10">
          <Youtube className="h-7 w-7" aria-hidden />
        </div>
        <h1 className="text-2xl font-semibold">Google (mock)</h1>
        <p className="mt-1.5 text-sm text-muted">ReelForge wants to upload videos to your YouTube channel.</p>
        <Notice tone="info" className="my-5">
          Mock mode: this page stands in for Google. Pick how the real one would answer.
        </Notice>
        <Input label="Channel name" value={channel} onChange={(e) => setChannel(e.target.value)} maxLength={100} className="mb-5" />
        <div className="space-y-2.5">
          {CHOICES.map(({outcome, label, variant}) => (
            <Button key={outcome} variant={variant} fullWidth onClick={() => choose(outcome)}>
              {label}
            </Button>
          ))}
        </div>
      </div>
    </main>
  );
}
