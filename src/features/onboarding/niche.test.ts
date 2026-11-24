import {describe, expect, it} from 'vitest';
import {cleanCustom, countTopics, CUSTOM_MAX, matchingLabel, NICHE_LABELS} from './niche';
import {joinNiche, MAX_NICHES, NICHES, splitNiche} from './NicheStep';

// API_DESIGN.md A10: `niche` is one text value of up to 120 characters holding at most three topics
// separated by commas, with no repeats (for example "Fitness, Finance, gardening"). The web app builds
// it from up to three choices: listed topics, plus at most one free-text topic of up to 40 characters
// that cannot itself contain a comma.

const labels = NICHES.map((n) => n.label);
const topicsIn = (stored: string) => stored.split(',').map((part) => part.trim()).filter(Boolean);
/** True when the text has half of a surrogate pair in it: a character cut in two. */
const hasBrokenCharacter = (text: string) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text);
const SEEDLING = '\u{1F331}'; // one character on screen, two UTF-16 units

describe('the topic list', () => {
  it('offers 12 different topics, a limit of 3, and 40 characters of free text', () => {
    expect(labels).toHaveLength(12);
    expect(new Set(labels.map((l) => l.toLowerCase())).size).toBe(12);
    expect(labels).toEqual([...NICHE_LABELS]);
    expect(MAX_NICHES).toBe(3);
    expect(CUSTOM_MAX).toBe(40);
  });

  it('has no topic with a comma in it, since commas separate the saved topics', () => {
    for (const label of labels) expect(label).not.toContain(',');
  });
});

describe('matchingLabel', () => {
  it('finds a listed topic whatever the letter case and the spaces around it', () => {
    expect(matchingLabel('Fitness')).toBe('Fitness');
    expect(matchingLabel('fitness')).toBe('Fitness');
    expect(matchingLabel('  FITNESS ')).toBe('Fitness');
  });

  it('gives nothing for text that is not exactly a listed topic', () => {
    expect(matchingLabel('gardening')).toBeUndefined();
    expect(matchingLabel('Fitness coach')).toBeUndefined();
    expect(matchingLabel('')).toBeUndefined();
    // Names every object has must not count as topics.
    for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) expect(matchingLabel(name), name).toBeUndefined();
  });
});

describe('cleanCustom (what "Something else" accepts as it is typed)', () => {
  it('leaves ordinary text alone, including a space still being typed at the end', () => {
    expect(cleanCustom('street photography')).toBe('street photography');
    expect(cleanCustom('street ')).toBe('street ');
    expect(cleanCustom('')).toBe('');
  });

  it.each([
    ['a comma', 'gardening,chess', 'gardening chess'],
    ['a comma and a space', 'gardening, chess', 'gardening chess'],
    ['several commas', 'knitting, pottery, chess, origami', 'knitting pottery chess origami'],
    ['a tab', 'gardening\tchess', 'gardening chess'],
    ['a line feed', 'gardening\nchess', 'gardening chess'],
    ['a Windows line break', 'gardening\r\nchess', 'gardening chess'],
    ['a carriage return', 'gardening\rchess', 'gardening chess'],
    ['a run of them', 'gardening,\t\r\n,chess', 'gardening chess'],
  ])('turns %s into one space', (_label, typed, expected) => {
    expect(cleanCustom(typed)).toBe(expected);
  });

  it('never leaves a comma, tab or line break behind, so the text stays one topic', () => {
    for (const typed of [',', ',,,', ', a ,', '\t\n', 'a,\n,b,\t,c', ' , , ']) {
      expect(cleanCustom(typed), JSON.stringify(typed)).not.toMatch(/[,\t\r\n]/);
      expect(topicsIn(joinNiche([], typed)).length, JSON.stringify(typed)).toBeLessThanOrEqual(1);
    }
  });

  it('cuts at 40 characters', () => {
    expect(cleanCustom('x'.repeat(40))).toBe('x'.repeat(40));
    expect(cleanCustom('x'.repeat(41))).toBe('x'.repeat(40));
    expect(cleanCustom('x'.repeat(500))).toBe('x'.repeat(40));
  });

  it('counts an emoji as one character: the 40th character can be an emoji and is kept whole', () => {
    const typed = 'a'.repeat(39) + SEEDLING;

    expect(cleanCustom(typed)).toBe(typed);
    expect(Array.from(cleanCustom(typed))).toHaveLength(40);
  });

  it('leaves the 41st character out whole instead of keeping half of an emoji', () => {
    expect(cleanCustom('a'.repeat(40) + SEEDLING)).toBe('a'.repeat(40));
    expect(cleanCustom(SEEDLING.repeat(41))).toBe(SEEDLING.repeat(40));
  });

  it('never returns half a character, wherever the cut falls', () => {
    for (let letters = 30; letters <= 41; letters++) {
      const cleaned = cleanCustom('a'.repeat(letters) + SEEDLING.repeat(12));
      expect(hasBrokenCharacter(cleaned), `${letters} letters`).toBe(false);
      expect(Array.from(cleaned).length, `${letters} letters`).toBeLessThanOrEqual(40);
    }
  });
});

