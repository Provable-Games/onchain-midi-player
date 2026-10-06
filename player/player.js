// @ts-check
/**
 * The page's player: shows the token's art, then plays its MIDI with TinySynth behind a ▶/❚❚ toggle.
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
 *    sound. Every ▶ resumes the AudioContext inside the gesture; the first that gets it running loads
 *    the MIDI (tick 0 at the song's starting tempo), loops at End-of-Track (`setLoop(1)`,
 *    `setLoopEnd(maxTick)`) and starts playback. With `loopEnd` set, the engine keeps any rest
 *    before the first event on every pass. Later ones resume where ❚❚ paused (step 6).
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
 *    embedded bitmap (a static frame row, see `arm`) as artwork, and play, pause and stop
 *    handlers that run the same code as ▶ and ❚❚ (stop pauses too). A pause of the element from
 *    outside (the notification, a headset, a call) pauses the player. On iOS,
 *    `navigator.audioSession.type = "playback"` makes Web Audio ignore the silent switch. If the
 *    element cannot play (a host CSP without `media-src blob:`), the player pauses when the page
 *    becomes hidden, as it has no media session to keep it playing. The synth stays on the
 *    AudioContext's destination: the element carries no sound.
 * 6. ❚❚ pauses: the AudioContext is suspended (`suspend()`), which freezes its clock, so every voice,
 *    envelope and scheduled event holds, and TinySynth's sequencer, which schedules against that
 *    clock, schedules nothing more; ▶ resumes it (`resume()`) and all of it carries on from there.
 *    Nothing is stopped or reloaded: to start over, reload the page. ❚❚ also cancels the pending
 *    art restart (its pass is timed again on resume) and the polling. The art keeps animating
 *    while paused; on resume it restarts at once with its timeline started as far into the pass as
 *    the music is (`artUrl`'s offset: a negative SMIL `begin`), so it is in phase again.
 *
 * Plain browser JavaScript: no modules in the page, no eval, no network requests, no storage. Works
 * in `<iframe sandbox="allow-scripts">` and under a CSP that allows only inline scripts and styles
 * and data: images.
 */

import { createSynth, decodeSettings } from "./settings.js";

/** Icon path data (24x24 viewBox) of the toggle: ▶ while paused (or not started), ❚❚ while playing. */
export const PLAY_ICON = "M8 5v14l11-7z";
export const PAUSE_ICON = "M6 5h4v14H6zM14 5h4v14h-4z";

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
 * image (and animation timeline) rather than reusing the running one. `offset` > 0 starts that
 * timeline `offset` seconds in: every SMIL animation element (`animate`, `animateTransform`,
 * `animateMotion`, `animateColor`, `set`) without a `begin` gets `begin='-<offset>s'`, which SMIL
 * plays as begun that long ago. A GIF in the art always starts at its first frame.
 * @param {string} svg
 * @param {number} [restart]
 * @param {number} [offset]
 */
export function artUrl(svg, restart = 0, offset = 0) {
  if (offset > 0) svg = svg.replace(/<(animate(?:Transform|Motion|Color)?|set)(?![\w:.-])(?![^>]*\sbegin\s*=)/g, "<$1 begin='-" + offset.toFixed(3) + "s'");
  let bin = "";
  for (const b of new TextEncoder().encode(svg)) bin += String.fromCharCode(b);
  return "data:image/svg+xml;" + (restart ? "r=" + restart + ";" : "") + "base64," + btoa(bin);
}

