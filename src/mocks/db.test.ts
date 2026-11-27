import {afterEach, describe, expect, it, vi} from 'vitest';
import {
  createUser,
  finishInstagramConnect,
  listVoices,
  loadDb,
  OAUTH_STATE_MINUTES,
  RETURN_TO_MAX_LENGTH,
  safeReturnTo,
  saveDb,
  startInstagramConnect,
  toUser,
  type InstagramOutcome,
} from './db';

// The parts of the mock database that stand in for the backend in F4:
// the voice list (API D3) and the Instagram connect round trip (API F1, F2; PRD flow 2, IG-1, IG-11).
// src/test/setup.ts clears localStorage after each test, so every test starts from the seed data.

const APP_ORIGIN = 'http://app.test';
const NOT_CONNECTED = {connected: false, username: null, status: null, expiresAt: null};
const FAILED = '/app/settings?instagram=error&reason=failed';
const ASHA = {name: 'Asha Rao', email: 'asha@example.com', password: 'Asha-test-pass-1'};

/**
 * A new account, signed in, with a started "Connect Instagram" attempt, as F1 leaves it.
 * F2 honours a state only for the signed-in user who started it, so the session matters.
 */
function startConnect(returnTo = '/onboarding?step=3') {
  const db = loadDb();
  const user = createUser(db, ASHA);
  db.sessionUserId = user.id;
  const state = startInstagramConnect(db, user.id, returnTo);
  saveDb(db);
  return {userId: user.id, state};
}

/** Changes who is signed in on this browser (null: nobody). */
function signInAs(userId: string | null) {
  const db = loadDb();
  db.sessionUserId = userId;
  saveDb(db);
}

function instagramOf(userId: string) {
  const db = loadDb();
  return toUser(db, db.users.find((u) => u.id === userId)!).instagram;
}