// niche.ts: the length is "counted in characters as a person sees them", and the cut is "never
// through the middle of an emoji". Many everyday emoji are several code points long.
describe('cleanCustom with emoji that are made of several code points', () => {
  const FLAG = '\u{1F1EE}\u{1F1F3}'; // flag of India: two regional-indicator letters
  const THUMBS_UP_MEDIUM = '\u{1F44D}\u{1F3FD}'; // thumbs up + skin tone
  const FAMILY = '\u{1F468}‍\u{1F469}‍\u{1F467}'; // three people joined with zero-width joiners
  const RED_HEART = '❤️'; // heart + "show as emoji" selector

  it.each([
    ['a flag', FLAG],
    ['a thumbs-up with a skin tone', THUMBS_UP_MEDIUM],
    ['a family', FAMILY],
    ['a red heart', RED_HEART],
  ])('%s as the 40th character is kept whole or left out, never cut into a different symbol', (_label, emoji) => {
    const cleaned = cleanCustom('a'.repeat(39) + emoji);

    expect(['a'.repeat(39), 'a'.repeat(39) + emoji]).toContain(cleaned);
  });
});

describe('joinNiche (the value that is saved)', () => {
  it('joins the chosen topics and the free text with ", " (the A10 example)', () => {
    expect(joinNiche(['Fitness', 'Finance'], 'gardening')).toBe('Fitness, Finance, gardening');
  });

  it('leaves out an empty or blank free text', () => {
    expect(joinNiche(['Fitness'], '')).toBe('Fitness');
    expect(joinNiche(['Fitness'], '   ')).toBe('Fitness');
  });

  it('trims the free text', () => {
    expect(joinNiche([], '  gardening  ')).toBe('gardening');
  });

  it('gives an empty string when nothing is chosen (A10: an empty string clears the niche)', () => {
    expect(joinNiche([], '')).toBe('');
    expect(joinNiche([], ' , ')).toBe('');
  });

  it('keeps a free text with commas as one topic', () => {
    expect(joinNiche(['Fitness', 'Finance'], 'gardening, chess')).toBe('Fitness, Finance, gardening chess');
    expect(joinNiche([], 'knitting, pottery, chess, origami')).toBe('knitting pottery chess origami');
  });

  it('never saves more than three topics', () => {
    expect(joinNiche(['Fitness', 'Finance', 'Tech', 'Food'], '')).toBe('Fitness, Finance, Tech');
    expect(joinNiche(['Fitness', 'Finance', 'Tech'], 'gardening')).toBe('Fitness, Finance, Tech');
    expect(topicsIn(joinNiche([...labels], 'a, b, c'))).toHaveLength(3);
  });

  it('never saves a topic twice', () => {
    expect(joinNiche(['Fitness'], 'Fitness')).toBe('Fitness');
    expect(joinNiche(['Fitness'], ' fitness ')).toBe('Fitness');
    expect(joinNiche(['Fitness', 'Fitness', 'Tech'], '')).toBe('Fitness, Tech');
    expect(joinNiche(['Fitness', 'Tech'], 'TECH')).toBe('Fitness, Tech');
  });

  it('saves a free text that names a listed topic as that topic, with its listed spelling', () => {
    expect(joinNiche([], 'fitness')).toBe('Fitness');
    expect(joinNiche(['Tech'], 'gaming')).toBe('Tech, Gaming');
  });

  it('cuts the free text to 40 whole characters', () => {
    expect(joinNiche([], 'x'.repeat(60))).toBe('x'.repeat(40));
    const saved = joinNiche(['Fitness'], 'a'.repeat(39) + SEEDLING + SEEDLING);
    expect(saved).toBe(`Fitness, ${'a'.repeat(39)}${SEEDLING}`);
    expect(hasBrokenCharacter(saved)).toBe(false);
  });

  it('stays within the 120 characters A10 allows, even with the longest choices', () => {
    const longest = [...labels].sort((a, b) => b.length - a.length);
    const longestFreeText = SEEDLING.repeat(40); // 40 characters, 80 UTF-16 units

    expect(joinNiche(longest.slice(0, MAX_NICHES), '').length).toBeLessThanOrEqual(120);
    expect(joinNiche(longest.slice(0, MAX_NICHES - 1), 'x'.repeat(40)).length).toBeLessThanOrEqual(120);
    expect(Array.from(joinNiche(longest.slice(0, MAX_NICHES - 1), longestFreeText)).length).toBeLessThanOrEqual(120);
  });
});

describe('countTopics (the "n of 3 chosen" line)', () => {
  it.each<[string[], string, number]>([
    [[], '', 0],
    [[], '   ', 0],
    [[], ',', 0],
    [['Fitness'], '', 1],
    [[], 'gardening', 1],
    [[], 'knitting, pottery, chess, origami', 1],
    [['Fitness'], 'Fitness', 1],
    [['Fitness'], 'fitness', 1],
    [['Fitness'], 'Finance', 2],
    [['Fitness', 'Finance'], 'gardening', 3],
    [['Fitness', 'Finance', 'Tech'], '', 3],
    [['Fitness', 'Finance', 'Tech', 'Food'], 'gardening', 3],
  ])('%j with "%s" is %i', (chosen, custom, expected) => {
    expect(countTopics(chosen, custom)).toBe(expected);
    // The count is always the number of topics that would be saved.
    expect(topicsIn(joinNiche(chosen, custom))).toHaveLength(expected);
  });
});

