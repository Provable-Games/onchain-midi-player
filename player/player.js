// @ts-check
/**
 * The page's player: shows the token's art, then plays its MIDI with TinySynth behind a ▶/■ toggle.
 *
 * The page (see scripts/build_page.mjs) is the engine `<script>`, then this file and
 * `player/settings.js` flattened into one plain script (their `import`/`export` lines removed,
 * wrapped in a function, minified), then three inert text blocks that follow the player in the
 * document: `#settings` (SETTINGS, after PAGE's alignment spaces), `#midi` (base64 of the MIDI file,
 * then D's alignment spaces) and `#art` (the raw SVG, unclosed until the end of the document). They
 * exist only once the document is parsed, so the player starts on DOMContentLoaded:
 *
 * 1. Art first: the SVG is shown in an <img> as a base64 data URL, before and independently of
 *    everything else. Nothing that follows can hide it.
 * 2. SETTINGS is parsed and validated (`parseSettings`), and the MIDI is decoded and checked
 *    (`decodeMidi`). On any failure (spec D9) ▶ stays disabled, the exact error is shown and put in
 *    its title and logged, and no synth is ever created. Otherwise ▶ is enabled.
 * 3. ▶ (a click or tap): the first one constructs TinySynth with the settings (`createSynth`).
 *    Every ▶ resumes the AudioContext inside the gesture, reloads the MIDI (back to tick 0 at the
 *    song's starting tempo), loops at End-of-Track (`setLoop(1)`, `setLoopEnd(maxTick)`), starts
 *    playback, and restarts the art when the first note is heard: after TinySynth's scheduling
 *    offset (`playTime - currentTime`) plus the context's output latency.
 * 4. ■ stops playback. The art keeps running.
 *
 * Plain browser JavaScript: no modules in the page, no eval, no network requests, no storage. Works
 * in `<iframe sandbox="allow-scripts">` and under a CSP that allows only inline scripts and styles
 * and data: images.
 */

import { createSynth, parseSettings } from "./settings.js";

/** Icon path data (24x24 viewBox) of the toggle: ▶ while stopped, ■ while playing. */
export const PLAY_ICON = "M8 5v14l11-7z";
export const STOP_ICON = "M6 6h12v12H6z";

/** A loop shorter than this would make TinySynth's scheduler spin; such MIDI is rejected. */
const MIN_LOOP_SECONDS = 0.05;

/**
 * Decodes the MIDI block: base64 (strict RFC 4648, `=` padding) after trimming the alignment spaces
 * (U+0020 only), then `checkMidi`. Throws `Error("midi: ...")`.
 * @param {string} text
 * @returns {Uint8Array}
 */
export function decodeMidi(text) {
  const b64 = text.replace(/^ +| +$/g, "");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(b64)) throw new Error("midi: not base64");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  checkMidi(bytes);
  return bytes;
}

/**
 * Checks that `u` is a Standard MIDI File that TinySynth's `loadMIDI` reads exactly as written and
 * that loops safely, and returns its End-of-Track tick (TinySynth's `maxTick`) and the length of one
 * pass in seconds. Throws `Error("midi: ...")` otherwise.
 *
 * TinySynth's parser stops reading a track only at an End-of-Track event (not at the chunk length),
 * starts running status at 0x90, keeps it across meta and SysEx events, and assumes a 3-byte tempo.
 * So this rejects, beyond plain format errors: running status with no channel status before it in
 * the track, or after a meta or SysEx event; a tempo event that is not 3 bytes or is 0; status bytes
 * F1-F6 and F8-FE; data bytes above 127; a track without End-of-Track exactly at its end; format 2
 * and SMPTE timing; and a loop of under 50 ms (End-of-Track at tick 0, or a tempo so fast that one
 * pass takes almost no time), on which the looping scheduler would never catch up.
 * @param {Uint8Array} u
 * @returns {{maxTick: number, seconds: number}}
 */
