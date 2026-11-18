import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter} from 'react-router-dom';
import {describe, expect, it, vi} from 'vitest';
import type {ProjectStatus, ProjectSummary} from '@/api/types';
import {projectHref, ReelCard} from './ReelCard';
import {STATUS, StatusPill} from './StatusPill';
import {formatDuration, thumbBackground} from './thumb';

const ALL_STATUSES: ProjectStatus[] = [
  'scripting',
  'draft',
  'generating',
  'needs_attention',
  'ready',
  'rendering',
  'render_failed',
  'rendered',
  'posting',
  'post_failed',
  'posted',
];

const project = (over: Partial<ProjectSummary> = {}): ProjectSummary => ({
  id: 'p1',
  title: 'Morning habits',
  mode: 'faceless',
  status: 'ready',
  targetSeconds: 30,
  durationSeconds: 31,
  thumbnailUrl: null,
  progress: null,
  updatedAt: '2026-11-11T09:30:00Z',
  ...over,
});

const renderCard = (p: ProjectSummary, onDelete?: (p: ProjectSummary) => void) =>
  render(
    <MemoryRouter future={{v7_startTransition: true, v7_relativeSplatPath: true}}>
      <ReelCard project={p} onDelete={onDelete} />
    </MemoryRouter>,
  );

describe('formatDuration', () => {
  it.each([
    [0, '0:00'],
    [5, '0:05'],
    [31, '0:31'],
    [60, '1:00'],
    [90, '1:30'],
    [31.4, '0:31'],
    [59.6, '1:00'],
  ])('formats %s seconds as %s', (seconds, text) => {
    expect(formatDuration(seconds)).toBe(text);
  });

  it('is empty when the length is not known yet', () => {
    expect(formatDuration(null)).toBe('');
  });
});

describe('thumbBackground', () => {
  it('gives the same artwork for the same Reel every time', () => {
    expect(thumbBackground('reel-1')).toBe(thumbBackground('reel-1'));
  });

  it('gives different Reels different artwork', () => {
    const ids = Array.from({length: 12}, (_, i) => `10000000-0000-4000-8000-00000000000${i}`);
    expect(new Set(ids.map(thumbBackground)).size).toBeGreaterThan(1);
  });

  it('returns a CSS gradient, including for an empty seed', () => {
    for (const seed of ['', 'x', 'a much longer seed with spaces']) {
      expect(thumbBackground(seed)).toMatch(/^radial-gradient\(.+linear-gradient\(.+\)$/);
      expect(thumbBackground(seed)).not.toMatch(/NaN|undefined/);
    }
  });
});

describe('status labels', () => {
  // PRD 5.9 D1: status shown as draft, generating, ready, rendering, rendered, posting, posted, failed.
  it.each([
    ['draft', 'Draft'],
    ['generating', 'Generating'],
    ['ready', 'Ready'],
    ['rendering', 'Rendering'],
    ['rendered', 'Rendered'],
    ['posting', 'Posting'],
    ['posted', 'Posted'],
    ['render_failed', 'Failed'],
    ['post_failed', 'Failed'],
  ] as [ProjectStatus, string][])('shows %s as "%s"', (status, label) => {
    render(<StatusPill status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('has a non-empty label for every status the API can return', () => {
    for (const status of ALL_STATUSES) expect(STATUS[status]?.label, status).toBeTruthy();
  });

  // API_DESIGN.md: progress is 0-100 while the status is scripting, generating, rendering or posting.
  it('marks exactly the in-progress statuses as busy', () => {
    const busy = ALL_STATUSES.filter((s) => STATUS[s].busy);
    expect(busy.sort()).toEqual(['generating', 'posting', 'rendering', 'scripting']);
  });
});

describe('projectHref', () => {
  // PRD flow 8: script step for a draft, editor for a generated project, result screen for a rendered or posted one.
  it.each([
    ['scripting', 'script'],
    ['draft', 'script'],
    ['generating', 'edit'],
    ['needs_attention', 'edit'],
    ['ready', 'edit'],
    ['rendering', 'edit'],
    ['render_failed', 'edit'],
    ['rendered', 'publish'],
    ['posting', 'publish'],
    ['post_failed', 'publish'],
    ['posted', 'publish'],
  ] as [ProjectStatus, string][])('opens a %s Reel at the %s step', (status, step) => {
    expect(projectHref(project({id: 'abc', status}))).toBe(`/app/p/abc/${step}`);
  });
});

describe('ReelCard', () => {
  it('shows the title, mode, length and status, and links to the Reel', () => {
    renderCard(project({status: 'rendered', mode: 'full_ai', durationSeconds: 58}));

    expect(screen.getByRole('heading', {name: 'Morning habits'})).toBeInTheDocument();
    expect(screen.getByText('Full AI')).toBeInTheDocument();
    expect(screen.getByText('0:58')).toBeInTheDocument();
    expect(screen.getByText('Rendered')).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'Open Morning habits'})).toHaveAttribute('href', '/app/p/p1/publish');
  });

  // PRD 5.9 D1: every project shows its length, also before it has been rendered.
  it.each(['scripting', 'draft', 'generating', 'needs_attention'] as ProjectStatus[])(
    'shows the target length on a %s Reel that has no real length yet',
    (status) => {
      renderCard(project({status, durationSeconds: null, targetSeconds: 60, progress: null}));

      expect(screen.getByText('~60s')).toBeInTheDocument();
      expect(screen.getByLabelText('Target length 60 seconds')).toBeInTheDocument();
    },
  );

  it('shows the real length, not the target, once it is known', () => {
    renderCard(project({durationSeconds: 31.4, targetSeconds: 30}));

    expect(screen.getByText('0:31')).toBeInTheDocument();
    expect(screen.queryByText('~30s')).not.toBeInTheDocument();
  });

  it('shows "Faceless" for faceless Reels', () => {
    renderCard(project());
    expect(screen.getByText('Faceless')).toBeInTheDocument();
  });

  it('shows a progress bar with the percentage while a Reel is generating', () => {
    renderCard(project({status: 'generating', progress: 58, durationSeconds: null}));

    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '58');
    expect(bar).toHaveAccessibleName('Generating 58%');
  });

  it('shows a progress bar at 0%', () => {
    renderCard(project({status: 'rendering', progress: 0}));
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });

  it('shows no progress bar once the Reel is no longer in progress', () => {
    renderCard(project({status: 'ready', progress: null}));
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('has no options menu when the Reel cannot be deleted from this screen', () => {
    renderCard(project());
    expect(screen.queryByRole('button', {name: /more options/i})).not.toBeInTheDocument();
  });

  it('asks to delete the Reel from its options menu', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    const p = project();
    renderCard(p, onDelete);

    await user.click(screen.getByRole('button', {name: 'More options for Morning habits'}));
    await user.click(screen.getByRole('menuitem', {name: 'Delete'}));

    expect(onDelete).toHaveBeenCalledWith(p);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes the options menu on Escape without deleting', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    renderCard(project(), onDelete);

    await user.click(screen.getByRole('button', {name: 'More options for Morning habits'}));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
  });
});