/**
 * Where the ▶/❚❚ button goes when the art's root `<svg>` carries `data-play-anchor="X Y"` or
 * `"X Y S"`: a point in the SVG's own units (its `viewBox`, else `width` and `height`), such as the
 * bottom-right corner of a sprite's box, and optionally the button's diameter S in the same units.
 * The button's bottom-right corner is placed at the point, inset by max(S/8, 6) art units (6 px without S: enough to clear a frame's rounded corner), where
 * the <img> draws it: `box` is the <img>'s own rectangle on screen (its `getBoundingClientRect()`),
 * and the art fills it as `object-fit: contain` does, scaled to fit and centred. The diameter is S
 * times the art's scale on screen, between 44 CSS px (a touch target) and 128; without S it is 48.
 * With a last word `top-right` (`"X Y S top-right"`), the point is the button's top-right corner
 * instead, inset the same way, and the button grows down and left from it (the top-right corner of
 * an art frame, say).
 * The button is kept inside the `vw` x `vh` viewport. Returns `null` (the button stays at the
 * viewport's bottom-right corner) when the attribute is absent, malformed or outside the art, or the
 * SVG or the image has no usable size.
 * @param {string} svg
 * @param {{left: number, top: number, width: number, height: number}} box
 * @param {number} vw
 * @param {number} vh
 * @returns {{left: number, top: number, size: number} | null}
 */