describe('safeReturnTo (F1: returnTo must be a path inside the web app)', () => {
  it.each(['/onboarding?step=3', '/app/settings', '/app/settings?tab=instagram', '/app', '/'])('keeps the app path %s', (path) => {
    expect(safeReturnTo(path)).toBe(path);
  });

  it.each([
    ['a protocol-relative URL', '//evil.example'],
    ['a protocol-relative URL with a path', '//evil.example/onboarding'],
    ['three slashes', '///evil.example'],
    ['an absolute https URL', 'https://evil.example/onboarding'],
    ['an absolute http URL', 'http://evil.example'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a data: URL', 'data:text/html,hello'],
    ['a path without the leading slash', 'onboarding?step=3'],
    ['a space before the slash', ' /onboarding'],
    ['an empty string', ''],
    // Browsers read "\" as "/" and skip tabs and line breaks, so these are other spellings of "//evil.example".
    ['a backslash after the slash', '/\\evil.example'],
    ['a backslash then a slash', '/\\/evil.example'],
    ['two backslashes', '\\\\evil.example'],
    ['a backslash further along an otherwise good path', '/app\\settings'],
    ['a tab between two slashes', '/\t/evil.example'],
    ['a line feed between two slashes', '/\n/evil.example'],
    ['a carriage return between two slashes', '/\r/evil.example'],
    ['a tab inside an otherwise good path', '/onboarding\t?step=3'],
    ['a line feed at the end', '/onboarding?step=3\n'],
    ['a NUL character', '/app\u0000'],
    ['an escape character (U+001B)', '/app\u001b'],
    ['the last C0 control character (U+001F)', '/app\u001f'],
    ['a delete character (U+007F)', '/app\u007f'],
  ])('refuses %s and falls back to /app/settings', (_label, value) => {
    expect(safeReturnTo(value)).toBe('/app/settings');
  });

  it.each([null, undefined])('falls back to /app/settings for %s', (value) => {
    expect(safeReturnTo(value)).toBe('/app/settings');
  });

  it('accepts a return address of exactly 300 characters and refuses one of 301', () => {
    const ofLength = (length: number) => '/app/projects?q='.padEnd(length, 'x');

    expect(RETURN_TO_MAX_LENGTH).toBe(300); // the number in API F1
    expect(ofLength(300)).toHaveLength(300);
    expect(safeReturnTo(ofLength(300))).toBe(ofLength(300));
    expect(safeReturnTo(ofLength(301))).toBe('/app/settings');
    expect(safeReturnTo(ofLength(20_000))).toBe('/app/settings');
  });

  // The result is added to the query string. Inside a fragment the page would never see it.
  it.each([
    ['/app#frag', '/app'],
    ['/onboarding?step=3#instagram', '/onboarding?step=3'],
    ['/app/settings#a?instagram=connected', '/app/settings'],
    ['/app#', '/app'],
  ])('drops the #fragment: %s becomes %s', (value, expected) => {
    expect(safeReturnTo(value)).toBe(expected);
  });

  // A result that is already in the return address must not survive to be read as the real one.
  it.each([
    ['/onboarding?step=3&instagram=connected', '/onboarding?step=3'],
    ['/onboarding?instagram=connected&step=3', '/onboarding?step=3'],
    ['/onboarding?step=3&instagram=error&reason=denied', '/onboarding?step=3'],
    ['/app/settings?instagram=connected', '/app/settings'],
    ['/app/settings?reason=failed&instagram=error&instagram=connected', '/app/settings'],
    ['/app/settings?tab=instagram&reason=denied', '/app/settings?tab=instagram'],
  ])('removes instagram and reason parameters that are already there: %s becomes %s', (value, expected) => {
    expect(safeReturnTo(value)).toBe(expected);
  });

  /** The address is one a browser would follow to a page of the app itself. */
  const expectInsideTheApp = (result: string, given: string) => {
    const label = `${JSON.stringify(given)} gave ${JSON.stringify(result)}`;
    expect(result.startsWith('/') && !result.startsWith('//'), label).toBe(true);
    expect(new URL(result, APP_ORIGIN).origin, label).toBe(APP_ORIGIN);
  };

  it.each([
    '/\\evil.example',
    '/\t/evil.example',
    '/\n/evil.example',
    '/%5Cevil.example',
    '/%2F%2Fevil.example',
    '/@evil.example',
    '/?returnTo=//evil.example',
    '/x:y@evil.example',
  ])('the result for %j is a path that stays inside the app', (value) => {
    expectInsideTheApp(safeReturnTo(value), value);
  });

  // "/./" and "/../" are removed when an address is resolved, so "/.//evil.example" resolves to the
  // path "//evil.example". Handed to a browser as it stands, that is the site evil.example.
  it.each([
    '/.//evil.example',
    '/..//evil.example',
    '/app/..//evil.example',
    '/%2e//evil.example',
    '/.///evil.example',
  ])('the result for %j, where dot segments hide a double slash, is a path that stays inside the app', (value) => {
    expectInsideTheApp(safeReturnTo(value), value);
  });

  it('gives the same result when it is applied to its own result', () => {
    for (const value of ['/onboarding?step=3', '/app#frag', '/app/settings?instagram=connected', '/app/./projects/../settings?a=1']) {
      const once = safeReturnTo(value);
      expect(safeReturnTo(once), `${JSON.stringify(value)} gave ${JSON.stringify(once)}`).toBe(once);
    }
  });
});

describe('startInstagramConnect (F1: the state carries the user and the sanitised returnTo)', () => {
  const pendingFor = (state: string) => (loadDb().oauthStates ?? []).find((s) => s.state === state)!;

  it('stores the sanitised return address, not the value it was given', () => {
    expect(pendingFor(startConnect('/onboarding?step=3&instagram=connected#top').state).returnTo).toBe('/onboarding?step=3');
  });

  it.each(['//evil.example', '/\\evil.example', '/\t/evil.example', `/${'x'.repeat(300)}`])(
    'stores the default instead of the refused return address %j',
    (returnTo) => {
      expect(pendingFor(startConnect(returnTo).state).returnTo).toBe('/app/settings');
    },
  );

  // What F1 stores is what F2 redirects to; a value that names another site must never be stored.
  it.each(['/.//evil.example', '/app/..//evil.example'])('never stores an address that leads off the site: %j', (returnTo) => {
    const stored = pendingFor(startConnect(returnTo).state).returnTo;

    expect(stored.startsWith('//'), `stored ${JSON.stringify(stored)}`).toBe(false);
    expect(new URL(stored, APP_ORIGIN).origin, `stored ${JSON.stringify(stored)}`).toBe(APP_ORIGIN);
  });

  it.each(['/.//evil.example', '/..//evil.example', '/app/..//evil.example', '/%2e//evil.example', '/\\evil.example', '/\t/evil.example'])(
    'the whole round trip with the return address %j ends on a page of the app',
    (returnTo) => {
      const destination = finishInstagramConnect(startConnect(returnTo).state, 'creator', 'asha_creates');

      expect(destination.startsWith('//'), destination).toBe(false);
      expect(new URL(destination, APP_ORIGIN).origin, destination).toBe(APP_ORIGIN);
    },
  );

  it("a new attempt replaces the same user's earlier one, which then no longer works", () => {
    const {userId, state: first} = startConnect();
    const db = loadDb();
    const second = startInstagramConnect(db, userId, '/onboarding?step=3');
    saveDb(db);

    expect(second).not.toBe(first);
    expect(finishInstagramConnect(first, 'creator', 'asha_creates')).toBe(FAILED);
    expect(instagramOf(userId)).toEqual(NOT_CONNECTED);
    expect(finishInstagramConnect(second, 'creator', 'asha_creates')).toBe('/onboarding?step=3&instagram=connected');
  });
});

describe('finishInstagramConnect (F2: what the callback does)', () => {
  it.each<[InstagramOutcome]>([['creator'], ['business']])(
    'a %s account is connected and the browser returns with instagram=connected',
    (outcome) => {
      const {userId, state} = startConnect();

      const destination = finishInstagramConnect(state, outcome, 'asha_creates');

      expect(destination).toBe('/onboarding?step=3&instagram=connected');
      const instagram = instagramOf(userId);
      expect(instagram).toMatchObject({connected: true, username: 'asha_creates', status: 'connected'});
      // A long-lived token lasts about 60 days (PRD flow 2).
      const days = (new Date(instagram.expiresAt!).getTime() - Date.now()) / 864e5;
      expect(days).toBeGreaterThan(50);
      expect(days).toBeLessThan(70);
    },
  );

  it.each<[InstagramOutcome]>([['personal_account'], ['denied'], ['not_tester']])(
    'outcome %s returns with instagram=error and that reason, and stores nothing',
    (outcome) => {
      const {userId, state} = startConnect();

      const destination = finishInstagramConnect(state, outcome, 'asha_creates');

      expect(destination).toBe(`/onboarding?step=3&instagram=error&reason=${outcome}`);
      expect(instagramOf(userId)).toEqual(NOT_CONNECTED);
    },
  );

  it('adds the result with "?" when the return address has no query string', () => {
    const {state} = startConnect('/app/settings');

    expect(finishInstagramConnect(state, 'creator', 'asha_creates')).toBe('/app/settings?instagram=connected');
  });

  // F2: "The parameters are set with URL handling, never by joining strings."
  it.each<[string, InstagramOutcome, string]>([
    ['/onboarding?step=3&instagram=connected', 'denied', '/onboarding?step=3&instagram=error&reason=denied'],
    ['/onboarding?step=3&instagram=error&reason=denied', 'creator', '/onboarding?step=3&instagram=connected'],
    ['/app/settings?instagram=error&reason=failed&instagram=error', 'not_tester', '/app/settings?instagram=error&reason=not_tester'],
    ['/app#frag', 'denied', '/app?instagram=error&reason=denied'],
    ['/onboarding?step=3#instagram=connected', 'personal_account', '/onboarding?step=3&instagram=error&reason=personal_account'],
  ])('a return address of %s with outcome %s gives exactly one result: %s', (returnTo, outcome, expected) => {
    const {state} = startConnect(returnTo);

    const destination = finishInstagramConnect(state, outcome, 'asha_creates');

    expect(destination).toBe(expected);
    const params = new URL(destination, APP_ORIGIN).searchParams;
    expect(params.getAll('instagram')).toHaveLength(1);
    expect(params.getAll('reason').length).toBeLessThanOrEqual(1);
  });

  it('stores the username without a leading @ or surrounding spaces', () => {
    const {userId, state} = startConnect();

    finishInstagramConnect(state, 'creator', '  @asha_creates ');

    expect(instagramOf(userId).username).toBe('asha_creates');
  });

  it('an unknown state ends in the generic failure on the settings page and connects nobody', () => {
    const {userId} = startConnect();

    const destination = finishInstagramConnect('not-a-real-state', 'creator', 'asha_creates');

    expect(destination).toBe(FAILED);
    expect(instagramOf(userId)).toEqual(NOT_CONNECTED);
  });

  it('an empty state ends in the generic failure', () => {
    startConnect();

    expect(finishInstagramConnect('', 'creator', 'asha_creates')).toBe(FAILED);
  });

  describe('a state can be used once', () => {
    it('after a refusal it cannot be replayed to connect', () => {
      const {userId, state} = startConnect();
      finishInstagramConnect(state, 'denied', 'asha_creates');

      const replay = finishInstagramConnect(state, 'creator', 'asha_creates');

      expect(replay).toBe(FAILED);
      expect(instagramOf(userId)).toEqual(NOT_CONNECTED);
    });

    it('after a successful connection it cannot be replayed to change the account', () => {
      const {userId, state} = startConnect();
      finishInstagramConnect(state, 'creator', 'asha_creates');

      const replay = finishInstagramConnect(state, 'business', 'someone_else');

      expect(replay).toBe(FAILED);
      expect(instagramOf(userId).username).toBe('asha_creates');
    });
  });

  // F1: "a signed `state` that is valid for 10 minutes". After that the callback treats it as invalid (F2).
  describe('a state is valid for 10 minutes', () => {
    afterEach(() => vi.useRealTimers());

    it('the limit is the 10 minutes in API F1', () => {
      expect(OAUTH_STATE_MINUTES).toBe(10);
    });

    it('still works 9 minutes after the attempt started', () => {
      vi.useFakeTimers({toFake: ['Date']});
      const {userId, state} = startConnect();

      vi.setSystemTime(Date.now() + 9 * 60_000);

      expect(finishInstagramConnect(state, 'creator', 'asha_creates')).toBe('/onboarding?step=3&instagram=connected');
      expect(instagramOf(userId).connected).toBe(true);
    });

    it('no longer works 11 minutes after the attempt started', () => {
      vi.useFakeTimers({toFake: ['Date']});
      const {userId, state} = startConnect();

      vi.setSystemTime(Date.now() + 11 * 60_000);

      expect(finishInstagramConnect(state, 'creator', 'asha_creates')).toBe(FAILED);
      expect(instagramOf(userId)).toEqual(NOT_CONNECTED);
    });

    it('an expired state reports the generic failure, not the refusal Instagram gave', () => {
      vi.useFakeTimers({toFake: ['Date']});
      const {state} = startConnect();

      vi.setSystemTime(Date.now() + 11 * 60_000);

      expect(finishInstagramConnect(state, 'denied', 'asha_creates')).toBe(FAILED);
    });

    it('a state saved without a creation time (by an older version of the mock) counts as expired', () => {
      const {userId, state} = startConnect();
      const db = loadDb();
      db.oauthStates = db.oauthStates!.map(({createdAt: _createdAt, ...rest}) => rest);
      saveDb(db);

      expect(finishInstagramConnect(state, 'creator', 'asha_creates')).toBe(FAILED);
      expect(instagramOf(userId)).toEqual(NOT_CONNECTED);
    });
  });

  // F2: "...and that the signed-in user is the user inside `state`. This stops one person's
  // approval link from connecting another person's account."
  describe('only the signed-in user who started the attempt can finish it', () => {
    it('another signed-in user who opens the approval link connects nobody and gets the generic failure', () => {
      const {userId, state} = startConnect();
      const demoId = loadDb().users[0].id;
      const demoBefore = instagramOf(demoId);
      signInAs(demoId);

      const destination = finishInstagramConnect(state, 'creator', 'someone_else');

      expect(destination).toBe(FAILED);
      expect(instagramOf(userId)).toEqual(NOT_CONNECTED);
      expect(instagramOf(demoId)).toEqual(demoBefore);
    });

    it('with nobody signed in, the approval link connects nobody and gets the generic failure', () => {
      const {userId, state} = startConnect();
      signInAs(null);

      expect(finishInstagramConnect(state, 'creator', 'asha_creates')).toBe(FAILED);
      expect(instagramOf(userId)).toEqual(NOT_CONNECTED);
    });

    it("leaves other accounts' connections alone when the right user connects", () => {
      const demoId = loadDb().users[0].id;
      const demoBefore = instagramOf(demoId);
      const {state} = startConnect();

      finishInstagramConnect(state, 'creator', 'asha_creates');

      expect(instagramOf(demoId)).toEqual(demoBefore);
    });
  });
});

describe('listVoices (D3)', () => {
  it('is a curated list of six voices with distinct ids and names, each with a playable sample', () => {
    const voices = listVoices();

    expect(voices).toHaveLength(6);
    expect(new Set(voices.map((v) => v.id)).size).toBe(6);
    expect(new Set(voices.map((v) => v.name)).size).toBe(6);
    for (const voice of voices) {
      expect(Object.keys(voice).sort(), voice.name).toEqual(['accent', 'gender', 'id', 'name', 'previewUrl', 'provider', 'style']);
      expect(voice.provider).toBe('elevenlabs');
      // Mock mode: a generated WAV file. "RIFF" in base64 starts with "UklGR".
      expect(voice.previewUrl, voice.name).toMatch(/^data:audio\/wav;base64,UklGR/);
    }
  });
});

// ---------------------------------------------------------------- F7: YouTube connections in the mock database

describe('connections.youtube (F7): databases saved by older versions', () => {
  it('a database saved before F7 (no youtube key) still loads, and every user has youtube: null', () => {
    const db = loadDb();
    const old = JSON.parse(JSON.stringify(db));
    delete old.youtube;
    localStorage.setItem('rf_mock_db_v1', JSON.stringify(old));
    const reloaded = loadDb();
    expect(reloaded.youtube).toBeUndefined();
    for (const u of reloaded.users) {
      expect(toUser(reloaded, u).connections).toEqual({youtube: null, instagram: null});
    }
  });

  it('the seed has no YouTube channel connected', () => {
    const db = loadDb();
    expect(toUser(db, db.users[0]).connections).toEqual({youtube: null, instagram: null});
  });

  it('a stored channel shows on that user only, and the older instagram field is kept', () => {
    const db = loadDb();
    const other = createUser(db, ASHA);
    const channel = {status: 'connected' as const, name: 'Asha Shorts', pictureUrl: null, connectedAt: '2026-11-27T00:00:00Z'};
    db.youtube = {[other.id]: channel};
    saveDb(db);
    const reloaded = loadDb();
    expect(toUser(reloaded, reloaded.users.find((u) => u.id === other.id)!).connections.youtube).toEqual(channel);
    expect(toUser(reloaded, reloaded.users[0]).connections.youtube).toBeNull();
    expect(toUser(reloaded, reloaded.users[0]).instagram).toBeDefined();
  });
});
