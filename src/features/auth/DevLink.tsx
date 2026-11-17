import {useEffect, useState} from 'react';
import {Link} from 'react-router-dom';
import {Notice} from '@/components/ui/Notice';
import {USE_MOCKS} from '@/lib/env';

/**
 * Mock mode only: the mock API can't send email, so this shows the link the email would contain.
 * Renders nothing against the real backend.
 */
export function DevLink({kind, label, refreshKey}: {kind: 'verify_email' | 'reset_password'; label: string; refreshKey?: unknown}) {
  const [link, setLink] = useState<string | null>(null);

  useEffect(() => {
    if (!USE_MOCKS) return;
    let cancelled = false;
    void import('@/mocks/db').then(({readDevLink}) => {
      if (!cancelled) setLink(readDevLink(kind));
    });
    return () => {
      cancelled = true;
    };
  }, [kind, refreshKey]);

  if (!USE_MOCKS || !link) return null;
  return (
    <Notice tone="info" className="mt-5">
      Mock mode: no email is sent.{' '}
      <Link to={link} className="font-semibold text-white underline underline-offset-2">
        {label}
      </Link>
    </Notice>
  );
}
