import type {ReactNode} from 'react';

/**
 * The heading of an onboarding step. OnboardingPage moves keyboard and screen-reader focus
 * here when the step changes, so the change of screen is noticed (it finds the heading by
 * its data-step-heading attribute).
 */
export function StepHeading({id, title, children}: {id: string; title: string; children?: ReactNode}) {
  return (
    <>
      <h1
        id={id}
        data-step-heading
        tabIndex={-1}
        className="text-center text-2xl font-semibold outline-none sm:text-[28px]"
      >
        {title}
      </h1>
      {children ? <p className="mt-2 text-center text-sm text-muted">{children}</p> : null}
    </>
  );
}
