const { chromium } = require('/tmp/pw-check/node_modules/playwright');
const OUT = '/tmp/pw-check/shots-voting';
require('fs').mkdirSync(OUT, { recursive: true });

const BASE = 'http://localhost:3000';

const QUOTES = [
  { text: 'Quote one', author: 'Author A' },
  { text: 'Quote two', author: 'Author B' },
  { text: 'Quote three', author: 'Author C' },
  { text: 'Quote four', author: 'Author D' },
  { text: 'Quote five', author: 'Author E' },
  { text: 'Quote six', author: 'Author F' },
  { text: 'Quote seven', author: 'Author G' },
  { text: 'Quote eight', author: 'Author H' },
];

async function main() {
  const results = {};

  // 1. Create game via API (bypassing file upload UI)
  let res = await fetch(`${BASE}/api/game/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quotes: QUOTES }),
  });
  const { roomCode, hostToken } = await res.json();
  results.roomCode = roomCode;
  if (!roomCode) { console.log(JSON.stringify({ error: 'create failed', body: await res.text?.() })); return; }

  // 2. Join as a player
  res = await fetch(`${BASE}/api/game/${roomCode}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Tester' }),
  });
  const { token } = await res.json();

  // 3. Host starts voting
  res = await fetch(`${BASE}/api/game/${roomCode}/start`, {
    method: 'POST',
    headers: { 'x-host-token': hostToken },
  });
  results.startStatus = res.status;

  const browser = await chromium.launch({ args: ['--no-sandbox'] });

  // ── Desktop: step through all matchups, verifying no full navigation ──
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  let navCount = 0;
  page.on('framenavigated', fr => { if (fr === page.mainFrame()) navCount++; });

  await page.addInitScript(([code, name, tok]) => {
    sessionStorage.setItem(`uq_session_${code}`, JSON.stringify({ name, token: tok }));
  }, [roomCode, 'Tester', token]);
  await page.goto(`${BASE}/room/${roomCode}/player`, { waitUntil: 'networkidle' });
  results.navCountAfterInitialLoad = navCount; // should be 1

  const matchupSequence = [];
  for (let step = 0; step < 4; step++) {
    await page.waitForSelector('.match-header');
    const header = await page.$eval('.match-header', el => el.textContent);
    matchupSequence.push(header);
    if (step === 0) await page.screenshot({ path: `${OUT}/desktop-matchup1.png` });

    // confirm exactly one matchup's worth of quote-cards visible (2), not more
    const cardCount = await page.$$eval('.quote-card', els => els.length);
    if (cardCount !== 2) results[`cardCountWrong_step${step}`] = cardCount;

    // confirm side-by-side on desktop: both quote-cards roughly same top y
    const boxes = await page.$$eval('.quote-card', els => els.map(e => e.getBoundingClientRect()));
    results[`desktopSideBySide_step${step}`] = Math.abs(boxes[0].top - boxes[1].top) < 5 && boxes[0].left < boxes[1].left;

    // click first "Vote for this" button, then wait for the app's own state
    // to move on (header text changes, or the "all voted" banner appears)
    // rather than a fixed sleep — dev-server compile latency is variable.
    await page.click('.grid-3 .btn:has-text("Vote for this")');
    await page.waitForFunction(
      (prevHeader) => {
        const h = document.querySelector('.match-header')?.textContent;
        const done = document.querySelector('.alert-success');
        return (h && h !== prevHeader) || done;
      },
      header,
      { timeout: 15000 }
    );
  }
  results.navCountAfterVoting = navCount; // should still be 1 — no reloads
  results.matchupSequence = matchupSequence;

  await page.waitForSelector('.alert-success');
  const finalMsg = await page.$eval('.alert-success', el => el.textContent.trim());
  results.finalMessage = finalMsg;
  await page.screenshot({ path: `${OUT}/desktop-done.png` });
  await page.close();

  // ── Mobile: fresh room, check stacked layout ──
  res = await fetch(`${BASE}/api/game/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quotes: QUOTES }),
  });
  const room2 = await res.json();
  res = await fetch(`${BASE}/api/game/${room2.roomCode}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'MobileTester' }),
  });
  const tok2 = (await res.json()).token;
  await fetch(`${BASE}/api/game/${room2.roomCode}/start`, { method: 'POST', headers: { 'x-host-token': room2.hostToken } });

  const mobile = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await mobile.addInitScript(([code, name, tok]) => {
    sessionStorage.setItem(`uq_session_${code}`, JSON.stringify({ name, token: tok }));
  }, [room2.roomCode, 'MobileTester', tok2]);
  await mobile.goto(`${BASE}/room/${room2.roomCode}/player`, { waitUntil: 'networkidle' });
  await mobile.waitForSelector('.match-header');
  const mboxes = await mobile.$$eval('.quote-card', els => els.map(e => e.getBoundingClientRect()));
  results.mobileStacked = mboxes[1].top >= mboxes[0].bottom - 2; // second card starts at/after first card ends
  results.mobileOverflowX = await mobile.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  await mobile.screenshot({ path: `${OUT}/mobile-matchup1.png` });
  await mobile.close();

  // ── Buy Me a Coffee sizing on home page ──
  const homePage = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  await homePage.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await homePage.waitForSelector('.bmc-card');
  const bmcBox = await homePage.$eval('.bmc-card', el => el.getBoundingClientRect());
  results.bmcCardWidth = bmcBox.width; // expect <= 240
  const svgBox = await homePage.$eval('.bmc-top svg', el => ({ w: el.getAttribute('width'), h: el.getAttribute('height') }));
  results.bmcSvgSize = svgBox;
  await homePage.screenshot({ path: `${OUT}/home-bmc.png`, clip: { x: Math.max(0, bmcBox.x - 20), y: Math.max(0, bmcBox.y - 20), width: bmcBox.width + 40, height: bmcBox.height + 40 } });
  await homePage.close();

  console.log(JSON.stringify(results, null, 2));
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
