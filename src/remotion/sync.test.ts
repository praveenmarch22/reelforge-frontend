// The preview player draws the Reel with a copy of the renderer's files, so what the creator
// sees is what gets rendered (decided 2026-11-25). This fails when the two copies differ.
// It runs where both repositories sit side by side (reelforge/frontend and reelforge/backend);
// the frontend's own CI has no backend checkout, so there it is skipped.

import {existsSync, readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

const FILES = ['Reel.tsx', 'Scene.tsx', 'Captions.tsx', 'types.ts', 'util.ts'];
const here = dirname(fileURLToPath(import.meta.url));
const renderer = resolve(here, '../../../backend/renderer/src');
const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

describe.skipIf(!existsSync(renderer))('the preview uses the renderer’s own drawing code', () => {
  it.each(FILES)('%s is the same as backend/renderer/src/%s', (file) => {
    expect(read(resolve(here, file))).toBe(read(resolve(renderer, file)));
  });
});
