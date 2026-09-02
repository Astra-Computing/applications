// Playwright deliberately lives OUTSIDE the repo, at /workspace/tools/playwright.
// `stop-dev.ps1` runs `docker compose down`, which *removes* the container and
// everything in its filesystem - which is how the previous /tmp/pw-check install
// was lost. /workspace is a bind mount to the Windows drive, so both the package
// and the browser binaries survive. The env var must be set before the require:
// without it Playwright looks in ~/.cache/ms-playwright and finds nothing.
process.env.PLAYWRIGHT_BROWSERS_PATH ||= '/workspace/tools/playwright/browsers';
const { chromium } = require('/workspace/tools/playwright/node_modules/playwright');
const BASE = 'http://localhost:3000';
const QUOTES = [
  { text: 'Quote one', author: 'Author A' },
  { text: 'Quote two', author: 'Author B' },
  { text: 'Quote three', author: 'Author C' },
  { text: 'Quote four', author: 'Author D' },
];

async function main() {
  let res = await fetch(`${BASE}/api/game/create`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quotes: QUOTES }),
  });
  const { roomCode, hostToken } = await res.json();
  console.log('room', roomCode);

  res = await fetch(`${BASE}/api/game/${roomCode}/join`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Tester' }),
  });
  const { token } = await res.json();

  res = await fetch(`${BASE}/api/game/${roomCode}/start`, { method: 'POST', headers: { 'x-host-token': hostToken } });
  console.log('start status', res.status);

  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('console', m => console.log('[console]', m.type(), m.text()));
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  page.on('requestfailed', r => console.log('[requestfailed]', r.url(), r.failure()?.errorText));
  page.on('response', r => { if (r.url().includes('/vote')) console.log('[vote response]', r.status()); });

  await page.addInitScript(([code, name, tok]) => {
    sessionStorage.setItem(`uq_session_${code}`, JSON.stringify({ name, token: tok }));
  }, [roomCode, 'Tester', token]);
  await page.goto(`${BASE}/room/${roomCode}/player`, { waitUntil: 'networkidle' });

  await page.waitForSelector('.match-header');
  console.log('header before click:', await page.$eval('.match-header', el => el.textContent));

  const btn = page.locator('.grid-3 .btn:has-text("Vote for this")').first();
  console.log('button disabled before click?', await btn.isDisabled());
  await btn.click();
  console.log('clicked');

  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(300);
    const header = await page.$eval('.match-header', el => el.textContent).catch(() => 'NO HEADER (maybe waiting message shown)');
    const stillDisabled = await page.locator('.grid-3 .btn:has-text("Vote for this")').first().isDisabled().catch(() => 'N/A');
    console.log(`t+${(i+1)*300}ms header=`, header, 'disabled=', stillDisabled);
  }

  await browser.close();
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