describe('splitNiche (reading a saved value)', () => {
  it('gives nothing chosen for an empty profile value', () => {
    expect(splitNiche('')).toEqual({chosen: [], custom: ''});
    expect(splitNiche(' , ,')).toEqual({chosen: [], custom: ''});
  });

  it('separates the known topics from the free text', () => {
    expect(splitNiche('Fitness, Finance, gardening')).toEqual({chosen: ['Fitness', 'Finance'], custom: 'gardening'});
  });

  it('accepts any spacing around the commas and ignores empty parts', () => {
    expect(splitNiche(' Fitness,Finance ,, gardening ,')).toEqual({chosen: ['Fitness', 'Finance'], custom: 'gardening'});
  });

  it('treats a value that is not one of the topics as free text (the demo account has "Productivity")', () => {
    expect(splitNiche('Productivity')).toEqual({chosen: [], custom: 'Productivity'});
  });

  it('recognises a listed topic in another letter case (the User example in the API design has "fitness")', () => {
    expect(splitNiche('fitness')).toEqual({chosen: ['Fitness'], custom: ''});
  });

  describe('a value that breaks the rules is brought within them', () => {
    it('more than three topics: the first three are kept', () => {
      expect(splitNiche('Fitness, Finance, Tech, Food')).toEqual({chosen: ['Fitness', 'Finance', 'Tech'], custom: ''});
      expect(splitNiche('Fitness, gardening, Finance, Tech')).toEqual({chosen: ['Fitness', 'Finance'], custom: 'gardening'});
      expect(splitNiche(labels.join(','))).toEqual({chosen: labels.slice(0, 3), custom: ''});
    });

    it('repeats are read once', () => {
      expect(splitNiche('Fitness, Fitness')).toEqual({chosen: ['Fitness'], custom: ''});
      expect(splitNiche('Fitness, fitness, FITNESS, Tech')).toEqual({chosen: ['Fitness', 'Tech'], custom: ''});
    });

    it('more than one free-text topic: only the first is kept', () => {
      expect(splitNiche('knitting, pottery, chess, origami')).toEqual({chosen: [], custom: 'knitting'});
      expect(splitNiche('Fitness, knitting, pottery')).toEqual({chosen: ['Fitness'], custom: 'knitting'});
    });

    it('an over-long free text is cut to 40 whole characters', () => {
      expect(splitNiche('x'.repeat(120))).toEqual({chosen: [], custom: 'x'.repeat(40)});
      const read = splitNiche('a'.repeat(39) + SEEDLING.repeat(10));
      expect(read.custom).toBe('a'.repeat(39) + SEEDLING);
      expect(hasBrokenCharacter(read.custom)).toBe(false);
    });

    it.each([
      'Fitness, Finance, Tech, Food',
      'Fitness, Fitness',
      'knitting, pottery, chess, origami',
      'x'.repeat(120),
      'a, b, c, d, e, f, g',
      'Fitness, a, Finance, b, Tech, c',
      `${'y'.repeat(60)}, Fitness, fitness, ${'z'.repeat(60)}`,
    ])('saving what was read from "%s" gives a value that keeps every rule', (stored) => {
      const {chosen, custom} = splitNiche(stored);
      const saved = joinNiche(chosen, custom);
      const topics = topicsIn(saved);

      expect(topics.length, saved).toBeLessThanOrEqual(MAX_NICHES);
      expect(new Set(topics.map((t) => t.toLowerCase())).size, saved).toBe(topics.length);
      expect(topics.filter((t) => !matchingLabel(t)).length, saved).toBeLessThanOrEqual(1);
      for (const topic of topics) expect(Array.from(topic).length, saved).toBeLessThanOrEqual(CUSTOM_MAX);
      expect(countTopics(chosen, custom)).toBe(topics.length);
      // Reading it again changes nothing more.
      expect(splitNiche(saved)).toEqual({chosen, custom});
    });
  });
});

describe('round trip', () => {
  it.each<[string[], string]>([
    [['Fitness'], ''],
    [['Fitness', 'Finance', 'Tech'], ''],
    [['Travel', 'Food'], 'gardening'],
    [[], 'street photography'],
    [[], `plants ${SEEDLING}`],
    [[], ''],
  ])('what is saved for %j + "%s" is read back the same', (chosen, custom) => {
    expect(splitNiche(joinNiche(chosen, custom))).toEqual({chosen, custom});
  });

  it('every single topic survives the round trip', () => {
    for (const label of labels) expect(splitNiche(joinNiche([label], ''))).toEqual({chosen: [label], custom: ''});
  });
});
