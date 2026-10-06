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
 * 3. ▶ (a click or tap): the first one constructs TinySynth with the settings (`createSynth`) and
 *    builds its noise buffer (`prewarm`), which the engine would otherwise build inside `playMIDI()`,
 *    blocking the page after the clock it starts from was read and shifting the art against the
 *    sound. Every ▶ resumes the AudioContext inside the gesture, reloads the MIDI (back to tick 0 at the
 *    song's starting tempo), loops at End-of-Track (`setLoop(1)`, `setLoopEnd(maxTick)`) and starts
 *    playback. With `loopEnd` set, the engine keeps any rest before the first event on every pass.
 * 4. The art restarts when tick 0 is heard: at `getPlayStatus().startTime` (the AudioContext time
 *    at which tick 0 of the current pass sounds) plus the context's output latency, or at once if
 *    the engine is not playing (a song with no events but tempo, which it leaves stopped). Then it
 *    restarts again at every pass: `startTime` moves to the next pass as soon as the current
 *    pass's last event is scheduled (up to 0.2 s, plus any rest after that event, before the next
 *    pass starts), and the player, polling it every 50 ms, restarts the art at the new time. That bounds
 *    any drift between the image's clock and the audio clock to one pass; when the pass is a whole
 *    multiple of the art's period, the art is already at its start there, so the restart is not
 *    seen. At most one restart is pending; when it fires, the next is timed at once. On a short
 *    loop, where startTime can move on by more than one pass between polls, the player walks pass
 *    by pass (`checkMidi`'s pass length) from the last pass it timed. A pass start already past
 *    when reached, or a pass's restart timer that fires more than 50 ms late (the page was
 *    stalled), is skipped, so the art keeps its phase until the next pass rather than restarting
 *    late. The restart on ▶ is never skipped.
 * 5. Background audio, best effort (feature-detected, each step in its own try/catch, failing
 *    silently): ▶ also plays a silent looping <audio> element (a generated 6 s WAV in a blob: URL),
 *    which gives mobile browsers and desktop media hubs a media session (notification, lock screen,
 *    hardware keys) that keeps the page alive. `navigator.mediaSession` gets the art's title and its
 *    embedded bitmap (nearest-neighbour upscaled, see `arm`) as artwork, and play, pause and stop
 *    handlers that run the same code as ▶ and ■. A pause of the element from outside (the
 *    notification, a headset, a call) stops the player. On iOS,
 *    `navigator.audioSession.type = "playback"` makes Web Audio ignore the silent switch. If the
 *    element cannot play (a host CSP without `media-src blob:`), the player stops when the page
 *    becomes hidden, as it has no media session to keep it playing. The synth stays on the
 *    AudioContext's destination: the element carries no sound.
 * 6. ■ stops playback (TinySynth's `stopMIDI` cuts every voice, drum hits and notes scheduled
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

/**
 * A pass's art restart whose timer fires later than this after its time (a stalled page) is
 * skipped: the art keeps its phase until the next pass rather than restarting late.
 */
const LATE_SECONDS = 0.05;
/**
 * The longest delay setTimeout takes, in ms (2^31 - 1, about 24.8 days); a longer one fires at once.
 * A pass start further ahead than this is left for a later poll.
 */
const MAX_TIMER_MS = 2147483647;
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

/** Fallback title of the media session, for art without a <title>. */
export const MEDIA_TITLE = "Onchain music";

/** A silent 6 s WAV (8 kHz, 8-bit mono): long enough for Chrome Android to show media controls (5 s). */
export function silentWav() {
  const b = new Uint8Array(48044).fill(128);
  // RIFF, size 48036, WAVE, "fmt ", 16, PCM, 1 channel, 8000 Hz, 8000 B/s, 1 B/frame, 8 bits, "data", 48000
  b.set([82, 73, 70, 70, 164, 187, 0, 0, 87, 65, 86, 69, 102, 109, 116, 32, 16, 0, 0, 0, 1, 0, 1, 0, 64, 31, 0, 0, 64, 31, 0, 0, 1, 0, 8, 0, 100, 97, 116, 97, 128, 187, 0, 0]);
  return b;
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
    let shown = 0; // the restart whose image is shown
    /**
     * Restarts the art: a new <img> with a distinct URL, swapped in once decoded (so the art never
     * blinks out), unless ▶/■ was pressed again in the meantime, or a later restart's image is
     * already shown (restarts at every pass can decode out of order).
     * @param {number} current the press that scheduled it
     */
    const restartArt = (current) => {
      if (!art) return;
      const n = ++restarts;
      const img = document.createElement("img");
      img.alt = "";
      img.onload = () => {
        if (current !== run || n < shown || !art) return;
        shown = n;
        art.replaceWith(img);
        art = img;
      };
      img.src = artUrl(svg, n);
    };

    // 2. The engine, settings and MIDI; on failure ▶ stays disabled and no synth is created.
    /** @type {import("./settings.js").TinySynthSettings} */
    let settings;
    /** @type {Uint8Array} */
    let midi;
    let pass = 0; // one pass in seconds, under the MIDI's tempo map: the engine's pass with loopEnd = maxTick
    try {
      // Missing if its gzip payload did not inflate (the shim logged why) or the engine failed.
      if (typeof (/** @type {any} */ (window).WebAudioTinySynth) != "function") throw new Error(ENGINE_MISSING);
      settings = decodeSettings($("settings").textContent || "");
      midi = decodeMidi($("midi").textContent || "");
      pass = checkMidi(midi).seconds;
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
    /** @type {HTMLAudioElement | null} the silent element of the media session */
    let silent = null;
    let background = false; // the silent element is playing: the page may keep playing when hidden
    let armed = false; // the media session's metadata and handlers are set
    /** @param {() => unknown} f best effort: a failure is silent */
    const attempt = (f) => {
      try {
        f();
      } catch (e) {}
    };
    /** @param {boolean} on */
    const setPlaying = (on) => {
      playing = on;
      icon.setAttribute("d", on ? STOP_ICON : PLAY_ICON);
      button.setAttribute("aria-label", on ? "Stop" : "Play");
      if (!on) attempt(() => silent && silent.pause());
      attempt(() => (navigator.mediaSession.playbackState = on ? "playing" : "paused"));
    };
    const stop = () => {
      ++run;
      window.clearTimeout(timer);
      window.clearInterval(poll);
      timer = 0;
      setPlaying(false);
      synth.stopMIDI();
    };
    /** The media session, once: the title and art, and the handlers that run ▶ and ■. */
    const arm = () => {
      armed = true;
      /** @param {Array<{src: string, sizes: string, type: string}>} artwork */
      const meta = (artwork) => attempt(() => (navigator.mediaSession.metadata = new MediaMetadata({ title, artwork })));
      let title = MEDIA_TITLE;
      attempt(() => (title = new DOMParser().parseFromString(svg, "image/svg+xml").getElementsByTagName("title")[0].textContent || title));
      meta([]);
      for (const action of /** @type {const} */ (["play", "pause", "stop"])) {
        attempt(() => navigator.mediaSession.setActionHandler(action, action == "play" ? () => playing || start() : () => playing && stop()));
      }
      // Artwork: the art's own bitmap (the first embedded PNG, GIF or WebP: a Beast's 32x32 sprite,
      // or the first square frame of a sprite sheet), scaled up with nearest-neighbour on a canvas to
      // the sizes Chrome Android asks for (512, and 256 on low-end devices), centred, at a whole
      // factor when it fits. The card SVG itself is not drawn: its foreignObject can taint the
      // canvas, and it is not square. Art without a bitmap gets no artwork.
      const raster = /data:image\/(?:png|gif|webp);base64,[A-Za-z0-9+/=]+/.exec(svg);
      if (raster) {
        attempt(() => {
          const img = document.createElement("img");
          img.onload = () => attempt(() => {
            const h = img.naturalHeight;
            const w = img.naturalWidth % h ? img.naturalWidth : h;
            const canvas = document.createElement("canvas");
            meta([512, 256].map((n) => {
              canvas.width = canvas.height = n;
              const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
              g.imageSmoothingEnabled = false;
              const k = n >= Math.max(w, h) ? Math.floor(n / Math.max(w, h)) : n / Math.max(w, h);
              g.drawImage(img, 0, 0, w, h, (n - w * k) / 2, (n - h * k) / 2, w * k, h * k);
              return { src: canvas.toDataURL("image/png"), sizes: n + "x" + n, type: "image/png" };
            }));
          });
          img.src = raster[0];
        });
      }
    };
    /** The iOS audio session and the silent element, inside the gesture, before the AudioContext resumes. */
    const session = () => {
      attempt(() => (/** @type {any} */ (navigator).audioSession.type = "playback"));
      background = false;
      attempt(() => {
        if (!silent) {
          silent = new Audio(URL.createObjectURL(new Blob([silentWav()], { type: "audio/wav" })));
          silent.loop = true;
          // Paused from outside (the notification, a headset, a call): the same as ■. It is paused
          // here only if ▶ has not started it again since.
          silent.onpause = () => playing && silent && silent.paused && stop();
        }
        silent.play().then(() => (background = true), () => {});
      });
      if (!armed) attempt(arm);
    };
    // Without a media session to keep it playing, a hidden page stops.
    document.addEventListener("visibilitychange", () => document.hidden && playing && !background && stop());
    const start = () => {
      const current = ++run;
      session();
      try {
        if (!synth) {
          synth = createSynth(/** @type {any} */ (window).WebAudioTinySynth, settings);
          // The engine builds its noise buffer on first need, which blocks for tens of ms: here, in
          // the gesture, rather than in playMIDI(), where it would delay what the clock is read for.
          synth.prewarm();
        }
        const ctx = synth.getAudioContext();
        setPlaying(true);
        ctx.resume().then(() => {
          if (current !== run) return;
          synth.loadMIDI(midi);
          synth.setLoop(1);
          synth.setLoopEnd(synth.getPlayStatus().maxTick);
          synth.playMIDI();
          /** @type {number | null | undefined} the pass start the art was last timed to (or skipped) */
          let synced;
          /**
           * Times an art restart to tick 0 of a pass, as heard, unless one is pending. On ▶
           * (`first`): the current pass, at once without a pass start. Afterwards: the pass after
           * the last one synced, once startTime has reached it. On a short loop startTime can move
           * on by more than one pass between calls, so this walks pass by pass from the last one
           * synced, skipping any whose start is already past, and takes the engine's own value
           * when it reaches it. A pass start more than MAX_TIMER_MS ahead (a pass of weeks) is
           * left unsynced, so a later poll times it once it is within reach.
           * @param {boolean} [first]
           */
          const sync = (first) => {
            const latest = synth.getPlayStatus().startTime;
            const lag = ctx.outputLatency || 0;
            let start = latest;
            if (timer || latest === synced) return;
            if (!first && latest !== null && synced != null) {
              start = synced + pass;
              while (start < latest - 1e-6 && start + lag < ctx.currentTime) start += pass;
              if (start > latest - 1e-6) start = latest;
            }
            const delay = start === null ? 0 : start - ctx.currentTime + lag;
            if (delay * 1000 > MAX_TIMER_MS) return;
            synced = start;
            if (!first && (start === null || delay < 0)) return;
            timer = window.setTimeout(() => {
              timer = 0;
              if (first || ctx.currentTime - start - lag < LATE_SECONDS) restartArt(current);
              sync();
            }, Math.max(0, delay * 1000));
          };
          sync(true);
          poll = window.setInterval(() => sync(), 50);
        }).catch((/** @type {unknown} */ e) => {
          setPlaying(false);
          fail(e);
        });
      } catch (e) {
        setPlaying(false);
        fail(e);
      }
    };
    button.onclick = () => (playing ? stop() : start());
    button.disabled = false;
  });
}
