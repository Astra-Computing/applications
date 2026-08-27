// Ad-hoc smoke test for the host round-results slideshow (v0.4.1).
// Run inside the dev container, where playwright + chromium are installed:
//   docker exec dev-env node /workspace/projects/applications/apps/bracketapp-web/_pw_slideshow.js
// Drives one real host browser context and three separate player contexts
// against the live dev server, so the localStorage-token / 2s-polling path is
// exercised for real rather than simulated in a single tab.
const { chromium } = require('/tmp/pw-check/node_modules/playwright');
const fs = require('fs');
const OUT = '/tmp/pw-check/shots-slideshow';
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:3000';
const R = {};
const log = (k, v) => { R[k] = v; console.log('  ' + k + ':', JSON.stringify(v)); };

// 7 quotes -> 4 round-1 matchups, one of them a BYE. Mixed rendering cases:
// already-quoted, conversation (multiline), and a long unbroken token.
const LONG = 'Supercalifragilisticexpialidociousandthensomemoreletterstomakeitreallylongindeedyes';
const QUOTES = [
  { text: 'The unexamined life is not worth living and that is the whole of it', author: 'Socrates' },
  { text: '"I already brought my own quotation marks," she said flatly', author: 'Dorothy' },
  { text: '"Who is there?"\n"Nobody, go back to sleep."', author: 'Abbott', sortAuthor: 'Costello' },
  { text: LONG, author: 'Mary' },
  { text: 'A man who carries a cat by the tail learns something he can learn in no other way', author: 'Twain' },
  { text: 'I have not failed I have just found ten thousand ways that will not work', author: 'Edison' },
  { text: 'Be yourself everyone else is already taken and that is rather the point', author: 'Wilde' },
];

const api = (path, opts) =>
  fetch(BASE + path, opts).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));

async function newGame(playerNames) {
  const c = await api('/api/game/create', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quotes: QUOTES }),
  });
  const { roomCode, hostToken } = c.body;
  const players = [];
  for (const name of playerNames) {
    const j = await api('/api/game/' + roomCode + '/join', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    players.push({ name, token: j.body.token });
  }
  return { roomCode, hostToken, players };
}

async function hostPage(browser, roomCode, hostToken, opts) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1600, height: 950 } }, opts || {}));
  const page = await ctx.newPage();
  await page.addInitScript(a => localStorage.setItem('uq_host_' + a[0], a[1]), [roomCode, hostToken]);
  await page.goto(BASE + '/room/' + roomCode + '/host', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.round-header, .host-info-bar', { timeout: 30000 });
  return { ctx, page };
}

