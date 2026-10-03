#!/usr/bin/env node
// Optional headless check of the example's decoded page, with Playwright (not a dependency of this
// repo). The page is the real one (engine and player); the repository's scripts/page_check.mjs
// checks it in depth (sandboxed iframe, strict CSP, loop timing, art restart).
//
// Loads the page seven ways: fixtures/animation.html from disk, the exact
// data:text/html;base64,... animation_url of fixtures/token_uri.txt (token 1's token_uri, which
// test_token_uri.cairo asserts is the contract's byte for byte), a variant whose MIDI block holds
// a file with two SysEx (F0) events (same notes, same End-of-Track), a variant with settings that
// do not parse (1,1,30,40,64,0: a token missing), a variant whose gzipped engine is corrupt
// (one payload byte changed), a variant whose SVG breaks the art rule (a <script> element in
// it), and token 4's page (a real Beast SVG, the synthetic 3,716-byte score and the reference
// sounds, decoded from its token_uri, whose SHA-256 test_token_uri.cairo pins: its art renders, and
// ▶ installs the reference sounds and loops at the score's End-of-Track). For the valid pages it checks that the page's shim inflated the
// engine (its gzip tag replaced by an inline script), that the art rendered (including the PNG
// inside the SVG's foreignObject, by sampling a screenshot pixel), that ▶ is enabled and starts
// TinySynth with the token's settings (custom lead on program 80, custom kick on drum 36, reverb,
// End-of-Track loop at tick 192), that there are no console errors, and that nothing was requested
// over the network (nor the gzip tag's data: URI, seen through Chromium's DevTools protocol; the
// other engines cannot show data: requests, and scripts/page_check.mjs proves it there). For the
// invalid variants it checks that the page fails closed: the art still renders, ▶ stays disabled,
// the error is shown, no synth exists. For the unsafe SVG it checks the failure the art rule
// prevents: the parser ends the art block at the SVG's `</script>` (as parseArtBlock in
// reference.mjs predicts), the art <img> is broken, and the rest of the SVG is parsed as page
// markup.
//
// Usage (from examples/beast_consumer; the engine as in scripts/browsers.mjs):
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core \
//   PLAYWRIGHT_BROWSER=chromium|firefox|webkit \
//   [CHROME=/path/to/chrome-headless-shell] [LD_LIBRARY_PATH=...] \
//   node scripts/browser_check.mjs [screenshot_dir]

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { collectErrors, dataRequestLog, launchBrowser } from '../../../scripts/browsers.mjs';
import { decodePng } from '../../../scripts/png.mjs';
import { ENGINE_MISSING } from '../../../player/player.js';
import { engineSource } from '../../../scripts/engine.mjs';
import {
  ART_OPEN, TOKENS, decodeTokenUri, midiWithSysex, parseArtBlock, tokenUriSpliced, unsafeSvg, withGzipPayload,
} from './reference.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
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

// Decoded as a marketplace decodes it.
const token = decodeTokenUri(readFileSync(join(root, 'fixtures', 'token_uri.txt'), 'utf8').trim()).json;
const html = readFileSync(join(root, 'fixtures', 'animation.html'), 'latin1');
const sysex = midiWithSysex();
const sysexHtml = html.replace(/(id="midi">)[^<]*(<\/script>)/, `$1${sysex.toString('base64')}$2`);
if (sysexHtml === html) throw new Error('MIDI block not found');
// Settings that do not parse (a token missing): the art must still render, ▶ stays disabled and the
// parser's error is shown (spec D9). Range checks are Cairo's job, not the page's.
const invalidHtml = html.replace(/(id="settings">)[^<]*(<\/script>)/, '$1 1,1,30,40,64,0$2');
if (invalidHtml === html) throw new Error('settings block not found');
const INVALID_ERROR = 'settings: malformed: token 6';
// The engine's gzip payload with one byte changed mid-stream: the shim rejects it (D9: the art
// renders, ▶ stays disabled, the player's error is shown).
const corruptHtml = withGzipPayload(html, (p) => {
  const b = Buffer.from(p, 'base64');
  b[b.length >> 1] ^= 0x55;
  return b.toString('base64');
});
// Token 1's SVG with a <script> element in it, in place of the art block, which runs to the end of
// the page: the parser ends the block at the SVG's `</script>` and reads the rest as markup.
const unsafeHtml = html.slice(0, html.indexOf(ART_OPEN) + ART_OPEN.length) + unsafeSvg(TOKENS[1].name, TOKENS[1].tier);
const unsafeArt = parseArtBlock(unsafeHtml);
if (!unsafeArt.rest) throw new Error('unsafe SVG variant not truncated');
const asData = (h) => 'data:text/html;base64,' + Buffer.from(h, 'latin1').toString('base64');
// [label, url, expected error (an invalid variant) and what the console logs, or the truncated art,
// or the full-size Beast (token 4)]
const targets = [
  ['fixtures/animation.html (file://)', pathToFileURL(join(root, 'fixtures', 'animation.html')).href],
  ['token_uri.txt animation_url (data: URI)', token.animation_url],
  ['SysEx MIDI variant (data: URI)', asData(sysexHtml)],
  ['unparsable settings variant 1,1,30,40,64,0 (data: URI)', asData(invalidHtml), { error: INVALID_ERROR, logged: [INVALID_ERROR] }],
  ['corrupt gzipped engine variant (data: URI)', asData(corruptHtml), { error: ENGINE_MISSING, logged: ['gunzip:', ENGINE_MISSING] }],
  ['unsafe SVG variant, a <script> element in the art (data: URI)', asData(unsafeHtml), { truncatedArt: unsafeArt.art }],
  ['token 4, a full-size Beast (data: URI)', decodeTokenUri(tokenUriSpliced(4)).json.animation_url, { real: true }],
];

