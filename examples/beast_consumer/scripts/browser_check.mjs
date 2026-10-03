#!/usr/bin/env node
// Optional headless check of the example's decoded page, with Playwright (not a dependency of this
// repo). The page is the real one (engine and player); the repository's scripts/page_check.mjs
// checks it in depth (sandboxed iframe, strict CSP, loop timing, art restart).
//
// Loads the page four ways: fixtures/animation.html from disk, the exact
// data:text/html;base64,... animation_url from fixtures/token.json, a variant whose MIDI block holds
// a file with two SysEx (F0) events (same notes, same End-of-Track), and a variant with
// invalid settings (1,2,30,40,64,0,0). For the valid pages it checks that the art rendered
// (including the PNG inside the SVG's foreignObject, by sampling a screenshot pixel), that ▶ is
// enabled and starts TinySynth with the token's settings (custom lead on program 80, custom kick on
// drum 36, reverb, End-of-Track loop at tick 192), that there are no console errors, and that
// nothing was requested over the network. For the invalid variant it checks that the page fails
// closed: the art still renders, ▶ stays disabled, the validator's error is shown, no synth exists.
//
// Usage (from examples/beast_consumer):
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core \
//   CHROME=/path/to/chrome-headless-shell [LD_LIBRARY_PATH=...] \
//   node scripts/browser_check.mjs [screenshot_dir]

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { decodePng } from '../../../scripts/png.mjs';
import { midiWithSysex } from './reference.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { PLAYWRIGHT_CORE, CHROME } = process.env;
if (!PLAYWRIGHT_CORE) {
  console.error('set PLAYWRIGHT_CORE to a playwright-core directory (and CHROME to a Chromium binary)');
  process.exit(2);
}
const { chromium } = createRequire(import.meta.url)(PLAYWRIGHT_CORE);
const shotDir = process.argv[2];

function check(cond, msg) {
  if (!cond) throw new Error(`check failed: ${msg}`);
  console.log(`  ok  ${msg}`);
}

/** Before the page's scripts: record the synth the player constructs (see scripts/page_check.mjs). */
function instrument() {
  const st = (window.__check = { constructed: 0, synth: null });
  let Real;
  function Wrapped(opts) {
    st.constructed++;
    st.opts = opts;
    return (st.synth = new Real(opts));
  }
  Object.defineProperty(window, 'WebAudioTinySynth', { configurable: true, get: () => Real && Wrapped, set: (v) => { Real = v; } });
}

const token = JSON.parse(readFileSync(join(root, 'fixtures', 'token.json'), 'utf8'));
const html = readFileSync(join(root, 'fixtures', 'animation.html'), 'latin1');
const sysex = midiWithSysex();
const sysexHtml = html.replace(/(id="midi">)[^<]*(<\/script>)/, `$1${sysex.toString('base64')}$2`);
if (sysexHtml === html) throw new Error('MIDI block not found');
// Settings that fail validation (quality 2): the art must still render, ▶ stays disabled and the
// validator's error is shown (spec D9).
const invalidHtml = html.replace(/(id="settings">)[^<]*(<\/script>)/, '$1 1,2,30,40,64,0,0$2');
if (invalidHtml === html) throw new Error('settings block not found');
const INVALID_ERROR = 'settings: TS: quality out of range';
const asData = (h) => 'data:text/html;base64,' + Buffer.from(h, 'latin1').toString('base64');
// [label, url, invalid settings?]
const targets = [
  ['fixtures/animation.html (file://)', pathToFileURL(join(root, 'fixtures', 'animation.html')).href],
  ['token.json animation_url (data: URI)', token.animation_url],
  ['SysEx MIDI variant (data: URI)', asData(sysexHtml)],
  ['invalid settings variant 1,2,30,40,64,0,0 (data: URI)', asData(invalidHtml), true],
];

const browser = await chromium.launch({ executablePath: CHROME || undefined, env: process.env });
let failed = false;
for (const [label, url, invalid] of targets) {
  console.log(label);
  // The art is 250x350: at this viewport the <img> shows it at 1:1.
  const context = await browser.newContext({ viewport: { width: 250, height: 350 } });
  await context.addInitScript(instrument);
  const requests = [], blocked = [], errors = [];
  await context.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith('data:') || u.startsWith('file:')) return route.continue();
    blocked.push(u);
    return route.abort();
  });
  const page = await context.newPage();
  page.on('request', (r) => requests.push(r.url().slice(0, 40)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  const name = label.split(' ')[0].replace(/\W/g, '_');
  try {
    await page.goto(url);
    await page.waitForFunction(() => {
      const b = document.getElementById('play'), e = document.getElementById('error');
      return !b.disabled || !e.hidden;
    });
    await page.waitForFunction(() => document.querySelector('img')?.complete);
    const dims = await page.$eval('img', (e) => [e.naturalWidth, e.naturalHeight]);
    check(dims[0] === 250 && dims[1] === 350, `art <img> loaded (${dims.join('x')})`);
    const png = decodePng(await page.screenshot());
    if (shotDir) writeFileSync(join(shotDir, `${name}_page.png`), await page.screenshot());
    const red = png.pixel(125, 129), card = png.pixel(30, 250); // clear of the ▶ button and the error line
    check(red[0] > 240 && red[1] < 20 && red[2] < 20, `foreignObject PNG rendered (pixel ${red})`);
    check(card.join() === '30,30,34', `card background rendered (pixel ${card})`);
    if (invalid) {
      check(await page.$eval('#play', (b) => b.disabled), '▶ is disabled');
      const shown = await page.textContent('#error');
      check(shown === INVALID_ERROR && (await page.isVisible('#error')) && (await page.$eval('#play', (b) => b.title)) === INVALID_ERROR,
        `error shown: ${JSON.stringify(shown)}`);
      await page.click('#play', { force: true });
      check((await page.evaluate(() => window.__check.constructed)) === 0, 'clicking the disabled ▶ constructs no synth');
      check(errors.length === 1 && errors[0].includes(INVALID_ERROR), `only the expected console error (${errors.length})`);
    } else {
      check(!(await page.$eval('#play', (b) => b.disabled)), '▶ is enabled');
      await page.click('#play');
      await page.waitForTimeout(300);
      const st = await page.evaluate(() => {
        const { synth, opts, constructed } = window.__check;
        return {
          constructed, opts, state: synth.getAudioContext().state, loop: synth.loop, loopEnd: synth.loopEnd,
          lfo: synth.program[80].p[1].f, kick: synth.drummap[36 - 35].p[0].p, reverbLev: synth.reverbLev, masterVol: synth.masterVol,
        };
      });
      check(st.constructed === 1 && st.state === 'running', `▶ starts TinySynth (AudioContext ${st.state})`);
      check(JSON.stringify(st.opts) === '{"quality":1,"useReverb":1,"voices":64}' && st.reverbLev === 1 && st.masterVol === 0.4,
        'constructed with the token settings: quality 1, reverb 100, volume 40, 64 voices');
      check(st.lfo === 6 && st.kick === 0.25, 'custom lead on program 80 (6 Hz LFO) and custom kick on drum 36 installed');
      check(st.loop === 1 && st.loopEnd === 192, 'loops at End-of-Track (tick 192)');
      check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
    }
    check(blocked.length === 0, `no network requests (requests seen: ${[...new Set(requests.map((r) => r.split(':')[0] + ':'))].join(' ')})`);
  } catch (e) {
    failed = true;
    console.log(`  FAIL ${e.message}`);
  }
  await context.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