async function playerPage(browser, roomCode, p, viewport) {
  const ctx = await browser.newContext({ viewport: viewport || { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.addInitScript(a =>
    localStorage.setItem('uq_session_' + a[0], JSON.stringify({ name: a[1], token: a[2] })),
    [roomCode, p.name, p.token]);
  await page.goto(BASE + '/room/' + roomCode + '/player', { waitUntil: 'domcontentloaded' });
  return { ctx, page };
}

// Wait until this player's own 2s poll has actually landed on round `n`,
// otherwise the previous round's "waiting for host" banner is still on screen
// and the vote loop below exits before casting anything.
async function waitForRound(page, n) {
  await page.waitForFunction(r => {
    const h = document.querySelector('h3');
    return !!h && h.textContent.indexOf('Round ' + r + ' —') !== -1
        && !!document.querySelector('.matchup-enter .match-header');
  }, n, { timeout: 30000 });
}

// Vote for side `pick` on every open matchup, through the real player UI.
async function voteAll(page, pick, round) {
  if (round) await waitForRound(page, round);
  for (let guard = 0; guard < 12; guard++) {
    if (await page.$('.alert-success')) return;
    const ok = await page.waitForSelector('.matchup-enter .match-header', { timeout: 20000 }).catch(() => null);
    if (!ok) return;
    const header = await page.$eval('.match-header', el => el.textContent);
    const cols = await page.$$('.grid-3 .flex-col');
    if (cols.length < 2) return;
    await cols[pick === 'a' ? 0 : 1].$eval('button', b => b.click());
    await page.waitForFunction(h => {
      const cur = document.querySelector('.match-header');
      return (cur && cur.textContent !== h) || document.querySelector('.alert-success');
    }, header, { timeout: 20000 }).catch(() => {});
  }
}

const waitForEnabled = page => page.waitForFunction(() => {
  const b = document.querySelector('.round-header .btn-primary');
  return !!b && !b.disabled;
}, null, { timeout: 30000 });

async function headerState(page) {
  return page.evaluate(() => {
    const btn = document.querySelector('.round-header .btn-primary');
    const status = document.querySelector('.round-header-status');
    const h2 = document.querySelector('.round-header-title');
    const stray = Array.from(document.querySelectorAll('main .btn-primary'))
      .filter(b => !b.closest('.round-header')).map(b => b.textContent.trim());
    return {
      title: h2 ? h2.textContent : null,
      label: btn ? btn.textContent.trim() : null,
      disabled: btn ? btn.disabled : null,
      status: status ? status.textContent.trim() : null,
      topOfPage: btn ? btn.getBoundingClientRect().top < 200 : null,
      strayPrimaryButtons: stray,
    };
  });
}

async function readSlide(page) {
  return page.evaluate(() => {
    const root = document.querySelector('.slideshow');
    if (!root) return null;
    const tiles = Array.from(root.querySelectorAll('.slide-tile')).map(t => {
      const r = t.getBoundingClientRect();
      const fill = t.querySelector('.slide-fill');
      const fr = fill ? fill.getBoundingClientRect() : null;
      const qt = t.querySelector('.quote-text');
      const num = t.querySelector('.slide-score-num');
      const bye = t.querySelector('.slide-score-bye');
      return {
        empty: t.classList.contains('slide-tile-empty'),
        rect: { top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) },
        quote: qt ? qt.innerText : null,
        score: num ? num.textContent : null,
        bye: bye ? bye.textContent : null,
        hasFill: !!fill,
        declaredFill: fill ? getComputedStyle(fill).getPropertyValue('--fill-height').trim() : null,
        fillPctOfTile: fr ? +(fr.height / r.height * 100).toFixed(1) : null,
        animationName: fill ? getComputedStyle(fill).animationName : null,
        animationDuration: fill ? getComputedStyle(fill).animationDuration : null,
        fillColor: fill ? getComputedStyle(fill).backgroundColor : null,
      };
    });
    return {
      footer: root.querySelector('.slideshow-footer') ? root.querySelector('.slideshow-footer').textContent.trim() : null,
      authorNodes: root.querySelectorAll('.quote-author').length,
      text: root.innerText,
      tiles,
    };
  });
}

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });

  // ---- Game 1: full flow, three players on separate browser contexts ----
  const g = await newGame(['Ana', 'Ben', 'Cara']);
  log('roomCode', g.roomCode);
  const host = await hostPage(browser, g.roomCode, g.hostToken);
  const players = [];
  for (const p of g.players) players.push(await playerPage(browser, g.roomCode, p));

  await api('/api/game/' + g.roomCode + '/start', { method: 'POST', headers: { 'x-host-token': g.hostToken } });
  await host.page.waitForFunction(() => !!document.querySelector('.round-header .btn-primary'), null, { timeout: 25000 });

  log('R1_header_before_votes', await headerState(host.page));
  await host.page.screenshot({ path: OUT + '/01-voting-header.png' });

  // Ana + Ben pick a, Cara picks b -> every contested matchup lands 2-1.
  await voteAll(players[0].page, 'a', 1);
  await voteAll(players[1].page, 'a', 1);
  await voteAll(players[2].page, 'b', 1);

  await waitForEnabled(host.page);
  log('R1_header_all_voted', await headerState(host.page));

  await host.page.click('.round-header .btn-primary');
  await host.page.waitForSelector('.slideshow', { timeout: 20000 });
  log('R1_slideshow_appeared', true);
  log('R1_header_during_slideshow', await headerState(host.page));

  await players[0].page.waitForTimeout(600);
  log('player_sees_slideshow', await players[0].page.evaluate(() => !!document.querySelector('.slideshow')));
  await players[0].page.screenshot({ path: OUT + '/02-player-during-slideshow.png' });

  // Walk every slide of round 1: sample the pour early, then once settled.
  const slides = [];
  let seen = null;
  for (let i = 0; i < 20 && slides.length < 6; i++) {
    const s = await readSlide(host.page);
    if (!s) break;
    if (s.footer === seen) { await host.page.waitForTimeout(300); continue; }
    seen = s.footer;
    const early = s.tiles.map(t => t.fillPctOfTile);
    await host.page.waitForTimeout(2700);
    const settled = await readSlide(host.page);
    if (!settled || settled.footer !== seen) { slides.push(Object.assign({ early }, s)); continue; }
    await host.page.screenshot({ path: OUT + '/slide-' + (slides.length + 1) + '.png' });
    slides.push(Object.assign({ early }, settled));
  }
  log('R1_slide_count', slides.length);
  R.R1_slides = slides.map(s => ({
    footer: s.footer,
    authorNodes: s.authorNodes,
    winnerWords: /winner|champion|\u{1F3C6}|✓|\u{1F451}/iu.test(s.text),
    earlyFillPct: s.early,
    tiles: s.tiles.map(t => ({
      empty: t.empty, quote: t.quote, score: t.score, bye: t.bye, hasFill: t.hasFill,
      declaredFill: t.declaredFill, settledPct: t.fillPctOfTile,
      anim: t.animationName, dur: t.animationDuration, color: t.fillColor, rect: t.rect,
    })),
  }));
  console.log('  R1_slides:', JSON.stringify(R.R1_slides, null, 2));

  await host.page.waitForSelector('.slideshow', { state: 'detached', timeout: 25000 });
  log('R1_slideshow_auto_finished', true);
  await host.page.waitForSelector('.result-row', { timeout: 10000 });
  log('R1_results_rows', await host.page.$$eval('.result-row', els => els.length));
  log('R1_header_after_slideshow', await headerState(host.page));
  await host.page.screenshot({ path: OUT + '/03-results-after.png', fullPage: true });

  // ---- Round 2: Space skips ----
  await host.page.click('.round-header .btn-primary');
  await host.page.waitForFunction(() => {
    const t = document.querySelector('.round-header-title');
    return !!t && t.textContent.indexOf('Round 2') !== -1;
  }, null, { timeout: 20000 });
  for (let i = 0; i < 3; i++) await waitForRound(players[i].page, 2);
  log('R2_header_voting', await headerState(host.page));
  for (let i = 0; i < 3; i++) await voteAll(players[i].page, i === 2 ? 'b' : 'a', 2);
  await waitForEnabled(host.page);
  await host.page.click('.round-header .btn-primary');
  await host.page.waitForSelector('.slideshow', { timeout: 20000 });

  const sBefore = await host.page.evaluate(() => window.scrollY);
  log('R2_focus_at_skip', await host.page.evaluate(() => document.activeElement ? document.activeElement.className : null));
  await host.page.keyboard.press('Space');
  await host.page.waitForSelector('.slideshow', { state: 'detached', timeout: 6000 });
  log('R2_space_skipped', true);
  log('R2_scroll_unchanged', sBefore === await host.page.evaluate(() => window.scrollY));
  log('R2_header_after_skip', await headerState(host.page));
  log('R2_results_rows', await host.page.$$eval('.result-row', els => els.length));

  // ---- Round 3: final matchup then champion ----
  await host.page.click('.round-header .btn-primary');
  await host.page.waitForFunction(() => {
    const t = document.querySelector('.round-header-title');
    return !!t && t.textContent.indexOf('Round 3') !== -1;
  }, null, { timeout: 20000 });
  for (let i = 0; i < 3; i++) await waitForRound(players[i].page, 3);
  log('R3_header_voting', await headerState(host.page));
  for (let i = 0; i < 3; i++) await voteAll(players[i].page, i === 2 ? 'b' : 'a', 3);
  await waitForEnabled(host.page);
  await host.page.click('.round-header .btn-primary');
  await host.page.waitForSelector('.slideshow', { timeout: 20000 });
  log('final_slideshow_shown', true);
  const finalSlide = await readSlide(host.page);
  R.final_slide = finalSlide && {
    footer: finalSlide.footer,
    tiles: finalSlide.tiles.map(t => ({ quote: t.quote, score: t.score, declaredFill: t.declaredFill })),
  };
  console.log('  final_slide:', JSON.stringify(R.final_slide, null, 2));
  await host.page.waitForTimeout(2600);
  await host.page.screenshot({ path: OUT + '/04-final-slide.png' });
  await host.page.keyboard.press('Space');
  await host.page.waitForSelector('.champion-card', { timeout: 15000 });
  log('champion_text', await host.page.$eval('.champion-quote', el => el.innerText));
  log('champion_author_shown', await host.page.$$eval('.champion-author', els => els.length) > 0);
  log('done_header', await headerState(host.page));
  await host.page.screenshot({ path: OUT + '/05-champion.png', fullPage: true });

  for (const p of players) await p.ctx.close();
  await host.ctx.close();

  // ---- Game 2: reduced motion ----
  const g2 = await newGame(['Solo']);
  await api('/api/game/' + g2.roomCode + '/start', { method: 'POST', headers: { 'x-host-token': g2.hostToken } });
  const p2 = await playerPage(browser, g2.roomCode, g2.players[0]);
  await voteAll(p2.page, 'a', 1);
  const h2 = await hostPage(browser, g2.roomCode, g2.hostToken, { reducedMotion: 'reduce' });
  await waitForEnabled(h2.page);
  await h2.page.click('.round-header .btn-primary');
  await h2.page.waitForSelector('.slideshow', { timeout: 20000 });
  await h2.page.waitForTimeout(150);   // well inside the 2s pour
  const rm = await readSlide(h2.page);
  R.reduced_motion = rm && rm.tiles.map(t => ({
    anim: t.animationName, declaredFill: t.declaredFill, pctAt150ms: t.fillPctOfTile, score: t.score, bye: t.bye,
  }));
  console.log('  reduced_motion:', JSON.stringify(R.reduced_motion, null, 2));
  await h2.page.screenshot({ path: OUT + '/06-reduced-motion.png' });
  await h2.ctx.close();
  await p2.ctx.close();

  // ---- Game 3: 390px host viewport ----
  const g3 = await newGame(['Solo']);
  await api('/api/game/' + g3.roomCode + '/start', { method: 'POST', headers: { 'x-host-token': g3.hostToken } });
  const p3 = await playerPage(browser, g3.roomCode, g3.players[0]);
  await voteAll(p3.page, 'a', 1);
  const h3 = await hostPage(browser, g3.roomCode, g3.hostToken, { viewport: { width: 390, height: 844 } });
  await waitForEnabled(h3.page);
  await h3.page.click('.round-header .btn-primary');
  await h3.page.waitForSelector('.slideshow', { timeout: 20000 });
  await h3.page.waitForTimeout(2600);
  const m = await readSlide(h3.page);
  R.mobile = m && {
    stacked: m.tiles.length === 2 ? m.tiles[1].rect.top >= m.tiles[0].rect.top + m.tiles[0].rect.h - 4 : null,
    widths: m.tiles.map(t => t.rect.w),
    overflowX: await h3.page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
  };
  console.log('  mobile:', JSON.stringify(R.mobile));
  await h3.page.screenshot({ path: OUT + '/07-mobile.png' });
  await h3.ctx.close();
  await p3.ctx.close();

  await browser.close();
  fs.writeFileSync(OUT + '/results.json', JSON.stringify(R, null, 2));
  console.log('\nDONE');
}
main().catch(e => { console.error('FAILED', e); process.exit(1); });
