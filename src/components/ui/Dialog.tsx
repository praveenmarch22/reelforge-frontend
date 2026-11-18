import {useEffect, useId, useRef, type ReactNode} from 'react';

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
};

/** Modal built on the native <dialog>, which handles focus trapping and Escape. */
export function Dialog({open, onClose, title, description, children}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // click on the backdrop
      }}
      className="glass w-[min(26rem,calc(100vw-2rem))] bg-ink-700 p-0 text-white backdrop:bg-black/55 backdrop:backdrop-blur-sm"
    >
      <div className="p-6">
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        {description ? (
          <p id={descriptionId} className="mt-1.5 break-words text-sm text-muted [overflow-wrap:anywhere]">
            {description}
          </p>
        ) : null}
        <div className="mt-5">{children}</div>
      </div>
    </dialog>
  );
}
