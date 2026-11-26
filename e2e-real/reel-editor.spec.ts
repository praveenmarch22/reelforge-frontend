import {expect, test, type Page} from '@playwright/test';
import type {Project, Scene} from '../src/api/types';
import {answered, call, credits, draftProject, getProject, newCreator} from './helpers';

// Reel editor (docs/SCREENS_F5_F6.md section 3) against the real backend with mock AI providers.
// The mock voice makes WAV tones, the mock image a real JPEG, and the mock stock a fake MP4 header
// (so stock clips can't actually play in the browser). Markers in the text make the mocks fail:
// "[voice-fail]" in narration, "[image-fail]" in a visual prompt, "[no-stock]" in a stock query.
// The audio bar test needs tracks in the test stack's music library (`flask music-seed`, or any
// rows in music_tracks with a stored file); the mock providers don't cover music.

const sorted = (p: Project): Scene[] => [...p.scenes].sort((a, b) => a.position - b.position);
const busy = (s: string) => s === 'queued' || s === 'running';

/** Stock search thumbnails from the mock point at example.com; never let the browser go there. */
async function blockOutside(page: Page) {
  await page.route(/^https?:\/\/(example\.com|cdn\.pixabay\.com)\//, (route) => route.fulfill({status: 204, body: ''}));
}

async function patchScene(page: Page, id: string, body: Record<string, unknown>) {
  const res = await call(page, 'PATCH', `/scenes/${id}`, body);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

/** Waits until no job of the project is running and returns it. */
async function settled(page: Page, id: string): Promise<Project> {
  await expect
    .poll(async () => {
      const p = await getProject(page, id);
      return p.activeJobs.length === 0 && p.status !== 'generating' && !p.scenes.some((s) => busy(s.voiceStatus) || busy(s.visualStatus));
    }, {message: 'all jobs finished', timeout: 60_000})
    .toBe(true);
  return getProject(page, id);
}

/** A new creator with a drafted project; `prepare` may change scenes before Generate (B11). */
async function generatedProject(page: Page, prepare?: (scenes: Scene[]) => Promise<void>) {
  const user = await newCreator(page);
  const draft = await draftProject(page, 'Morning walks');
  if (prepare) await prepare(sorted(draft));
  const res = await call(page, 'POST', `/projects/${draft.id}/generate`, {});
  expect(res.status, JSON.stringify(res.body)).toBe(202);
  return {user, project: await settled(page, draft.id)};
}

/** All scenes as AI images, so every visual in the player is a real picture. */
const aiImages = (page: Page) => async (scenes: Scene[]) => {
  for (const s of scenes) await patchScene(page, s.id, {visualSource: 'ai_image'});
};

const sceneButton = (page: Page, n: number) => page.getByRole('button', {name: new RegExp(`^Scene ${n}:`)});
const tab = (page: Page, name: string) => page.getByRole('tab', {name, exact: true});
const sceneSaved = (page: Page, id: string) => answered(page, 'PATCH', new RegExp(`/api/v1/scenes/${id}$`));
const projectSaved = (page: Page, id: string) => answered(page, 'PATCH', new RegExp(`/api/v1/projects/${id}$`));
const timelineFetched = (page: Page, id: string) => answered(page, 'GET', new RegExp(`/api/v1/projects/${id}/timeline$`));

async function openEditor(page: Page, id: string) {
  await blockOutside(page);
  await page.goto(`/app/p/${id}/edit`);
  await expect(sceneButton(page, 1)).toBeVisible();
}

// ---------------------------------------------------------------- generate to ready

test('Generate on the Script editor opens the Reel editor, shows progress, then the ready Reel in the player', async ({page}) => {
  await newCreator(page);
  const draft = await draftProject(page, 'Morning walks');
  for (const s of draft.scenes) await patchScene(page, s.id, {visualSource: 'ai_image'});
  await blockOutside(page);
  await page.goto(`/app/p/${draft.id}/script`);
  await page.getByRole('button', {name: /generate reel/i}).click();
  await expect(page).toHaveURL(new RegExp(`/app/p/${draft.id}/edit$`));

  // Either the progress line is on screen while generating, or the run had already finished.
  const progress = page.getByRole('status').filter({hasText: /Making your Reel: \d+ of 8 parts ready/});
  const readyPill = page.getByText('Ready', {exact: true});
  await expect(progress.or(readyPill).first()).toBeVisible();
  await expect(readyPill).toBeVisible({timeout: 60_000});
  await expect(progress).toHaveCount(0);

  const p = await getProject(page, draft.id);
  expect(p.status).toBe('ready');
  const tl = (await call(page, 'GET', `/projects/${draft.id}/timeline`)).body;
  expect(tl.ready).toBe(true);
  await expect(page.getByText(`${tl.durationSeconds.toFixed(1)}s`, {exact: true})).toBeVisible();
  // No missing parts: no Generate missing; Render waits for F7.
  await expect(page.getByRole('button', {name: /generate missing/i})).toHaveCount(0);
  await expect(page.getByRole('button', {name: /render/i})).toBeDisabled();
});

test('the player is there with the timeline’s length, and selecting a scene moves it to that scene', async ({page}) => {
  const {project} = await generatedProject(page, aiImages(page));
  await openEditor(page, project.id);
  const tl = (await call(page, 'GET', `/projects/${project.id}/timeline`)).body;
  const total = Math.floor(tl.timeline.durationInFrames / tl.timeline.fps);
  const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const preview = page.getByRole('region', {name: 'Preview'});
  // Remotion's controls show "current / total".
  await preview.hover();
  await expect(preview.getByText(new RegExp(`0:00 / ${clock(total)}`))).toBeVisible();

  // Scene 3 starts at its startFrame: the player's clock moves there.
  const s3 = tl.timeline.scenes[2];
  await sceneButton(page, 3).click();
  await expect(sceneButton(page, 3)).toHaveAttribute('aria-current', 'true');
  await preview.hover();
  await expect(preview.getByText(new RegExp(`${clock(Math.floor(s3.startFrame / tl.timeline.fps))} / ${clock(total)}`))).toBeVisible();

  // The preview plays without errors (images and WAV voices from the test stack's storage).
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await preview.getByRole('button', {name: /play/i}).first().click();
  await expect.poll(async () => (await preview.getByText(/\d+:\d\d \/ /).first().textContent()) ?? '', {timeout: 10_000}).not.toMatch(
    new RegExp(`^${clock(Math.floor(s3.startFrame / tl.timeline.fps))} /`),
  );
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------- inspector saves

test('each inspector tab saves through the API, and the timeline is fetched again', async ({page}) => {
  const {project} = await generatedProject(page);
  const [, s2] = sorted(project);
  await openEditor(page, project.id);
  await sceneButton(page, 2).click();
  await expect(page.getByRole('heading', {name: 'Scene 02'})).toBeVisible();

  // Visual: prompt and stock words (saved when the field is left).
  const prompt = page.getByRole('textbox', {name: 'Visual prompt'});
  await prompt.fill('a sunrise over a quiet park');
  let saved = sceneSaved(page, s2.id);
  await prompt.blur();
  expect((await saved).status()).toBe(200);
  const words = page.getByRole('textbox', {name: 'Stock search words'});
  await words.fill('sunrise park');
  saved = sceneSaved(page, s2.id);
  await words.press('Tab');
  expect((await saved).status()).toBe(200);

  // Voice: narration (saved after typing stops) and mood.
  await tab(page, 'Voice').click();
  const narration = page.getByRole('textbox', {name: 'Narration'});
  await narration.click();
  await narration.press('End');
  saved = sceneSaved(page, s2.id);
  await narration.pressSequentially(' Every day.');
  expect((await saved).status()).toBe(200);
  await expect(page.getByRole('region', {name: 'Scene 2 settings'}).getByText('Saved')).toBeVisible();
  saved = sceneSaved(page, s2.id);
  await page.getByRole('combobox', {name: 'Delivery mood'}).selectOption('tense');
  expect((await saved).status()).toBe(200);
  // Narration and mood make the voice out of date.
  await expect(sceneButton(page, 2)).toContainText('Voice out of date');

  // Text: on-screen text; the player gets a new timeline with it.
  await tab(page, 'Text').click();
  const onScreen = page.getByRole('textbox', {name: 'On-screen text'});
  await onScreen.fill('WALK AT DAWN');
  saved = sceneSaved(page, s2.id);
  // The editor fetches B12 again by itself, and gets the new text (earlier edits may refetch first).
  const refetched = page.waitForResponse(async (r) => {
    if (r.request().method() !== 'GET' || !new RegExp(`/api/v1/projects/${project.id}/timeline$`).test(new URL(r.url()).pathname)) return false;
    const body = await r.json();
    return body.timeline.scenes.some((s: {id: string; onScreenText: string}) => s.id === s2.id && s.onScreenText === 'WALK AT DAWN');
  });
  await onScreen.blur();
  expect((await saved).status()).toBe(200);
  await refetched;

  const after = (await getProject(page, project.id)).scenes.find((s) => s.id === s2.id)!;
  expect(after).toMatchObject({
    visualPrompt: 'a sunrise over a quiet park',
    stockQuery: 'sunrise park',
    narration: `${s2.narration} Every day.`,
    mood: 'tense',
    onScreenText: 'WALK AT DAWN',
    voiceStatus: 'outdated',
    visualStatus: 'outdated',
  });

  // After a reload the editor shows what was saved.
  await page.reload();
  await sceneButton(page, 2).click();
  await expect(page.getByRole('textbox', {name: 'Visual prompt'})).toHaveValue('a sunrise over a quiet park');
  await expect(page.getByRole('button', {name: /Generate missing · \d+ credits?/})).toBeVisible();
});

// ---------------------------------------------------------------- regenerate

test('Regenerate voice shows its H1 cost, goes busy, finishes with a new take, and charges that cost', async ({page}) => {
  const {project} = await generatedProject(page);
  const [s1] = sorted(project);
  await openEditor(page, project.id);
  const before = await credits(page);
  await tab(page, 'Voice').click();
  const button = page.getByRole('button', {name: new RegExp(`Regenerate voice · ${before.costs.voiceSceneShort} credits?$`)});
  await expect(button).toBeVisible();
  const started = answered(page, 'POST', new RegExp(`/api/v1/scenes/${s1.id}/voice/regenerate$`));
  await button.click();
  const res = await started;
  expect(res.status()).toBe(202);
  expect(res.request().headers()['idempotency-key']).toBeTruthy();
  // While it runs the narration is locked (or it has already finished: the mock is fast).
  await expect
    .poll(async () => (await getProject(page, project.id)).scenes.find((s) => s.id === s1.id)!.voice?.assetId, {timeout: 30_000})
    .not.toBe(s1.voice?.assetId);
  await expect(page.getByRole('textbox', {name: 'Narration'})).toBeEnabled();
  await expect(sceneButton(page, 1)).toContainText('Voice ready');
  await expect.poll(async () => (await credits(page)).balance).toBe(before.balance - before.costs.voiceSceneShort);
});

test('Regenerate visual as an AI image costs an AI image (H1) and replaces the picture', async ({page}) => {
  const {project} = await generatedProject(page);
  const [s1] = sorted(project);
  await openEditor(page, project.id);
  const before = await credits(page);
  await expect(page.getByRole('button', {name: /Regenerate visual · free/})).toBeVisible();
  const saved = sceneSaved(page, s1.id);
  await page.getByRole('button', {name: 'AI image', exact: true}).click();
  expect((await saved).status()).toBe(200);
  const button = page.getByRole('button', {name: new RegExp(`Regenerate visual · ${before.costs.aiImage} credits?$`)});
  await expect(button).toBeVisible();
  const started = answered(page, 'POST', new RegExp(`/api/v1/scenes/${s1.id}/visual/regenerate$`));
  await button.click();
  expect((await started).status()).toBe(202);
  const done = await settled(page, project.id);
  const scene = done.scenes.find((s) => s.id === s1.id)!;
  expect(scene.visualStatus).toBe('ready');
  expect(scene.visual?.kind).toBe('image');
  expect(scene.visual?.assetId).not.toBe(s1.visual?.assetId);
  await expect(sceneButton(page, 1)).toContainText('visual ready');
  expect((await credits(page)).balance).toBe(before.balance - before.costs.aiImage);
});

test('CA-4: after fixing a caption word, a new voice asks first, and goes ahead once confirmed', async ({page}) => {
  const {project} = await generatedProject(page);
  const [s1] = sorted(project);
  await openEditor(page, project.id);
  await tab(page, 'Text').click();
  const word = page.getByRole('textbox', {name: 'Caption word 1'});
  // Round 2: caption words autosave (no Save button); leaving the word saves at once.
  const saved = sceneSaved(page, s1.id);
  await word.fill('Fixd');
  await word.blur();
  expect((await saved).status()).toBe(200);
  await expect(page.getByText(/Fixed by hand/)).toBeVisible();
  const fixed = (await getProject(page, project.id)).scenes.find((s) => s.id === s1.id)!;
  expect(fixed.wordsEdited).toBe(true);
  expect(fixed.words[0].text).toBe('Fixd');
  expect(fixed.words[0].start).toBe(s1.words[0].start); // times kept

  await tab(page, 'Voice').click();
  let asked = '';
  page.once('dialog', (d) => {
    asked = d.message();
    void d.dismiss();
  });
  await page.getByRole('button', {name: /Regenerate voice/}).click();
  await expect.poll(() => asked).toMatch(/caption words/i);
  expect((await getProject(page, project.id)).scenes.find((s) => s.id === s1.id)!.voice?.assetId).toBe(s1.voice?.assetId);

  page.once('dialog', (d) => void d.accept());
  const started = answered(page, 'POST', new RegExp(`/api/v1/scenes/${s1.id}/voice/regenerate$`));
  await page.getByRole('button', {name: /Regenerate voice/}).click();
  expect((await started).status()).toBe(202);
  const done = (await settled(page, project.id)).scenes.find((s) => s.id === s1.id)!;
  expect(done.wordsEdited).toBe(false);
  expect(done.words[0].text).not.toBe('Fixd');
});

// ---------------------------------------------------------------- failures

test('needs attention: failed voice and visual are marked; fixing the text and Retry makes just that scene', async ({page}) => {
  let failing: Scene[] = [];
  const {project} = await generatedProject(page, async (scenes) => {
    failing = scenes;
    await patchScene(page, scenes[1].id, {narration: `${scenes[1].narration} [voice-fail]`});
    await patchScene(page, scenes[2].id, {visualSource: 'ai_image', visualPrompt: 'a park at dawn [image-fail]'});
  });
  expect(project.status).toBe('needs_attention');
  await openEditor(page, project.id);
  await expect(page.getByText(/Some parts couldn't be made/)).toBeVisible();
  await expect(page.getByText('Needs attention', {exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Retry scene 2'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Retry scene 3'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Retry scene 1'})).toHaveCount(0);
  await expect(sceneButton(page, 2)).toContainText('Voice failed');
  await expect(sceneButton(page, 3)).toContainText('visual failed');

  // Retry: B11 with just this scene. The mock fails the same text again, so it goes back to failed.
  const retried = answered(page, 'POST', new RegExp(`/api/v1/projects/${project.id}/generate$`));
  await page.getByRole('button', {name: 'Retry scene 2'}).click();
  const res = await retried;
  expect(res.status()).toBe(202);
  expect(res.request().postDataJSON()).toEqual({sceneIds: [failing[1].id]});
  expect(res.request().headers()['idempotency-key']).toBeTruthy();
  const jobs = ((await res.json()) as {jobs: {sceneId: string; type: string}[]}).jobs;
  expect(jobs.map((j) => [j.sceneId, j.type])).toEqual([[failing[1].id, 'voice']]);
  await settled(page, project.id);
  await expect(page.getByRole('button', {name: 'Retry scene 2'})).toBeVisible();
  await expect(sceneButton(page, 2)).toContainText('Voice failed');

  // Change the text (the voice is then out of date, as C2 says) and generate again.
  await sceneButton(page, 2).click();
  await tab(page, 'Voice').click();
  await page.getByRole('textbox', {name: 'Narration'}).fill(failing[1].narration);
  const saved = sceneSaved(page, failing[1].id);
  await page.getByRole('textbox', {name: 'Narration'}).blur();
  expect((await saved).status()).toBe(200);
  await expect(sceneButton(page, 2)).toContainText('Voice out of date');
  await expect(page.getByRole('button', {name: 'Retry scene 2'})).toHaveCount(0);
  const generated = answered(page, 'POST', new RegExp(`/api/v1/projects/${project.id}/generate$`));
  await page.getByRole('button', {name: /Generate missing/}).click();
  expect((await generated).status()).toBe(202);
  await expect(sceneButton(page, 2)).toContainText('Voice ready', {timeout: 30_000});
  // Scene 3's visual still fails: the project still needs attention.
  const after = await settled(page, project.id);
  expect(after.scenes.find((s) => s.id === failing[2].id)!.visualStatus).toBe('failed');
  expect(after.status).toBe('needs_attention');
  await expect(page.getByRole('button', {name: 'Retry scene 3'})).toBeVisible();
});

// API B11/C7/C8: a failed part shows `failed` with `lastError`; the inspector shows that reason.
test('a scene whose voice failed shows why, even after its visual was made', async ({page}) => {
  let failing: Scene | undefined;
  const {project} = await generatedProject(page, async (scenes) => {
    failing = scenes[1];
    await patchScene(page, scenes[1].id, {narration: `${scenes[1].narration} [voice-fail]`});
  });
  const s2 = project.scenes.find((s) => s.id === failing!.id)!;
  expect(s2.voiceStatus).toBe('failed');
  expect(s2.visualStatus).toBe('ready');
  await openEditor(page, project.id);
  await sceneButton(page, 2).click();
  const jobs = (await call(page, 'GET', `/projects/${project.id}/jobs?limit=20`)).body.items as {sceneId: string; type: string; state: string; error: {message: string} | null}[];
  const failedJob = jobs.find((j) => j.sceneId === s2.id && j.type === 'voice' && j.state === 'failed');
  expect(failedJob?.error?.message, 'the failed voice job has a reason').toBeTruthy();
  expect(s2.lastError, 'B4 scene.lastError of the failed voice').toBe(failedJob!.error!.message);
  await expect(page.getByRole('region', {name: 'Scene 2 settings'}).getByText(failedJob!.error!.message)).toBeVisible();
});

test('no stock match: the scene gets an AI image instead, and the inspector says so', async ({page}) => {
  const {project} = await generatedProject(page, async (scenes) => {
    await patchScene(page, scenes[0].id, {stockQuery: '[no-stock] nothing at all'});
  });
  const s1 = sorted(project)[0];
  expect(s1.visualStatus).toBe('ready');
  expect(s1.visual?.stockFallback).toBe(true);
  await openEditor(page, project.id);
  await expect(page.getByText(/an AI image, because no stock clip fitted/)).toBeVisible();
});

// ---------------------------------------------------------------- stock search

test('stock search pages through results and a chosen clip becomes the scene’s visual (C9, C10)', async ({page}) => {
  const {project} = await generatedProject(page);
  const [s1] = sorted(project);
  await openEditor(page, project.id);
  await page.getByRole('button', {name: /search stock/i}).click();
  const panel = page.getByRole('region', {name: 'Stock search'});
  const results = panel.getByRole('list', {name: 'Stock results'}).getByRole('button');
  await expect(results.first()).toBeVisible();
  await expect(panel.getByText(/^Videos from /)).toBeVisible();
  const firstPage = await results.allTextContents();
  const more = answered(page, 'GET', new RegExp(`/api/v1/scenes/${s1.id}/stock-search$`));
  await panel.getByRole('button', {name: 'More'}).click();
  expect(new URL((await more).url()).searchParams.get('page')).toBe('2');
  await expect.poll(() => results.allTextContents()).not.toEqual(firstPage);

  const searched = answered(page, 'GET', new RegExp(`/api/v1/scenes/${s1.id}/stock-search$`));
  await panel.getByRole('textbox', {name: 'Search stock videos'}).fill('city lights');
  await panel.getByRole('button', {name: 'Search', exact: true}).click();
  const answer = await (await searched).json();
  expect(new URL((await searched).url()).searchParams.get('q')).toBe('city lights');
  const pick = answer.items[1];

  const selected = answered(page, 'POST', new RegExp(`/api/v1/scenes/${s1.id}/visual/select$`));
  await panel.getByRole('button', {name: new RegExp(`by ${pick.author}$`)}).click();
  const sel = await selected;
  expect(sel.status()).toBe(202);
  expect(sel.request().postDataJSON()).toEqual({stock: pick.providerId});
  const done = (await settled(page, project.id)).scenes.find((s) => s.id === s1.id)!;
  expect(done.visualStatus).toBe('ready');
  expect(done.visual?.sourceUrl).toBe(pick.pageUrl);
  // The clip in use is marked in the results.
  await expect(panel.getByRole('button', {name: new RegExp(`by ${pick.author}$`)})).toBeDisabled();
  await expect(page.getByRole('region', {name: 'Scene 1 settings'}).getByRole('link', {name: pick.author})).toBeVisible();
});

// ---------------------------------------------------------------- audio bar

test('audio bar changes reach the project’s settings and the timeline', async ({page}) => {
  const {project} = await generatedProject(page);
  await openEditor(page, project.id);
  const bar = page.getByRole('region', {name: 'Audio and captions'});

  let saved = projectSaved(page, project.id);
  await bar.getByRole('button', {name: 'Neon'}).click();
  expect((await saved).request().postDataJSON()).toEqual({settings: {captionStyle: 'neon'}});
  // The check boxes show the server's answer (they change once B5 has saved).
  const ducking = bar.getByRole('checkbox', {name: 'Lower the music while the voice speaks'});
  saved = projectSaved(page, project.id);
  await ducking.click();
  expect((await saved).request().postDataJSON()).toEqual({settings: {ducking: false}});
  await expect(ducking).not.toBeChecked();
  const captions = bar.getByRole('checkbox', {name: 'Show captions'});
  saved = projectSaved(page, project.id);
  await captions.click();
  expect((await saved).request().postDataJSON()).toEqual({settings: {showCaptions: false}});
  await expect(captions).not.toBeChecked();

  // A slider saves once it stops moving.
  saved = projectSaved(page, project.id);
  await bar.getByRole('slider', {name: 'Music volume'}).fill('0.5');
  expect((await saved).request().postDataJSON()).toEqual({settings: {musicVolume: 0.5}});

  // Music: mood, then a track from that mood's list (D4).
  saved = projectSaved(page, project.id);
  await bar.getByRole('combobox', {name: 'Music mood'}).selectOption('calm');
  expect((await saved).status()).toBe(200);
  const library = (await call(page, 'GET', '/music?mood=calm')).body.items as {id: string; title: string}[];
  expect(library.length).toBeGreaterThan(0);
  const track = bar.getByRole('combobox', {name: 'Music track'});
  await expect(track.locator(`option[value="${library[0].id}"]`)).toHaveText(new RegExp(`^${library[0].title}`));
  saved = projectSaved(page, project.id);
  // The editor fetches B12 again and gets the chosen track (an earlier change may refetch first).
  const refetched = page.waitForResponse(async (r) => {
    if (r.request().method() !== 'GET' || !new RegExp(`/api/v1/projects/${project.id}/timeline$`).test(new URL(r.url()).pathname)) return false;
    return (await r.json()).timeline.music?.trackId === library[0].id;
  });
  await track.selectOption(library[0].id);
  expect((await saved).request().postDataJSON()).toEqual({music: {trackId: library[0].id}});
  await refetched;
  await expect(bar.getByRole('button', {name: `Play ${library[0].title}`})).toBeVisible();

  const p = await getProject(page, project.id);
  expect(p.settings).toMatchObject({captionStyle: 'neon', ducking: false, showCaptions: false, musicVolume: 0.5});
  expect(p.musicMood).toBe('calm');
  expect(p.music).toEqual({trackId: library[0].id});
  const now = (await call(page, 'GET', `/projects/${project.id}/timeline`)).body.timeline;
  expect(now).toMatchObject({captionStyle: 'neon', showCaptions: false});
  expect(now.music.duckedVolume).toBe(now.music.volume); // ducking off

  await page.reload();
  await expect(bar.getByRole('button', {name: 'Neon'})).toHaveAttribute('aria-pressed', 'true');
  await expect(bar.getByRole('slider', {name: 'Music volume'})).toHaveValue('0.5');
});

// ---------------------------------------------------------------- length, leaving, layout, keyboard

test('a Reel over 90 s says to shorten it before rendering (tooLong)', async ({page}) => {
  await newCreator(page);
  const draft = await draftProject(page, 'Morning walks');
  const long = Array.from({length: 70}, (_, i) => `word${i}`).join(' '); // 28 s each
  for (const s of draft.scenes) await patchScene(page, s.id, {narration: long});
  const tl = (await call(page, 'GET', `/projects/${draft.id}/timeline`)).body;
  expect(tl.tooLong).toBe(true);
  await openEditor(page, draft.id);
  await expect(page.getByText(/over 90 s: shorten it before rendering/)).toBeVisible();
  await expect(page.getByText(new RegExp(`^${tl.durationSeconds.toFixed(1)}s`))).toBeVisible();
});

test('closing the tab with unsaved text warns', async ({page}) => {
  const {project} = await generatedProject(page);
  await openEditor(page, project.id);
  const box = page.getByRole('textbox', {name: 'Visual prompt'});
  await box.click();
  await box.pressSequentially(' and birds');
  const dialog = page.waitForEvent('dialog');
  await page.close({runBeforeUnload: true});
  const d = await dialog;
  expect(d.type()).toBe('beforeunload');
  await d.dismiss();
});

for (const [width, height] of [
  [375, 812],
  [1440, 900],
] as const) {
  test(`at ${width} px nothing runs off the side, and the layout fits`, async ({page}) => {
    await page.setViewportSize({width, height});
    const {project} = await generatedProject(page, aiImages(page));
    await openEditor(page, project.id);
    await expect(page.getByRole('region', {name: 'Preview'}).locator('canvas, video, img, div').first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'horizontal overflow in px').toBeLessThanOrEqual(0);
    const box = async (name: string, role: 'region' | 'complementary') => (await page.getByRole(role, {name}).boundingBox())!;
    const list = await box('Scene list', 'complementary');
    const preview = await box('Preview', 'region');
    const settings = await box('Scene 1 settings', 'region');
    if (width >= 1024) {
      // Three columns: scenes, player, inspector, side by side.
      expect(list.x + list.width).toBeLessThanOrEqual(preview.x + 1);
      expect(preview.x + preview.width).toBeLessThanOrEqual(settings.x + 1);
      expect(Math.abs(list.y - preview.y)).toBeLessThan(40);
    } else {
      // Stacked: the player first, then the scenes, then the inspector, each within the screen.
      expect(preview.y).toBeLessThan(list.y);
      expect(list.y).toBeLessThan(settings.y);
      for (const b of [list, preview, settings]) expect(b.x + b.width).toBeLessThanOrEqual(width + 0.5);
    }
    // Every part of the audio bar stays on screen.
    const bar = page.getByRole('region', {name: 'Audio and captions'});
    for (const el of await bar.locator('select, input, button').all()) {
      const b = await el.boundingBox();
      if (b) expect(b.x + b.width, await el.evaluate((e) => e.outerHTML.slice(0, 80))).toBeLessThanOrEqual(width + 0.5);
    }
  });
}

test('keyboard: scenes and inspector tabs work without a mouse', async ({page}) => {
  const {project} = await generatedProject(page);
  await openEditor(page, project.id);
  // Wait for the player first: when it appears it takes focus (BUG-068, tested separately below).
  await expect(page.getByRole('region', {name: 'Preview'}).getByRole('button', {name: 'Play video'})).toHaveCount(1);
  await sceneButton(page, 1).focus();
  await page.keyboard.press('Tab'); // scene 2 (no Retry buttons on a ready Reel)
  await expect(sceneButton(page, 2)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', {name: 'Scene 02'})).toBeVisible();
  // Round 2: the tabs are one Tab stop with arrow keys (WAI-ARIA tabs).
  await tab(page, 'Visual').focus();
  await page.keyboard.press('ArrowRight');
  await expect(tab(page, 'Voice')).toBeFocused();
  await expect(tab(page, 'Voice')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('textbox', {name: 'Narration'})).toBeVisible();
  await page.keyboard.press('End');
  await expect(tab(page, 'Text')).toBeFocused();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement?.getAttribute('role'))).not.toBe('tab');
  // No id is used twice on the page (two voice pickers are on it now).
  await tab(page, 'Voice').click();
  const dupes = await page.evaluate(() => {
    const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
    return ids.filter((id, i) => ids.indexOf(id) !== i);
  });
  expect(dupes).toEqual([]);
});

// ---------------------------------------------------------------- round 2 (FIX_LOG_F6)

test('BUG-064, the other way round: a failed visual keeps its reason after the voice is made', async ({page}) => {
  let target: Scene | undefined;
  const {project} = await generatedProject(page, async (scenes) => {
    target = scenes[2];
    await patchScene(page, scenes[2].id, {visualSource: 'ai_image', visualPrompt: 'a park at dawn [image-fail]'});
  });
  const s3 = project.scenes.find((s) => s.id === target!.id)!;
  expect(s3.visualStatus).toBe('failed');
  expect(s3.voiceStatus).toBe('ready');
  expect(s3.lastError).toBeTruthy();
  await openEditor(page, project.id);
  await sceneButton(page, 3).click();
  await expect(page.getByRole('region', {name: 'Scene 3 settings'}).getByText(s3.lastError!)).toBeVisible();
});

test('a stock clip that can’t play shows the preview error and Reload preview fetches the timeline again', async ({page}) => {
  // The mock stock "clip" is an MP4 header only, so the browser can't play it.
  const {project} = await generatedProject(page);
  await openEditor(page, project.id);
  const preview = page.getByRole('region', {name: 'Preview'});
  await preview.hover();
  await preview.getByRole('button', {name: /play/i}).first().click();
  await expect(preview.getByText("The preview couldn't load one of its files.")).toBeVisible({timeout: 20_000});
  const reload = preview.getByRole('button', {name: 'Reload preview'});
  await expect(reload).toBeVisible();
  const refetched = timelineFetched(page, project.id);
  await reload.click();
  expect((await refetched).status()).toBe(200);
});

test('caption fixes autosave as typed and are there after a reload', async ({page}) => {
  const {project} = await generatedProject(page);
  const [s1] = sorted(project);
  await openEditor(page, project.id);
  await tab(page, 'Text').click();
  const word = page.getByRole('textbox', {name: 'Caption word 2'});
  const saved = page.waitForResponse((r) => r.request().method() === 'PATCH' && new URL(r.url()).pathname.endsWith(`/scenes/${s1.id}`));
  await word.fill('fixd');
  const res = await saved; // after typing stops, without leaving the word
  expect(res.status()).toBe(200);
  expect(res.request().postDataJSON().words[1]).toEqual({text: 'fixd'});
  await expect(word).toBeFocused();
  await expect(page.getByText(/Fixed by hand/)).toBeVisible();
  await page.reload();
  await tab(page, 'Text').click();
  await expect(page.getByRole('textbox', {name: 'Caption word 2'})).toHaveValue('fixd');
});

test('dragging a scene in the list reorders the Reel (C5)', async ({page}) => {
  const {project} = await generatedProject(page);
  const before = sorted(project).map((s) => s.id);
  await openEditor(page, project.id);
  const reordered = answered(page, 'POST', new RegExp(`/api/v1/projects/${project.id}/scenes/reorder$`));
  await sceneButton(page, 3).dragTo(sceneButton(page, 1));
  expect((await reordered).status()).toBe(200);
  const after = sorted(await getProject(page, project.id)).map((s) => s.id);
  expect(after).toEqual([before[2], before[0], before[1], ...before.slice(3)]);
  await expect(sceneButton(page, 1)).toHaveAccessibleName(new RegExp(`^Scene 1: ${escape(sorted(project)[2].narration.slice(0, 20))}`));
});

test('changing the narrator asks first, then outdates every voice', async ({page}) => {
  const {project} = await generatedProject(page);
  const voiceList = (await call(page, 'GET', '/voices')).body.items as {id: string; name: string}[];
  await openEditor(page, project.id);
  const narrator = page.getByRole('region', {name: 'Audio and captions'}).getByRole('combobox', {name: 'Narrator'});
  await expect(narrator).toBeEnabled();
  const other = voiceList.find((v) => v.id !== (project.voiceId || voiceList[0].id))!;
  page.once('dialog', (d) => void d.dismiss());
  await narrator.selectOption(other.id);
  await expect(narrator).not.toHaveValue(other.id);
  expect((await getProject(page, project.id)).voiceId).toBe(project.voiceId);

  page.once('dialog', (d) => void d.accept());
  const saved = projectSaved(page, project.id);
  await narrator.selectOption(other.id);
  expect((await saved).request().postDataJSON()).toEqual({voiceId: other.id});
  await expect(narrator).toHaveValue(other.id);
  const after = await getProject(page, project.id);
  expect(after.scenes.every((s) => s.voiceStatus === 'outdated')).toBe(true);
  await expect(page.getByRole('button', {name: /Generate missing/})).toBeVisible();
});

test('scene rows show two lines of narration, and their screen-reader text stays inside the row', async ({page}) => {
  const {project} = await generatedProject(page, async (scenes) => {
    await patchScene(page, scenes[0].id, {narration: Array.from({length: 30}, (_, i) => `longword${i}`).join(' ')});
  });
  await openEditor(page, project.id);
  const row = page.getByRole('list', {name: 'Scenes'}).getByRole('listitem').first();
  const text = row.getByText(/^longword0 longword1/);
  const lines = await text.evaluate((el) => el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight));
  expect(lines).toBeLessThanOrEqual(2.05);
  for (const li of await page.getByRole('list', {name: 'Scenes'}).getByRole('listitem').all()) {
    const box = (await li.boundingBox())!;
    const sr = await li.locator('.sr-only').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({x: r.x, y: r.y, w: r.width, h: r.height})));
    for (const r of sr) {
      expect(r.y).toBeGreaterThanOrEqual(box.y - 1);
      expect(r.y + r.h).toBeLessThanOrEqual(box.y + box.height + 1);
    }
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

// ---------------------------------------------------------------- round 3 (FIX_LOG_F6, Round 3)

test('Back to the script sends text typed a moment ago before leaving (QF6-018)', async ({page}) => {
  const {project} = await generatedProject(page);
  const [s1] = sorted(project);
  await openEditor(page, project.id);
  const box = page.getByRole('textbox', {name: 'Visual prompt'});
  await box.click();
  await box.press('End');
  await box.pressSequentially(' at dawn');
  const saved = sceneSaved(page, s1.id);
  await page.getByRole('button', {name: 'Back to the script'}).click(); // well within the 0.8 s autosave delay
  expect((await saved).status()).toBe(200);
  await expect(page).toHaveURL(new RegExp(`/app/p/${project.id}/script$`));
  expect((await getProject(page, project.id)).scenes.find((s) => s.id === s1.id)!.visualPrompt).toBe(`${s1.visualPrompt} at dawn`);
});

// WCAG 2.4.3 / 3.2.1: focus must not move without the creator asking. Remotion's controls focus their
// Play button on mount and whenever playing starts or stops (spaceKeyToPlayOrPause, on by default).
test('the player does not take focus: not when it appears, not when the preview stops by itself', async ({page}) => {
  test.setTimeout(150_000);
  const {project} = await generatedProject(page, aiImages(page));
  // 1. The player appears while focus is on a scene (its timeline answer held back until then).
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  await page.route(/\/timeline$/, async (route) => {
    await gate;
    await route.continue();
  });
  await openEditor(page, project.id);
  await sceneButton(page, 1).focus();
  release();
  const preview = page.getByRole('region', {name: 'Preview'});
  await expect(preview.getByRole('button', {name: 'Play video'})).toHaveCount(1);
  await page.waitForTimeout(500); // let any focus change happen; the assertion is about what did NOT happen
  expect.soft(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'focus after the player appears').toMatch(/^Scene 1:/);

  // 2. Typing in a field while the preview plays to its end.
  await preview.hover();
  await preview.getByRole('button', {name: 'Play video'}).click();
  const box = page.getByRole('textbox', {name: 'Visual prompt'});
  await box.click();
  await box.press('End');
  await expect(preview.getByRole('button', {name: 'Play video'})).toHaveCount(1, {timeout: 30_000}); // it ended
  await page.keyboard.type(' later');
  expect.soft(await box.inputValue(), 'text typed after the preview ended').toMatch(/ later$/);
  await expect(box).toBeFocused();
});

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
