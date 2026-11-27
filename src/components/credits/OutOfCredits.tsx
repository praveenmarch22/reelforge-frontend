import {useEffect, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {setInsufficientCreditsHandler} from '@/api/client';
import {Button} from '@/components/ui/Button';
import {Dialog} from '@/components/ui/Dialog';

type Details = {needed?: number; balance?: number; resetsAt?: string};

const renewal = (iso?: string) =>
  iso ? `on ${new Date(iso).toLocaleDateString(undefined, {day: 'numeric', month: 'long'})}` : 'at the start of next month';

/**
 * Screen 15 (F8): any action answered with 402 insufficient_credits opens this once, from wherever
 * it happened. The page that asked keeps its own inline message too.
 */
export function OutOfCredits() {
  const navigate = useNavigate();
  const [details, setDetails] = useState<Details | null>(null);
  useEffect(() => {
    setInsufficientCreditsHandler((d) => setDetails(d as Details));
    return () => setInsufficientCreditsHandler(null);
  }, []);
  if (!details) return null;
  const need = typeof details.needed === 'number' ? details.needed : null;
  const have = typeof details.balance === 'number' ? details.balance : null;
  return (
    <Dialog
      open
      onClose={() => setDetails(null)}
      title={have ? 'Not enough credits' : "You're out of credits"}
      description={`${need !== null ? `This needs ${need} credit${need === 1 ? '' : 's'}` : 'This needs more credits'}${
        have !== null ? ` and you have ${have}` : ''
      }. Your credits renew ${renewal(details.resetsAt)}. Stock clips are free: switching scenes from AI images to stock needs fewer credits.`}
    >
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setDetails(null)}>
          Close
        </Button>
        <Button
          onClick={() => {
            setDetails(null);
            navigate('/app/settings?tab=credits');
          }}
        >
          See my credits
        </Button>
      </div>
    </Dialog>
  );
}
