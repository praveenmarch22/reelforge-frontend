// Shapes from docs/API_DESIGN.md ("Shared objects") in the reelforge-backend repository. Keep the two in sync.

export type CaptionStyle = 'bold-pop' | 'clean' | 'neon';
export type Mode = 'faceless' | 'full_ai';

export type ProjectStatus =
  | 'scripting'
  | 'draft'
  | 'generating'
  | 'needs_attention'
  | 'ready'
  | 'rendering'
  | 'render_failed'
  | 'rendered'
  | 'posting'
  | 'post_failed'
  | 'posted';

export type Credits = {
  balance: number;
  monthlyAllowance: number;
  resetsAt: string;
};

export type InstagramStatus = {
  connected: boolean;
  username: string | null;
  status: 'connected' | 'expired' | 'revoked' | null;
  expiresAt: string | null;
};

export type User = {
  id: string;
  email: string;
  name: string;
  niche: string;
  emailVerified: boolean;
  defaults: {voiceId: string; captionStyle: CaptionStyle; mode: Mode};
  onboardingCompleted: boolean;
  isAdmin: boolean;
  credits: Credits;
  instagram: InstagramStatus;
};

export type ProjectSummary = {
  id: string;
  title: string;
  mode: Mode;
  status: ProjectStatus;
  targetSeconds: number;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  /** 0–100 while generating, rendering or posting; otherwise null. */
  progress: number | null;
  updatedAt: string;
};

export type ProjectList = {
  items: ProjectSummary[];
  nextCursor: string | null;
  counts: {total: number; posted: number};
};

export type ApiErrorBody = {
  error: {code: string; message: string; details?: Record<string, unknown>};
};
