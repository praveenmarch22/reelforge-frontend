// Fails fast, with a clear message, when the real backend stack is not running.

export default async function globalSetup() {
  const port = process.env.REAL_API_PORT ?? '5200';
  const mailpit = process.env.REAL_MAILPIT_URL ?? 'http://127.0.0.1:8225';
  const check = async (url: string, what: string) => {
    try {
      const res = await fetch(url);
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      throw new Error(`${what} is not reachable at ${url} (${String(e)}). Start the test stack first: see playwright.real.config.ts.`);
    }
  };
  await check(`http://127.0.0.1:${port}/api/v1/voices`, 'The backend API');
  await check(`${mailpit}/api/v1/messages?limit=1`, 'Mailpit');
}
