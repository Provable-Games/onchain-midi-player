// @ts-check
/**
 * The page's player: shows the token's art, then plays its MIDI with TinySynth behind a ▶/■ toggle.
 *
 * The page (see scripts/build_page.mjs) is the engine, gzipped in a
 * `<script type="text/javascript+gzip" src="data:...">` that the gunzip shim (`player/gunzip.js`,
 * the next `<script>`) replaces with the inflated engine while the page is parsed, then this file
 * and `player/settings.js` flattened into one plain script (their `import`/`export` lines removed,
 * wrapped in a function, minified, and not compressed, so the art and errors never depend on
 * inflation), then three inert text blocks that follow the player in the document: `#settings` (SETTINGS, after PAGE's alignment spaces), `#midi` (base64 of the MIDI file,
 * then D's alignment spaces) and `#art` (the raw SVG, unclosed until the end of the document). They
 * exist only once the document is parsed, so the player starts on DOMContentLoaded:
 *
 * 1. Art first: the SVG is shown in an <img> as a base64 data URL, before and independently of
 *    everything else. Nothing that follows can hide it.
 * 2. The engine must have loaded (`WebAudioTinySynth` defined: the shim inflated it and it ran).
 *    SETTINGS is parsed strictly (`decodeSettings`: the grammar, Cairo types and count bounds; the
 *    class has already checked it with `settings::validate`), and the MIDI is
 *    decoded and checked (`decodeMidi`). On any failure (spec D9) ▶ stays disabled, the exact
 *    error is shown and put in its title and logged, and no synth is ever created. Otherwise ▶ is
 *    enabled.
 * 3. ▶ (a click or tap): the first one constructs TinySynth with the settings (`createSynth`).
 *    Every ▶ resumes the AudioContext inside the gesture, reloads the MIDI (back to tick 0 at the
 *    song's starting tempo), loops at End-of-Track (`setLoop(1)`, `setLoopEnd(maxTick)`) and starts
 *    playback. With `loopEnd` set, the engine keeps any rest before the first event on every pass.
 * 4. The art restarts when tick 0 is heard: at `getPlayStatus().startTime` (the AudioContext time
 *    at which tick 0 of the current pass sounds) plus the context's output latency, or at once if
 *    the engine is not playing (a song with no events but tempo, which it leaves stopped). Then it
 *    restarts again at every pass: `startTime` moves to the next pass up to 0.2 s before that pass
 *    starts, and the player, polling it every 50 ms, restarts the art at the new time. That bounds
 *    any drift between the image's clock and the audio clock to one pass; when the pass is a whole
 *    multiple of the art's period, the art is already at its start there, so the restart is not
 *    seen. At most one restart is pending: a pass seen while one is pending waits for the next
 *    poll, and a pass start already past when seen (the page was stalled) is skipped, so the art
 *    keeps its phase until the next pass rather than restarting late.
 * 5. ■ stops playback (TinySynth's `stopMIDI` cuts every voice, drum hits and notes scheduled
 *    ahead included, and cancels the controller changes it had scheduled), and cancels the pending
 *    art restart and the polling. The art keeps running.
 *
 * Plain browser JavaScript: no modules in the page, no eval, no network requests, no storage. Works
 * in `<iframe sandbox="allow-scripts">` and under a CSP that allows only inline scripts and styles
 * and data: images.
 */

import { createSynth, decodeSettings } from "./settings.js";

/** Icon path data (24x24 viewBox) of the toggle: ▶ while stopped, ■ while playing. */
export const PLAY_ICON = "M8 5v14l11-7z";
export const STOP_ICON = "M6 6h12v12H6z";

/** The error shown when the engine did not load (it was not inflated, or failed when it ran). */
export const ENGINE_MISSING = "engine: TinySynth did not load";

/** A loop shorter than this would make TinySynth's scheduler spin; such MIDI is rejected. */
const MIN_LOOP_SECONDS = 0.05;
/**
 * TinySynth decodes text meta events (text, copyright, track and instrument names, device) with
 * `String.fromCharCode.apply`, whose argument count browsers limit; longer ones are rejected.
 */
