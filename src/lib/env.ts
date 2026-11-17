/** Mock API: on by default in development, off in production builds unless explicitly enabled. */
export const USE_MOCKS = import.meta.env.DEV
  ? import.meta.env.VITE_USE_MOCKS !== 'false'
  : import.meta.env.VITE_USE_MOCKS === 'true';

export const API_URL = import.meta.env.VITE_API_URL ?? '/api/v1';
