import '@testing-library/jest-dom/vitest';
import {cleanup} from '@testing-library/react';
import {afterEach} from 'vitest';

// jsdom doesn't scroll; pages that scroll to the top (onboarding steps) need it to exist.
window.scrollTo = () => {};

afterEach(() => {
  cleanup();
  localStorage.clear();
});