const MAX_TEXT_BYTES = 4096;

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
 * The rules come from TinySynth's original parser, which stopped reading a track only at an
 * End-of-Track event (not at the chunk length), started running status at 0x90, kept it across meta
 * and SysEx events, and assumed a 3-byte tempo. The pinned engine (the fork from commit 4b29ff1 on)
 * reads with bounds and throws a coded `SMF_*` error on malformed input, but still accepts some
 * files this rejects (a track without End-of-Track, bytes after it or after the last track, F7
 * events, split SysEx). So the page keeps this stricter check and runs it first: malformed files
 * fail here, with these messages, and whatever this accepts the engine reads without throwing, to
 * the same End-of-Track tick (player/player.test.js).
 *
 * This rejects, beyond plain format errors: running status with no channel status before it in
 * the track, or after a meta or SysEx event; a tempo event that is not 3 bytes (with a one-byte
 * length) or is 0; status bytes F1-F6 and F8-FE; data bytes above 127; a track without
 * End-of-Track exactly at its end; text meta events over 4096 bytes; F7 events (TinySynth turns
 * them into SysEx) and SysEx split over several events; format 2 and SMPTE timing; and a loop of
 * under 50 ms (End-of-Track at tick 0, or a tempo so fast that one
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
        const at = p;
        const n = vlq();
        if (type === 0x2f) {
          if (n || p !== end) fail("End-of-Track is not at the end of its track");
          break;
        }
        if ((type >= 1 && type <= 4) || type === 9) {
          if (n > MAX_TEXT_BYTES) fail("text event longer than " + MAX_TEXT_BYTES + " bytes");
        } else if (type === 0x51) {
          // TinySynth reads the tempo at a fixed offset: its length must be the single byte 03.
          if (n !== 3 || p !== at + 1 || !(u[p] | u[p + 1] | u[p + 2])) fail("bad tempo");
          tempos.push([tick, (u[p] << 16) | (u[p + 1] << 8) | u[p + 2]]);
        }
        skip(n);
        run = 0;
      } else if (st === 0xf0) {
        // TinySynth sends each F0 event as one complete SysEx message: a message split over several
        // events (continued with F7 events) would be cut up.
        const n = vlq();
        skip(n);
        if (!n || u[p - 1] !== 0xf7) fail("SysEx not complete in one event");
        run = 0;
      } else if (st === 0xf7) fail("SysEx continuation or escape (F7) events are not supported");
      else if (st > 0xef) fail("unexpected status byte");
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

    let run = 0; // every press of ▶/■ invalidates a pending start and art restart

    // 1. Art first, on its own.
    /** @type {HTMLImageElement | null} */
    let art = null;
    let svg = "";
    let restarts = 0;
    try {
      svg = $("art").textContent || "";
      art = document.createElement("img");
      art.alt = "";
      art.src = artUrl(svg);
      document.body.prepend(art);
    } catch (e) {
      console.error(e);
    }
    /**
     * Restarts the art: a new <img> with a distinct URL, swapped in once decoded (so the art never
     * blinks out), unless ▶/■ was pressed again in the meantime.
     * @param {number} current the press that scheduled it
     */
    const restartArt = (current) => {
      if (!art) return;
      const img = document.createElement("img");
      img.alt = "";
      img.onload = () => {
        if (current !== run || !art) return;
        art.replaceWith(img);
        art = img;
      };
      img.src = artUrl(svg, ++restarts);
    };

    // 2. The engine, settings and MIDI; on failure ▶ stays disabled and no synth is created.
    /** @type {import("./settings.js").SynthSettings} */
    let settings;
    /** @type {Uint8Array} */
    let midi;
    try {
      // Missing if its gzip payload did not inflate (the shim logged why) or the engine failed.
      if (typeof (/** @type {any} */ (window).WebAudioTinySynth) != "function") throw new Error(ENGINE_MISSING);
      settings = decodeSettings($("settings").textContent || "");
      midi = decodeMidi($("midi").textContent || "");
    } catch (e) {
      fail(e);
      return;
    }

    // 3-5. The ▶/■ toggle, and the art restarts.
    /** @type {any} */
    let synth = null;
    let playing = false;
    let timer = 0; // the pending art restart, or 0
    let poll = 0; // the interval that follows startTime to each pass
    /** @param {boolean} on */
    const setPlaying = (on) => {
      playing = on;
      icon.setAttribute("d", on ? STOP_ICON : PLAY_ICON);
      button.setAttribute("aria-label", on ? "Stop" : "Play");
    };
    button.onclick = () => {
      const current = ++run;
      window.clearTimeout(timer);
      window.clearInterval(poll);
      timer = 0;
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
          synth.setLoopEnd(synth.getPlayStatus().maxTick);
          synth.playMIDI();
          /** @type {number | null | undefined} the pass start the art was last timed to */
          let synced;
          /**
           * Times an art restart to tick 0 of the current pass, as heard. On ▶ (`first`) always,
           * at once without a pass start; afterwards only for a new pass start that is still
           * ahead, and only when no restart is pending.
           * @param {boolean} [first]
           */
          const sync = (first) => {
            const start = synth.getPlayStatus().startTime;
            if (start === synced || (timer && !first)) return;
            synced = start;
            const delay = start === null ? 0 : start - ctx.currentTime + (ctx.outputLatency || 0);
            if (!first && (start === null || delay < 0)) return;
            timer = window.setTimeout(() => {
              timer = 0;
              restartArt(current);
            }, Math.max(0, delay * 1000));
          };
          sync(true);
          poll = window.setInterval(() => sync(), 50);
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