export function checkMidi(u) {
  let p = 0;
  let end = u.length;
  /** @param {string} what @returns {never} */
  const fail = (what) => {
    throw new Error("midi: " + what + " (byte " + p + ")");
  };
  const byte = () => (p < end ? u[p++] : fail("truncated"));
  const u16 = () => (byte() << 8) | byte();
  const u32 = () => ((u16() << 16) | u16()) >>> 0;
  const tag = () => String.fromCharCode(byte(), byte(), byte(), byte());
  const vlq = () => {
    let v = 0;
    for (let n = 0; ; n++) {
      if (n === 4) fail("bad variable-length number");
      const b = byte();
      v = v * 128 + (b & 127);
      if (b < 128) return v;
    }
  };
  /** Skips `n` bytes of the current track. */
  const skip = (/** @type {number} */ n) => {
    if (n > end - p) fail("truncated");
    p += n;
  };

  if (tag() !== "MThd" || u32() !== 6) fail("not a Standard MIDI File");
  const format = u16();
  const tracks = u16();
  const division = u16();
  if (format > 1) fail("format " + format + " is not supported");
  if (!tracks || (format === 0 && tracks !== 1)) fail("bad track count");
  if (!division || division & 0x8000) fail("SMPTE or zero time division is not supported");
  /** @type {Array<[number, number]>} tempo events: [tick, microseconds per quarter note] */
  const tempos = [];
  let maxTick = 0;
  for (let t = 0; t < tracks; t++) {
    if (tag() !== "MTrk") fail("expected MTrk");
    const len = u32();
    end = p + len;
    if (end > u.length) fail("MTrk length past the end of the file");
    let tick = 0;
    let run = 0;
    for (;;) {
      tick += vlq();
      let st = byte();
      if (st < 128) {
        if (!run) fail("running status without a channel status");
        st = run;
        p--;
      }
      if (st === 0xff) {
        const type = byte();
        const n = vlq();
        if (type === 0x2f) {
          if (n || p !== end) fail("End-of-Track is not at the end of its track");
          break;
        }
        if (type === 0x51) {
          if (n !== 3 || !(u[p] | u[p + 1] | u[p + 2])) fail("bad tempo");
          tempos.push([tick, (u[p] << 16) | (u[p + 1] << 8) | u[p + 2]]);
        }
        skip(n);
        run = 0;
      } else if (st === 0xf0 || st === 0xf7) {
        skip(vlq());
        run = 0;
      } else if (st > 0xef) fail("unexpected status byte");
      else {
        run = st;
        for (let n = (st & 0xe0) === 0xc0 ? 1 : 2; n--;) if (byte() > 127) fail("bad data byte");
      }
    }
    if (tick > maxTick) maxTick = tick;
    end = u.length;
  }
  if (p !== u.length) fail("trailing bytes after the last track");
  // One pass in seconds, under the tempo map (120 BPM until the first tempo event).
  tempos.sort((a, b) => a[0] - b[0]);
  let seconds = 0;
  let at = 0;
  let us = 500000;
  for (const [tick, tempo] of tempos) {
    if (tick >= maxTick) break;
    seconds += ((tick - at) * us) / 1e6 / division;
    at = tick;
    us = tempo;
  }
  seconds += ((maxTick - at) * us) / 1e6 / division;
  if (!(seconds >= MIN_LOOP_SECONDS)) fail("loop shorter than 50 ms");
  return { maxTick, seconds };
}

/**
 * The art as a data URL: the SVG text re-encoded as UTF-8 and base64. `restart` > 0 adds a media
 * type parameter, which gives an equivalent image with a distinct URL, so the browser builds a new
 * image (and animation timeline) rather than reusing the running one.
 * @param {string} svg
 * @param {number} [restart]
 */
export function artUrl(svg, restart = 0) {
  let bin = "";
  for (const b of new TextEncoder().encode(svg)) bin += String.fromCharCode(b);
  return "data:image/svg+xml;" + (restart ? "r=" + restart + ";" : "") + "base64," + btoa(bin);
}

/** Wires up the page. Called once, by the page, when the player script runs. */
export function startPlayer() {
  document.addEventListener("DOMContentLoaded", () => {
    const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
    const button = /** @type {HTMLButtonElement} */ ($("play"));
    const icon = $("icon");
    const message = $("error");
    /** @param {unknown} e */
    const fail = (e) => {
      const text = String((e && /** @type {Error} */ (e).message) || e);
      button.disabled = true;
      button.title = message.textContent = text;
      message.hidden = false;
      console.error(e);
    };

    // 1. Art first, on its own.
    /** @type {HTMLImageElement | null} */
    let art = null;
    let svg = "";
    let restarts = 0;
    const showArt = () => {
      const img = document.createElement("img");
      img.alt = "";
      img.src = artUrl(svg, restarts++);
      if (art) {
        const old = art;
        // Swap once decoded, so the art never blinks out.
        img.onload = img.onerror = () => old.replaceWith(img);
      } else document.body.prepend(img);
      art = img;
    };
    try {
      svg = $("art").textContent || "";
      showArt();
    } catch (e) {
      console.error(e);
    }

    // 2. Settings and MIDI; on failure ▶ stays disabled and no synth is created.
    /** @type {import("./settings.js").SynthSettings} */
    let settings;
    /** @type {Uint8Array} */
    let midi;
    try {
      settings = parseSettings($("settings").textContent || "");
      midi = decodeMidi($("midi").textContent || "");
    } catch (e) {
      fail(e);
      return;
    }

    // 3-4. The ▶/■ toggle.
    /** @type {any} */
    let synth = null;
    let playing = false;
    let run = 0; // invalidates a pending start or art restart on every press
    let timer = 0;
    /** @param {boolean} on */
    const setPlaying = (on) => {
      playing = on;
      icon.setAttribute("d", on ? STOP_ICON : PLAY_ICON);
      button.setAttribute("aria-label", on ? "Stop" : "Play");
    };
    button.onclick = () => {
      const current = ++run;
      window.clearTimeout(timer);
      if (playing) {
        setPlaying(false);
        synth.stopMIDI();
        return;
      }
      try {
        synth = synth || createSynth(/** @type {any} */ (window).WebAudioTinySynth, settings);
        const ctx = synth.getAudioContext();
        setPlaying(true);
        ctx.resume().then(() => {
          if (current !== run) return;
          synth.loadMIDI(midi);
          synth.setLoop(1);
          synth.setLoopEnd(synth.maxTick);
          synth.playMIDI();
          const delay = synth.playTime - ctx.currentTime + (ctx.outputLatency || 0);
          timer = window.setTimeout(showArt, Math.max(0, delay * 1000));
        }).catch((/** @type {unknown} */ e) => {
          setPlaying(false);
          fail(e);
        });
      } catch (e) {
        fail(e);
      }
    };
    button.disabled = false;
  });
}
