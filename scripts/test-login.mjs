// Test scripts sign in as SV_TEST_USER / SV_TEST_PASS (defaults below) and register it on first use.
// Start the server with SIGNVOICE_AUTH_DB=<throw-away file> when testing, so the test account never
// lands in the real database (the first account there becomes the admin).
export const testUser = { username: process.env.SV_TEST_USER || 'smoketest', password: process.env.SV_TEST_PASS || 'Smoke-test-2569' };

/** Browser tests: signs the Playwright page in (cookies are shared with the page's context). */
export async function signIn(page, url) {
  const base = new URL(url).origin;  // APP_URL may carry ?vision=cpu
  const post = (path) => page.request.post(`${base}${path}`, { data: testUser, headers: { origin: base } });
  if ((await post('/api/auth/login')).ok()) return;
  const response = await post('/api/auth/register');
  if (!response.ok()) throw new Error(`test sign-in failed: ${(await response.json()).error}`);
}

/** Node fetch scripts: returns a Cookie header value for the test account. */
export async function sessionCookie(url) {
  const base = new URL(url).origin;
  const post = (path) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(testUser) });
  let response = await post('/api/auth/login');
  if (!response.ok) response = await post('/api/auth/register');
  if (!response.ok) throw new Error(`test sign-in failed: ${(await response.json()).error}`);
  return response.headers.get('set-cookie').split(';')[0];
}
