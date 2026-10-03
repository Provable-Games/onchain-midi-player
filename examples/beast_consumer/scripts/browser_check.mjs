#!/usr/bin/env node
// Optional headless check of the decoded page, with Playwright (not a dependency of this repo).
//
// Loads the page three ways: fixtures/animation.html from disk, the exact
// data:text/html;base64,... animation_url from fixtures/token.json, and a variant of that page whose
// MIDI block holds a file with SysEx (F0) and escape (F7) events (same notes, same End-of-Track). For each it checks that the
// player parsed the settings and MIDI blocks, that the art rendered (including the PNG inside the
// SVG's foreignObject, by sampling a screenshot pixel), that the mock Play button works, that
// there are no console errors, and that nothing was requested over the network.
//
// Usage (from examples/beast_consumer):
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core \
//   CHROME=/path/to/chrome-headless-shell [LD_LIBRARY_PATH=...] \
//   node scripts/browser_check.mjs [screenshot_dir]

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { inflateSync } from 'node:zlib';
import { midiWithSysex } from './reference.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { PLAYWRIGHT_CORE, CHROME } = process.env;
if (!PLAYWRIGHT_CORE) {
  console.error('set PLAYWRIGHT_CORE to a playwright-core directory (and CHROME to a Chromium binary)');
  process.exit(2);
}
const { chromium } = createRequire(import.meta.url)(PLAYWRIGHT_CORE);
const shotDir = process.argv[2];

function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Minimal PNG decoder (8-bit RGB/RGBA, non-interlaced), enough for Playwright screenshots. */
function decodePng(buf) {
  let p = 8, width = 0, height = 0, channels = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error('unsupported PNG');
      channels = { 2: 3, 6: 4 }[data[9]];
    } else if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)), stride = width * channels, px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? px[y * stride + x - channels] : 0, b = y ? px[(y - 1) * stride + x] : 0;
      const c = x >= channels && y ? px[(y - 1) * stride + x - channels] : 0;
      const pred = [0, a, b, (a + b) >> 1, paeth(a, b, c)][f];
      px[y * stride + x] = (line[x] + pred) & 255;
    }
  }
  return { width, height, pixel: (x, y) => [...px.subarray(y * stride + x * channels, y * stride + x * channels + 3)] };
}

function check(cond, msg) {
  if (!cond) throw new Error(`check failed: ${msg}`);
  console.log(`  ok  ${msg}`);
}

const token = JSON.parse(readFileSync(join(root, 'fixtures', 'token.json'), 'utf8'));
const svgLen = Buffer.from(token.image.slice('data:image/svg+xml;base64,'.length), 'base64').length;
const html = readFileSync(join(root, 'fixtures', 'animation.html'), 'latin1');
const sysex = midiWithSysex();
const sysexHtml = html.replace(/(id="midi">)[^<]*(<\/script>)/, `$1${sysex.toString('base64')}$2`);
if (sysexHtml === html) throw new Error('MIDI block not found');
// [label, url, expected MIDI byte count]
const targets = [
  ['fixtures/animation.html (file://)', pathToFileURL(join(root, 'fixtures', 'animation.html')).href, 112],
  ['token.json animation_url (data: URI)', token.animation_url, 112],
  ['SysEx MIDI variant (data: URI)', 'data:text/html;base64,' + Buffer.from(sysexHtml, 'latin1').toString('base64'), sysex.length],
];

const browser = await chromium.launch({ executablePath: CHROME || undefined, env: process.env });
let failed = false;
for (const [label, url, midiBytes] of targets) {
  console.log(label);
  const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
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
  try {
    await page.goto(url);
    await page.waitForFunction(() => window.__player && (window.__player.ready || window.__player.error));
    const st = await page.evaluate(() => window.__player);
    check(!st.error, `player initialised${st.error ? ': ' + st.error : ''}`);
    const s = st.settings;
    check(s.quality === 1 && s.reverb === 100 && s.master_vol === 40 && s.voices === 64 && s.waves.length === 0,
      'settings: quality 1, reverb 100, volume 40, 64 voices, no custom waves');
    const lead = s.timbres[0], kick = s.timbres[1];
    check(s.timbres.length === 2 && !lead.drum && lead.slot === 80 && lead.operators.length === 2 &&
      lead.operators[0].wave === 'Triangle' && lead.operators[1].route === 1 && lead.operators[1].ratio === 0 &&
      lead.operators[1].offset_hz === 60000,
    'settings: chip lead on program 80 (triangle + 6 Hz LFO, route 1)');
    check(kick.drum && kick.slot === 36 && kick.operators[0].pitch_ratio === 2500, 'settings: custom kick on drum 36');
    const m = st.midi;
    check(st.midiBytes === midiBytes && m.format === 0 && m.ppq === 48 && m.bpm === 120, `MIDI: ${midiBytes} bytes, format 0, PPQ 48, 120 BPM`);
    check(m.notes === 4 && m.drumHits === 4 && m.endTick === 192 && m.bars === 1, 'MIDI: 4 notes, 4 drum hits, End-of-Track at tick 192 (1 bar)');
    check(st.artChars === svgLen, `art block holds exactly the SVG (${st.artChars} chars)`);
    const img = await page.$('#view');
    await page.waitForFunction(() => document.getElementById('view').complete);
    const dims = await img.evaluate((e) => [e.naturalWidth, e.naturalHeight]);
    check(dims[0] === 250 && dims[1] === 350, `art <img> loaded (${dims.join('x')})`);
    const shot = await img.screenshot();
    if (shotDir) writeFileSync(join(shotDir, label.split(' ')[0].replace(/\W/g, '_') + '_art.png'), shot);
    const png = decodePng(shot);
    const red = png.pixel(125, 129), card = png.pixel(30, 300);
    check(red[0] > 240 && red[1] < 20 && red[2] < 20, `foreignObject PNG rendered (pixel ${red})`);
    check(card.join() === '30,30,34', `card background rendered (pixel ${card})`);
    await page.click('#play');
    const status = await page.textContent('#status');
    check((await page.evaluate(() => window.__player.played)) && status.includes('MOCK'), 'Play (mock) runs');
    const eng = await page.evaluate(() => window.__player.engine);
    check(JSON.stringify(eng.opts) === '{"quality":1,"useReverb":1,"voices":64}' &&
      JSON.stringify(eng.calls) === '[["setQuality",1],["setMasterVol",0.4],["setReverbLev",1],["setVoices",64]]',
    'installSettings: constructor options, then quality, volume, reverb and voices');
    const ops = eng.timbres.map((t) => t.ops);
    check(eng.timbres.length === 2 && ops[0][1].g === 1 && ops[0][1].t === 0 && ops[0][1].f === 6 &&
      ops[0][0].w === 'triangle' && ops[1][0].p === 0.25, 'installSettings: timbres converted for setTimbre');
    if (shotDir) await page.screenshot({ path: join(shotDir, label.split(' ')[0].replace(/\W/g, '_') + '_page.png') });
    check(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
    check(blocked.length === 0, `no network requests (requests seen: ${[...new Set(requests.map((r) => r.split(':')[0] + ':'))].join(' ')})`);
  } catch (e) {
    failed = true;
    console.log(`  FAIL ${e.message}`);
  }
  await context.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
