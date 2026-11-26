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

export type Voice = {
  id: string;
  name: string;
  provider: string;
  gender: string;
  accent: string;
  style: string;
  previewUrl: string;
};

/** Why connecting Instagram failed, from the `reason` query parameter after the redirect (API F2). */
export type InstagramErrorReason = 'personal_account' | 'denied' | 'not_tester' | 'failed';

export type ApiErrorBody = {
  error: {code: string; message: string; details?: Record<string, unknown>};
};

// ---------------------------------------------------------------- projects, scenes and jobs (F5, F6)

export type Mood =
  | 'calm'
  | 'joyful'
  | 'excited'
  | 'funny'
  | 'inspiring'
  | 'triumphant'
  | 'serious'
  | 'tense'
  | 'mysterious'
  | 'sad';
export type Tone = 'educational' | 'funny' | 'motivational' | 'storytelling' | 'dramatic';
export type VisualSource = 'stock' | 'ai_image' | 'ai_video' | 'upload';
export type PartStatus = 'missing' | 'outdated' | 'queued' | 'running' | 'ready' | 'failed';
export type JobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type Word = {text: string; start: number; end: number};

export type SceneVoice = {
  assetId: string;
  url: string;
  durationSeconds: number | null;
  provider: string;
  voiceId: string;
  estimatedTimings: boolean;
};

export type SceneVisual = {
  assetId: string;
  url: string;
  durationSeconds: number | null;
  kind: 'video' | 'image';
  thumbnailUrl: string | null;
  provider: string;
  author: string;
  sourceUrl: string;
  width: number | null;
  height: number | null;
  stockFallback: boolean;
};

export type Scene = {
  id: string;
  position: number;
  narration: string;
  onScreenText: string;
  visualPrompt: string;
  stockQuery: string;
  mood: Mood;
  visualSource: VisualSource;
  estimatedSeconds: number;
  voiceStatus: PartStatus;
  visualStatus: PartStatus;
  voice: SceneVoice | null;
  visual: SceneVisual | null;
  words: Word[];
  wordsEdited: boolean;
  trimStart: number;
  trimEnd: number | null;
  lastError: string | null;
};

export type Job = {
  id: string;
  type: string;
  projectId: string | null;
  sceneId: string | null;
  state: JobState;
  progress: number;
  provider: string | null;
  creditsReserved: number;
  creditsRefunded: boolean;
  error: {code: string; message: string} | null;
  output: Record<string, unknown> | null;
  queuedAt: string;
  finishedAt: string | null;
};

export type ProjectSettings = {
  captionStyle: CaptionStyle;
  showCaptions: boolean;
  voiceVolume: number;
  musicVolume: number;
  duckedVolume: number;
  ducking: boolean;
  transition: 'cut' | 'fade' | 'slide';
};

export type Project = ProjectSummary & {
  topic: string;
  tone: Tone;
  style: string;
  character: string;
  voiceId: string;
  musicMood: Mood;
  music: {trackId: string} | {assetId: string} | null;
  settings: ProjectSettings;
  estimatedSeconds: number;
  wordCount: number;
  timelineVersion: number;
  postCaption: string;
  hashtags: string[];
  scenes: Scene[];
  activeJobs: Job[];
  createdAt: string;
};

export type Estimate = {
  credits: number;
  balance: number;
  items: {type: string; count: number; credits: number}[];
};

export type Idea = {title: string; hook: string; angle: string};

export type CreditCosts = Record<
  'script' | 'voicePer30s' | 'voiceSceneShort' | 'aiImage' | 'aiVideoClip' | 'render' | 'ideas' | 'hooks' | 'rewrite',
  number
>;

export type CreditsInfo = Credits & {costs: CreditCosts};