const { browser } = await launchBrowser();
let failed = false;
for (const [label, url, expected] of targets) {
  console.log(label);
  const invalid = expected?.error ? expected : undefined, truncatedArt = expected?.truncatedArt, real = expected?.real;
  // The art is 250x350: at this viewport the <img> shows it at 1:1.
  const context = await browser.newContext({ viewport: { width: 250, height: 350 } });
  await context.addInitScript(instrument);
  const requests = [], blocked = [];
  await context.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith('data:') || u.startsWith('file:')) return route.continue();
    blocked.push(u);
    return route.abort();
  });
  const page = await context.newPage();
  page.on('request', (r) => requests.push(r.url().slice(0, 40)));
  // Playwright's request events skip data: URLs; Chromium's DevTools protocol sees them (null on
  // the other engines).
  const cdpRequests = await dataRequestLog(context, page);
  // What the page logs as errors or throws uncaught, as text, on every engine (awaited before use).
  const logged = collectErrors(page);
  const name = label.split(' ')[0].replace(/\W/g, '_');
  try {
    await page.goto(url);
    await page.waitForFunction(() => {
      const b = document.getElementById('play'), e = document.getElementById('error');
      return !b.disabled || !e.hidden;
    });
    await page.waitForFunction(() => document.querySelector('img')?.complete);
    const dims = await page.$eval('img', (e) => [e.naturalWidth, e.naturalHeight]);
    const png = decodePng(await page.screenshot());
    if (shotDir) writeFileSync(join(shotDir, `${name}_page.png`), await page.screenshot());
    const red = png.pixel(125, 129), card = png.pixel(30, 250); // clear of the ▶ button and the error line
    if (real) {
      check(dims[0] === 250 && dims[1] === 350, `art <img> loaded (${dims.join('x')})`);
      // The Beast card: not the black page background in the middle of the art.
      const mid = png.pixel(125, 175);
      check(mid.join() !== '0,0,0', `real Beast art rendered (pixel ${mid})`);
    } else if (truncatedArt === undefined) {
      check(dims[0] === 250 && dims[1] === 350, `art <img> loaded (${dims.join('x')})`);
      check(red[0] > 240 && red[1] < 20 && red[2] < 20, `foreignObject PNG rendered (pixel ${red})`);
      check(card.join() === '30,30,34', `card background rendered (pixel ${card})`);
    }
    if (truncatedArt !== undefined) {
      const st = await page.evaluate(() => {
        // Everything the parser put after the art block: the rest of the SVG, as page elements.
        const leaked = [...document.querySelectorAll('#art ~ *, #art ~ * *')];
        return {
          art: document.getElementById('art').textContent,
          leaked: leaked.map((e) => e.localName),
          text: leaked.find((e) => e.localName === 'text')?.textContent,
          gzipTags: document.querySelectorAll('script[type="text/javascript+gzip"]').length,
        };
      });
      check(st.art === truncatedArt, `the parser ended the art block at the SVG's </script> (${st.art.length} bytes kept, as parseArtBlock predicts)`);
      check(dims[0] === 0 && dims[1] === 0, 'the art <img> is broken: the truncated SVG does not parse');
      check(st.leaked.includes('style') && st.text === TOKENS[1].name,
        `the rest of the SVG became page markup (${st.leaked.length} elements, including <style> and <text>${st.text}</text>)`);
      check(st.gzipTags === 0 && !(await page.$eval('#play', (b) => b.disabled)), 'the engine loaded and ▶ is enabled: only the art is broken');
      const errors = await logged();
      check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
    } else if (invalid) {
      check(await page.$eval('#play', (b) => b.disabled), '▶ is disabled');
      const shown = await page.textContent('#error');
      check(shown === invalid.error && (await page.isVisible('#error')) && (await page.$eval('#play', (b) => b.title)) === invalid.error,
        `error shown: ${JSON.stringify(shown)}`);
      await page.click('#play', { force: true });
      check((await page.evaluate(() => window.__check.constructed)) === 0, 'clicking the disabled ▶ constructs no synth');
      const errors = await logged();
      check(errors.length === invalid.logged.length && invalid.logged.every((m, i) => errors[i].includes(m)),
        `only the expected console errors (${errors.map((e) => JSON.stringify(e.split('\n')[0])).join(', ')})`);
    } else {
      const inflated = await page.evaluate(() => ({
        tags: document.querySelectorAll('script[type="text/javascript+gzip"]').length,
        engine: document.head.querySelector('script')?.textContent,
      }));
      check(inflated.tags === 0 && inflated.engine === engineSource(), `the shim inflated the gzipped engine (${inflated.engine?.length} bytes, the pinned build)`);
      check(!(await page.$eval('#play', (b) => b.disabled)), '▶ is enabled');
      // Playback starts once the AudioContext's resume() settles, which takes up to ~2 s on Firefox
      // with a null audio sink: wait for it (the checks below report a start that never came).
      const t0 = Date.now();
      await page.click('#play');
      await page.waitForFunction(() => window.__check.synth?.playing, null, { timeout: 10000 }).catch(() => {});
      console.log(`  info ▶ to playback: ${Date.now() - t0} ms`);
      const st = await page.evaluate((program) => {
        const { synth, opts, constructed } = window.__check;
        return {
          constructed, opts, state: synth.getAudioContext().state, loop: synth.loop, loopEnd: synth.loopEnd,
          lfo: synth.program[program].p[1].f, kick: synth.drummap[36 - 35].p[0].p, reverbLev: synth.reverbLev, masterVol: synth.masterVol,
        };
      }, real ? 0 : 80);
      check(st.constructed === 1 && st.state === 'running', `▶ starts TinySynth (AudioContext ${st.state})`);
      if (real) {
        check(JSON.stringify(st.opts) === '{"quality":1,"useReverb":0,"voices":64}' && st.masterVol === 0.4,
          'constructed with the reference settings: quality 1, no reverb, volume 40, 64 voices');
        check(st.lfo === 6 && st.kick === 0.2813, 'reference lead on program 0 (6 Hz LFO) and reference kick on drum 36 installed');
        check(st.loop === 1 && st.loopEnd === 58560, 'loops at the score\'s End-of-Track (tick 58560)');
      } else {
        check(JSON.stringify(st.opts) === '{"quality":1,"useReverb":1,"voices":64}' && st.reverbLev === 1 && st.masterVol === 0.4,
          'constructed with the token settings: quality 1, reverb 100, volume 40, 64 voices');
        check(st.lfo === 6 && st.kick === 0.25, 'custom lead on program 80 (6 Hz LFO) and custom kick on drum 36 installed');
        check(st.loop === 1 && st.loopEnd === 192, 'loops at End-of-Track (tick 192)');
      }
      const errors = await logged();
      check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
    }
    check(blocked.length === 0, `no network requests (requests seen: ${[...new Set(requests.map((r) => r.split(':')[0] + ':'))].join(' ')})`);
    if (cdpRequests) {
      check(cdpRequests.length > 0 && !cdpRequests.some((u) => u.startsWith('data:text/javascript')),
        `the gzip tag's data: URI was never fetched (${cdpRequests.length} requests seen by the DevTools protocol)`);
    } else {
      console.log('  skip the gzip tag\'s data: URI was never fetched: Chromium-only (DevTools protocol); ' +
        'scripts/page_check.mjs proves it on every engine with a CSP');
    }
  } catch (e) {
    failed = true;
    console.log(`  FAIL ${e.message}`);
  }
  await context.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
