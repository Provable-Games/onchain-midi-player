// @ts-check
// Headless, one-score browser API. NFT code owns every control, visual and media policy.
import { createSynth, decodeSettings } from "./settings.js";
export const ENGINE_MISSING = "engine: TinySynth did not load";
const LATE_SECONDS = 0.05;
const MAX_TIMER_MS = 2147483647;
const MIN_LOOP_SECONDS = 0.05;
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
  if (btoa(bin) !== b64) throw new Error("midi: not base64");
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
 * Install the headless API. Readiness validates data without constructing audio. startTime and
 * pass timestamps are AudioContext seconds; the engine may announce a pass ahead of audibility.
 * @param {any} [host]
 * @returns {import("./api.d.ts").OnchainMidiApi}
 */
export function startPlayer(host = window) {
  const doc = host.document;
  /** @type {import("./api.d.ts").PlayStatus["state"]} */ let state = "loading";
  /** @type {Error | null} */ let error = null;
  /** @type {any} */ let synth = null;
  /** @type {import("./settings.js").TinySynthSettings} */ let settings;
  /** @type {Uint8Array} */ let midi;
  /** @type {{maxTick: number, seconds: number} | undefined} */ let score;
  let runId = 0, timer = 0, poll = 0;
  /** @type {{promise: Promise<void>, reject: (cause: Error) => void} | null} */ let pending = null;
  /** @type {Set<(e: import("./api.d.ts").PassStart) => void>} */ const passes = new Set();
  /** @type {Set<(s: import("./api.d.ts").PlayStatus) => void>} */ const states = new Set();
  const number = (/** @type {any} */ x) => typeof x === "number" && Number.isFinite(x) ? x : null;
  const audio = () => synth && synth.getAudioContext();
  const latency = () => Math.max(0, number(audio()?.outputLatency) || 0);
  const snapshot = () => {
    const s = synth && synth.getPlayStatus();
    return { state, tick: number(s?.curTick), maxTick: number(s?.maxTick) ?? number(score?.maxTick),
      startTime: number(s?.startTime), audioTime: number(audio()?.currentTime),
      passSeconds: number(score?.seconds), outputLatency: latency(), runId, error };
  };
  /** @type {{value: import("./api.d.ts").PlayStatus, listeners: ((s: import("./api.d.ts").PlayStatus) => void)[]}[]} */
  const transitions = [];
  let notifying = false;
  const transition = (/** @type {import("./api.d.ts").PlayStatus["state"]} */ next) => {
    if (state === next) return;
    state = next;
    transitions.push({ value: snapshot(), listeners: [...states] });
    if (notifying) return;
    notifying = true;
    try {
      while (transitions.length) {
        const event = /** @type {NonNullable<ReturnType<typeof transitions.shift>>} */ (transitions.shift());
        for (const callback of event.listeners) {
          if (states.has(callback)) { try { callback({ ...event.value }); } catch (_) {} }
        }
      }
    } finally { notifying = false; }
  };
  const cancelTimers = () => {
    host.clearTimeout(timer); host.clearInterval(poll); timer = poll = 0;
  };
  const fail = (/** @type {unknown} */ cause) => {
    error = cause instanceof Error ? cause : new Error(String(cause));
    cancelTimers();
    try { synth?.stopMIDI(); } catch (_) {}
    transition("failed");
    return error;
  };
  const subscribe = (/** @type {Set<any>} */ set, /** @type {any} */ callback) => {
    if (typeof callback !== "function") throw new TypeError("subscriber must be a function");
    const subscription = (/** @type {any} */ value) => callback(value);
    set.add(subscription);
    return () => { set.delete(subscription); };
  };
  const boundaries = (/** @type {number} */ current) => {
    const ctx = audio();
    /** @type {number | null | undefined} */ let synced;
    let passIndex = -1;
    const sync = (initial = false) => {
      if (current !== runId || state !== "playing" || timer) return;
      const latest = number(synth.getPlayStatus().startTime);
      if (!initial && (latest === null || latest === synced)) return;
      let start = latest, index = passIndex + 1;
      const lag = latency();
      if (!initial && synced != null && latest != null) {
        start = synced + /** @type {{seconds:number}} */ (score).seconds;
        // Skip already missed boundaries without walking arbitrarily many short passes.
        const ahead = Math.max(0, Math.min(latest - start, ctx.currentTime - lag - start));
        const skipped = Math.max(0, Math.ceil((ahead - 1e-6) / /** @type {{seconds:number}} */ (score).seconds));
        start += skipped * /** @type {{seconds:number}} */ (score).seconds; index += skipped;
        if (start >= latest - 1e-6) start = latest;
      }
      const delay = start === null ? 0 : start + lag - ctx.currentTime;
      if (delay * 1000 > MAX_TIMER_MS) return;
      synced = start; passIndex = index;
      if (!initial && delay < 0) return;
      const dispatch = () => {
        timer = 0;
        if (current !== runId || state !== "playing") return;
        const audibleTime = start === null ? null : start + lag;
        const remaining = audibleTime === null ? 0 : audibleTime - ctx.currentTime;
        if (remaining > 0.001) {
          timer = host.setTimeout(dispatch, Math.min(MAX_TIMER_MS, remaining * 1000)); return;
        }
        if (initial || remaining > -LATE_SECONDS) {
          const event = { runId: current, passIndex: index, initial, startTime: start, audibleTime,
            audioTime: number(ctx.currentTime), outputLatency: lag };
          for (const callback of [...passes]) {
            if (current !== runId || state !== "playing") break;
            if (passes.has(callback)) { try { callback({ ...event }); } catch (_) {} }
          }
        }
        sync();
      };
      if (start === null) dispatch();
      else timer = host.setTimeout(dispatch, Math.max(0, delay * 1000));
    };
    sync(true);
    if (synth.getPlayStatus().startTime !== null && current === runId && state === "playing")
      poll = host.setInterval(() => sync(), 50);
  };
  /** @type {() => void} */ let resolveReady = () => {};
  /** @type {(cause: Error) => void} */ let rejectReady = () => {};
  const ready = new Promise(/** @param {(value?: void) => void} resolve */ (resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  ready.catch(() => {});
  /** @type {import("./api.d.ts").OnchainMidiApi} */
  const api = {
    ready,
    play() {
      if (state === "failed") return Promise.reject(error);
      if (state === "loading") return Promise.reject(new Error("player: await OnchainMidiPlayer.ready before play()"));
      if (state === "starting") return /** @type {NonNullable<typeof pending>} */ (pending).promise;
      if (state === "playing") return Promise.resolve();
      const current = ++runId;
      /** @type {() => void} */ let resolve = () => {};
      /** @type {(cause: Error) => void} */ let reject = () => {};
      const promise = new Promise(/** @param {(value?: void) => void} yes */ (yes, no) => { resolve = yes; reject = no; });
      pending = { promise, reject };
      transition("starting");
      if (current !== runId || /** @type {string} */ (state) !== "starting") return promise;
      try {
        if (!synth) { synth = createSynth(host.WebAudioTinySynth, settings); synth.prewarm(); }
        // Invoke resume synchronously in the user's gesture, before any await/microtask.
        const resumed = audio().resume();
        Promise.resolve(resumed).then(() => {
          if (current !== runId || state !== "starting") return;
          try {
            synth.loadMIDI(midi); synth.setLoop(1);
            synth.setLoopEnd(synth.getPlayStatus().maxTick); synth.playMIDI();
            pending = null; transition("playing"); boundaries(current); resolve();
          } catch (cause) { pending = null; reject(fail(cause)); }
        }, (cause) => {
          if (current !== runId || state !== "starting") return;
          pending = null; reject(fail(cause));
        });
      } catch (cause) { pending = null; reject(fail(cause)); }
      return promise;
    },
    stop() {
      if (state !== "starting" && state !== "playing") return;
      ++runId; cancelTimers();
      if (pending) {
        const abort = new Error("player: start cancelled"); abort.name = "AbortError";
        pending.reject(abort); pending = null;
      }
      try { synth?.stopMIDI(); } catch (cause) { fail(cause); return; }
      transition("stopped");
    },
    getPlayStatus: snapshot,
    onPassStart: (callback) => subscribe(passes, callback),
    onStateChange: (callback) => subscribe(states, callback),
  };
  host.OnchainMidiPlayer = api;
  const init = () => {
    try {
      if (typeof host.WebAudioTinySynth !== "function") throw new Error(ENGINE_MISSING);
      const block = (/** @type {string} */ id) => {
        const tags = doc.querySelectorAll(`[id="${id}"]`);
        if (tags.length !== 1 || tags[0].tagName.toLowerCase() !== "script" || tags[0].namespaceURI !== "http://www.w3.org/1999/xhtml" || tags[0].getAttribute("type") !== "text/plain")
          throw new Error(`player: expected one text/plain #${id} block, found ${tags.length}`);
        return tags[0].textContent || "";
      };
      settings = decodeSettings(block("onchain-midi-settings"));
      midi = decodeMidi(block("onchain-midi-data")); score = checkMidi(midi);
      transition("stopped"); resolveReady();
    } catch (cause) { rejectReady(fail(cause)); }
  };
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
  return api;
}
