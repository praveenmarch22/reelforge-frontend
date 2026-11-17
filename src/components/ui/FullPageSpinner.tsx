import {Loader2} from 'lucide-react';

export function FullPageSpinner() {
  return (
    <div className="flex h-full items-center justify-center" role="status" aria-label="Loading">
      <Loader2 className="h-7 w-7 animate-spin text-violet" />
    </div>
  );
}
