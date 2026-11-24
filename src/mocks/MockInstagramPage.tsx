import {Instagram} from 'lucide-react';
import {useState} from 'react';
import {useSearchParams} from 'react-router-dom';
import {Button} from '@/components/ui/Button';
import {Input} from '@/components/ui/Input';
import {Notice} from '@/components/ui/Notice';
import {finishInstagramConnect, type InstagramOutcome} from './db';

const CHOICES: {outcome: InstagramOutcome; label: string; variant: 'primary' | 'secondary'}[] = [
  {outcome: 'creator', label: 'Allow (Creator account)', variant: 'primary'},
  {outcome: 'business', label: 'Allow (Business account)', variant: 'secondary'},
  {outcome: 'personal_account', label: 'Allow, but this is a personal account', variant: 'secondary'},
  {outcome: 'denied', label: 'Deny the permissions', variant: 'secondary'},
  {outcome: 'not_tester', label: 'Account is not added as a tester', variant: 'secondary'},
];

/**
 * Mock mode only. Stands in for Instagram's own "allow ReelForge" screen so the connect
 * flow can be tried, including each way it can fail. The route exists only when mocks are on.
 */
export default function MockInstagramPage() {
  const state = useSearchParams()[0].get('state') ?? '';
  const [username, setUsername] = useState('your_handle');

  const choose = (outcome: InstagramOutcome) => {
    // The real backend does this in its callback (API F2), then redirects the browser.
    window.location.assign(finishInstagramConnect(state, outcome, username));
  };

  return (
    <main className="flex min-h-full items-center justify-center px-5 py-10">
      <div className="glass w-full max-w-[440px] p-7">
        <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10">
          <Instagram className="h-7 w-7" aria-hidden />
        </div>
        <h1 className="text-2xl font-semibold">Instagram (mock)</h1>
        <p className="mt-1.5 text-sm text-muted">ReelForge wants to publish Reels to your account.</p>
        <Notice tone="info" className="my-5">
          Mock mode: this page stands in for Instagram. Pick how the real one would answer.
        </Notice>
        <Input
          label="Instagram username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          maxLength={30}
          className="mb-5"
        />
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