export function playAnchor(svg, box, vw, vh) {
  const tag = /<svg\b[^>]*>/i.exec(svg);
  const attr = (/** @type {string} */ name) => {
    const m = tag && new RegExp("\\s" + name + "\\s*=\\s*([\"'])(.*?)\\1", "i").exec(tag[0]);
    return m ? m[2].trim() : "";
  };
  const num = (/** @type {string} */ s) => (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s) ? +s : NaN);
  const list = (/** @type {string} */ s) => (s ? s.split(/[\s,]+/).map(num) : []);
  const view = list(attr("viewBox"));
  const [x0, y0, w, h] = view.length == 4 ? view : [0, 0, num(attr("width").replace(/px$/i, "")), num(attr("height").replace(/px$/i, ""))];
  const tokens = attr("data-play-anchor").split(/[\s,]+/).filter(Boolean);
  const down = tokens[tokens.length - 1] == "top-right" && !!tokens.pop(); // the point is the button's top-right corner
  const anchor = tokens.map(num);
  const [ax, ay, diameter] = anchor;
  if (!(w > 0 && h > 0 && box.width > 0 && box.height > 0) || !(anchor.length == 2 || (anchor.length == 3 && diameter > 0)) || !(ax >= x0 && ax <= x0 + w && ay >= y0 && ay <= y0 + h)) return null;
  const k = Math.min(box.width / w, box.height / h);
  const size = anchor.length == 3 ? Math.min(128, Math.max(44, diameter * k)) : 48;
  const inset = anchor.length == 3 ? k * Math.max(diameter / 8, 6) : 6;
  const place = (/** @type {number} */ a, /** @type {number} */ a0, /** @type {number} */ len, /** @type {number} */ at, /** @type {number} */ span, /** @type {number} */ view, /** @type {boolean} */ below) =>
    Math.round(Math.max(0, Math.min(view - size, at + (span - len * k) / 2 + (a - a0) * k + (below ? inset : -size - inset))));
  return { left: place(ax, x0, w, box.left, box.width, vw, false), top: place(ay, y0, h, box.top, box.height, vh, down), size: Math.round(size) };
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

    let run = 0; // every press of ▶/❚❚ invalidates a pending start or resume and art restart

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
     * blinks out), unless ▶/❚❚ was pressed again in the meantime, or a later restart's image is
     * already shown (restarts at every pass can decode out of order).
     * @param {number} current the press that scheduled it
     * @param {number} [offset] seconds into the art's timeline (resuming mid-pass)
     */
    const restartArt = (current, offset = 0) => {
      if (!art) return;
      const n = ++restarts;
      const img = document.createElement("img");
      img.alt = "";
      img.onload = () => {
        if (current !== run || n < shown || !art) return;
        shown = n;
        art.replaceWith(img);
        art = img;
        watch(art);
      };
      img.src = artUrl(svg, n, offset);
    };

    /** @param {() => unknown} f best effort: a failure is silent */
    const attempt = (f) => {
      try {
        f();
      } catch (e) {}
    };
    // The button sits at the art's `data-play-anchor` if it has one (see playAnchor), else at the
    // viewport's bottom-right corner (the stylesheet's). It follows the <img>'s actual box.
    const place = () => attempt(() => {
      const r = art && art.getBoundingClientRect();
      const a = r && playAnchor(svg, r, window.innerWidth, window.innerHeight);
      const s = button.style;
      s.right = s.bottom = a ? "auto" : "";
      s.left = a ? a.left + "px" : "";
      s.top = a ? a.top + "px" : "";
      s.width = s.height = a ? a.size + "px" : "";
      s.padding = a ? a.size / 4 + "px" : "";
    });
    /** @type {ResizeObserver | undefined} */
    let observer;
    /** @param {HTMLImageElement | null} img the current art image */
    const watch = (img) => attempt(() => {
      observer = observer || new ResizeObserver(place);
      observer.disconnect();
      if (img) observer.observe(img);
    });
    place();
    watch(art);
    attempt(() => window.addEventListener("resize", place));

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

    // 3-6. The ▶/❚❚ toggle, and the art restarts.
    /** @type {any} */
    let synth = null;
    let playing = false;
    let started = false; // the MIDI is loaded and playing, or paused
    let origin = 0; // startTime of the first pass
    /** @type {number | null | undefined} the pass start the art was last timed to (or skipped) */
    let synced;
    let timer = 0; // the pending art restart, or 0
    let poll = 0; // the interval that follows startTime to each pass
    /** @type {HTMLAudioElement | null} the silent element of the media session */
    let silent = null;
    let background = false; // the silent element is playing: the page may keep playing when hidden
    let armed = false; // the media session's metadata and handlers are set
    /** @param {boolean} on */
    const setPlaying = (on) => {
      playing = on;
      icon.setAttribute("d", on ? PAUSE_ICON : PLAY_ICON);
      button.setAttribute("aria-label", on ? "Pause" : "Play");
      if (!on) attempt(() => silent && silent.pause());
      attempt(() => (navigator.mediaSession.playbackState = on ? "playing" : "paused"));
    };
    /**
     * Times an art restart to tick 0 of a pass, as heard, unless one is pending. On ▶ (`first`):
     * the current pass, at once without a pass start. Afterwards (and on resuming): the pass after
     * the last one synced, once startTime has reached it. On a short loop startTime can move on by
     * more than one pass between calls, so this walks pass by pass from the last one synced,
     * skipping any whose start is already past, and takes the engine's own value when it reaches
     * it. A pass start more than MAX_TIMER_MS ahead (a pass of weeks) is left unsynced, so a later
     * poll times it once it is within reach.
     * @param {number} current the press it serves
     * @param {boolean} [first]
     */
    const sync = (current, first) => {
      const ctx = synth.getAudioContext();
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
        sync(current);
      }, Math.max(0, delay * 1000));
    };
    const pause = () => {
      ++run;
      window.clearTimeout(timer);
      window.clearInterval(poll);
      if (timer && synced != null) synced -= pass; // its pass is timed again on resume
      timer = 0;
      setPlaying(false);
      attempt(() => synth.getAudioContext().suspend().catch(() => {}));
    };
    /** The media session, once: the title and art, and the handlers that run ▶ and ❚❚. */
    const arm = () => {
      armed = true;
      /** @param {Array<{src: string, sizes: string, type: string}>} artwork */
      const meta = (artwork) => attempt(() => (navigator.mediaSession.metadata = new MediaMetadata({ title, artwork })));
      let title = MEDIA_TITLE;
      attempt(() => (title = new DOMParser().parseFromString(svg, "image/svg+xml").getElementsByTagName("title")[0].textContent || title));
      meta([]);
      for (const action of /** @type {const} */ (["play", "pause", "stop"])) {
        attempt(() => navigator.mediaSession.setActionHandler(action, action == "play" ? () => playing || button.disabled || start() : () => playing && pause()));
      }
      // Artwork: the art's own bitmap (the first embedded PNG, GIF or WebP: a Beast's 32x32 sprite),
      // as a static frame row on a dark card colour, at the sizes Chrome Android asks for (512, and
      // 256 on low-end devices): the frames of a sprite sheet (square, side by side; a GIF or a
      // plain image gives its one frame) in one row, centred, nearest-neighbour at a whole scale
      // (5x for one 32 px frame: 160 px of 512). Android 13+ shows the artwork centre-cropped to a
      // wide panel, so the row stays in the middle band; iOS shows the square as it is. The card SVG
      // itself is not drawn: its foreignObject can taint the canvas. Art without a bitmap gets no
      // artwork. The image is static: updating the metadata to animate it would flicker and cost power.
      const raster = /data:image\/(?:png|gif|webp);base64,[A-Za-z0-9+/=]+/.exec(svg);
      if (raster) {
        attempt(() => {
          const img = document.createElement("img");
          img.onload = () => attempt(() => {
            const h = img.naturalHeight;
            const count = img.naturalWidth % h ? 1 : img.naturalWidth / h;
            const w = img.naturalWidth / count;
            const canvas = document.createElement("canvas");
            meta([512, 256].map((n) => {
              canvas.width = canvas.height = n;
              const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
              g.fillStyle = "#1e1e22";
              g.fillRect(0, 0, n, n);
              g.imageSmoothingEnabled = false;
              const fit = Math.min((n * 5 * 32) / 512 / h, n / (w * count));
              const k = fit < 1 ? fit : Math.floor(fit);
              for (let i = 0; i < count; i++) {
                g.drawImage(img, i * w, 0, w, h, Math.floor((n - w * k * count) / 2) + i * w * k, Math.floor((n - h * k) / 2), w * k, h * k);
              }
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
          // Paused from outside (the notification, a headset, a call): the same as ❚❚. It is paused
          // here only if ▶ has not started it again since.
          silent.onpause = () => playing && silent && silent.paused && pause();
        }
        silent.play().then(() => (background = true), () => {});
      });
      if (!armed) attempt(arm);
    };
    // Without a media session to keep it playing, a hidden page pauses.
    document.addEventListener("visibilitychange", () => document.hidden && playing && !background && pause());
    const start = () => {
      const current = ++run;
      session();
      try {
        if (!synth) {
          synth = createSynth(/** @type {any} */ (window).WebAudioTinySynth, settings);
          // The engine builds its noise buffer on first need, which blocks for tens of ms: here, in
          // the gesture, rather than in playMIDI(), where it would delay what the clock is read for.
          synth.prewarm();
          // The engine resumes a suspended AudioContext whenever it sends a message (its _wake,
          // for autoplay). While paused it must not: its sequencer can still send the events that
          // fell within its look-ahead just before the clock stopped, which would undo ❚❚.
          const wake = synth._wake;
          if (typeof wake == "function") synth._wake = () => playing && wake();
        }
        const ctx = synth.getAudioContext();
        setPlaying(true);
        ctx.resume().then(() => {
          if (current !== run) return;
          if (started) {
            // Resumed: the art restarts at once, as far into its timeline as the music is into the
            // pass (the clock stood still while paused, the art did not). startTime may already be
            // the next pass's (see step 4); before the first pass is heard, its restart is pending.
            const at = synth.getPlayStatus().startTime;
            let into = ctx.currentTime - (ctx.outputLatency || 0) - at;
            if (into < 0 && at > origin) into += pass;
            if (at !== null && into >= 0) restartArt(current, into % pass);
            sync(current);
          } else {
            synth.loadMIDI(midi);
            synth.setLoop(1);
            synth.setLoopEnd(synth.getPlayStatus().maxTick);
            synth.playMIDI();
            started = true;
            origin = synth.getPlayStatus().startTime;
            sync(current, true);
          }
          poll = window.setInterval(() => sync(current), 50);
        }).catch((/** @type {unknown} */ e) => {
          setPlaying(false);
          fail(e);
        });
      } catch (e) {
        setPlaying(false);
        fail(e);
      }
    };
    button.onclick = () => (playing ? pause() : start());
    button.disabled = false;
  });
}
