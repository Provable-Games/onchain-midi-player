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
  let runId = 0, operationId = 0, timer = 0, poll = 0, latencyPoll = 0;
  let origin = /** @type {number | null} */ (null), latencySeconds = 0, latencyRevision = 0;
  let nextPass = 0, resumeRequests = 0, holdSuspension = false;
  /** @type {() => void} */ let syncBoundary = () => {};
  /** @type {Promise<void> | null} */ let pausing = null;
  /** @type {{promise: Promise<void>, reject: (cause: Error) => void} | null} */ let pending = null;
  /** @type {Set<(e: import("./api.d.ts").PassStart) => void>} */ const passes = new Set();
  /** @type {Set<(s: import("./api.d.ts").PlayStatus) => void>} */ const states = new Set();
  const number = (/** @type {any} */ x) => typeof x === "number" && Number.isFinite(x) ? x : null;
  const audio = () => synth && synth.getAudioContext();
  // Browser estimates only: discard malformed/implausible components independently.
  const component = (/** @type {any} */ x) => number(x) !== null && x >= 0 && x <= 1 ? x : 0;
  const estimateLatency = () => component(audio()?.outputLatency) + component(audio()?.baseLatency);
  const refreshLatency = () => {
    const value = estimateLatency();
    if (Math.abs(value - latencySeconds) < 0.002 - 1e-9) return;
    latencySeconds = value; ++latencyRevision;
    host.clearTimeout(timer); timer = 0;
    transition(state, true); syncBoundary();
  };
  const snapshot = () => {
    const s = synth && synth.getPlayStatus();
    return { state, tick: number(s?.curTick), maxTick: number(s?.maxTick) ?? number(score?.maxTick),
      startTime: number(s?.startTime), originTime: origin, audioTime: number(audio()?.currentTime),
      passSeconds: number(score?.seconds), outputLatency: component(audio()?.outputLatency),
      baseLatency: component(audio()?.baseLatency), latencySeconds, latencyRevision,
      audioState: audio()?.state ?? null,
      positionSeconds: origin === null ? null : Math.max(0, (number(audio()?.currentTime) ?? origin) - origin - latencySeconds),
      runId, error };
  };
  /** @type {{value: import("./api.d.ts").PlayStatus, listeners: ((s: import("./api.d.ts").PlayStatus) => void)[]}[]} */
  const transitions = [];
  let notifying = false;
  const transition = (/** @type {import("./api.d.ts").PlayStatus["state"]} */ next, notify = false) => {
    if (state === next && !notify) return;
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
    host.clearTimeout(timer); host.clearInterval(poll); host.clearInterval(latencyPoll); timer = poll = latencyPoll = 0; syncBoundary = () => {};
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
    if (current !== runId || (state !== "playing" && state !== "paused")) return;
    const ctx = audio();
    syncBoundary = () => {
      if (current !== runId || state !== "playing" || ctx.state !== "running" || timer) return;
      const latest = number(synth.getPlayStatus().startTime);
      if (origin === null) {
        if (nextPass) return;
        ++nextPass;
        const event = { runId: current, passIndex: 0, initial: true, startTime: null, audibleTime: null,
          audioTime: number(ctx.currentTime), outputLatency: component(ctx.outputLatency),
          baseLatency: component(ctx.baseLatency), latencySeconds };
        for (const callback of [...passes]) {
          if (current !== runId || state !== "playing") break;
          if (passes.has(callback)) { try { callback({ ...event }); } catch (_) {} }
        }
        return;
      }
      const seconds = /** @type {{seconds:number}} */ (score).seconds;
      // Preserve the pending boundary across pause. Skip late subsequent passes in O(1).
      if (nextPass > 0) {
        const heard = ctx.currentTime - latencySeconds - origin;
        nextPass = Math.max(nextPass, Math.ceil((heard - 1e-6) / seconds));
      }
      const index = nextPass, start = origin + index * seconds;
      if (latest === null || start > latest + 1e-6) return;
      const delay = start + latencySeconds - ctx.currentTime;
      if (delay * 1000 > MAX_TIMER_MS) return;
      const dispatch = () => {
        timer = 0;
        if (current !== runId || state !== "playing" || ctx.state !== "running") return;
        const audibleTime = start + latencySeconds, remaining = audibleTime - ctx.currentTime;
        if (remaining > 0.001) {
          timer = host.setTimeout(dispatch, Math.min(MAX_TIMER_MS, remaining * 1000)); return;
        }
        ++nextPass;
        if (!index || remaining > -LATE_SECONDS) {
          const event = { runId: current, passIndex: index, initial: !index, startTime: start, audibleTime,
            audioTime: number(ctx.currentTime), outputLatency: component(ctx.outputLatency),
            baseLatency: component(ctx.baseLatency), latencySeconds };
          for (const callback of [...passes]) {
            if (current !== runId || state !== "playing") break;
            if (passes.has(callback)) { try { callback({ ...event }); } catch (_) {} }
          }
        }
        syncBoundary();
      };
      timer = host.setTimeout(dispatch, Math.max(0, delay * 1000));
    };
    syncBoundary();
    if (origin !== null && current === runId && (/** @type {string} */ (state) === "playing" || /** @type {string} */ (state) === "paused"))
      poll = host.setInterval(() => syncBoundary(), 50);
    if (current === runId && (state === "playing" || state === "paused"))
      latencyPoll = host.setInterval(refreshLatency, 250);
  };
  const abortPending = () => {
    if (!pending) return;
    const abort = new Error("player: transport cancelled"); abort.name = "AbortError";
    pending.reject(abort); pending = null;
  };
  const contextChanged = () => {
    const ctx = audio();
    if (ctx.state === "closed" && (state === "playing" || state === "paused" || state === "starting")) {
      ++operationId; abortPending(); fail(new Error("player: AudioContext closed"));
    } else if (state === "playing" && ctx.state !== "running") {
      host.clearTimeout(timer); timer = 0; transition("paused");
    } else if (state === "paused" && ctx.state === "running" && !pausing && !resumeRequests) {
      // An external resume is an actual clock transition; never reload the score.
      holdSuspension = false; transition("playing"); syncBoundary();
    }
  };
  /** @type {() => void} */ let resolveReady = () => {};
  /** @type {(cause: Error) => void} */ let rejectReady = () => {};
  const ready = new Promise(/** @param {(value?: void) => void} resolve */ (resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  ready.catch(() => {});
  /** @type {import("./api.d.ts").OnchainMidiApi} */
  const api = {
    ready,
    play() {
      if (state === "paused") return api.resume();
      if (state === "failed") return Promise.reject(error);
      if (state === "loading") return Promise.reject(new Error("player: await OnchainMidiPlayer.ready before play()"));
      if (pending) return pending.promise;
      if (state === "playing") return Promise.resolve();
      holdSuspension = false;
      const current = ++runId, operation = ++operationId;
      /** @type {() => void} */ let resolve = () => {};
      /** @type {(cause: Error) => void} */ let reject = () => {};
      const promise = new Promise(/** @param {(value?: void) => void} yes */ (yes, no) => { resolve = yes; reject = no; });
      pending = { promise, reject };
      transition("starting");
      if (operation !== operationId || state !== "starting") return promise;
      const begin = () => {
        if (operation !== operationId) return;
        try {
          if (!synth) {
            synth = createSynth(host.WebAudioTinySynth, settings); synth.prewarm();
            audio().addEventListener("statechange", contextChanged);
          }
          // The public engine resume happens synchronously in the user's gesture.
          ++resumeRequests;
          const resumed = synth.resume();
          Promise.resolve(resumed).then(() => {
            --resumeRequests;
            if (operation !== operationId || state !== "starting") {
              if (holdSuspension && !pending) Promise.resolve(audio().suspend()).catch(fail);
              return;
            }
            try {
              synth.loadMIDI(midi); synth.setLoop(1);
              synth.setLoopEnd(synth.getPlayStatus().maxTick); synth.playMIDI();
              origin = number(synth.getPlayStatus().startTime); nextPass = 0;
              latencySeconds = estimateLatency(); ++latencyRevision;
              pending = null; transition(audio().state === "running" ? "playing" : "paused");
              boundaries(current); resolve();
            } catch (cause) { pending = null; reject(fail(cause)); }
          }, (cause) => {
            --resumeRequests;
            if (operation !== operationId) return;
            pending = null; reject(fail(cause));
          });
        } catch (cause) { pending = null; reject(fail(cause)); }
      };
      if (pausing) pausing.then(begin, cause => { if (operation === operationId) { pending = null; reject(fail(cause)); } });
      else begin();
      return promise;
    },
    pause() {
      if (pausing) return pausing;
      if (state !== "playing" && state !== "starting" && !(state === "paused" && pending)) return Promise.resolve();
      holdSuspension = true;
      const wasStarting = state === "starting", operation = ++operationId;
      abortPending(); host.clearTimeout(timer); timer = 0;
      // Install the promise before notification, so reentrant resume waits for suspension.
      /** @type {() => void} */ let resolve = () => {};
      /** @type {(cause: Error) => void} */ let reject = () => {};
      const promise = new Promise(/** @param {(value?: void) => void} yes */ (yes, no) => { resolve = yes; reject = no; });
      pausing = promise;
      try {
        const suspended = synth ? audio().suspend() : Promise.resolve();
        transition(wasStarting ? "stopped" : "paused");
        Promise.resolve(suspended).then(() => { if (pausing === promise) pausing = null; resolve(); }, cause => {
          if (pausing === promise) pausing = null;
          reject(operation === operationId ? fail(cause) : cause);
        });
      } catch (cause) { pausing = null; reject(fail(cause)); }
      return promise;
    },
    resume() {
      if (state !== "paused") return api.play();
      if (pending) return pending.promise;
      holdSuspension = false;
      const operation = ++operationId;
      /** @type {() => void} */ let resolve = () => {};
      /** @type {(cause: Error) => void} */ let reject = () => {};
      const promise = new Promise(/** @param {(value?: void) => void} yes */ (yes, no) => { resolve = yes; reject = no; });
      pending = { promise, reject };
      const begin = () => {
        if (operation !== operationId) return;
        try {
          // No loadMIDI, playMIDI, prewarm, seek or voice construction on resume.
          ++resumeRequests;
          Promise.resolve(synth.resume()).then(() => {
            --resumeRequests;
            if (operation !== operationId) {
              if (holdSuspension && !pending) Promise.resolve(audio().suspend()).catch(fail);
              return;
            }
            refreshLatency();
            if (operation !== operationId) return;
            pending = null;
            transition(audio().state === "running" ? "playing" : "paused"); syncBoundary(); resolve();
          }, cause => { --resumeRequests; if (operation === operationId) { pending = null; reject(fail(cause)); } });
        } catch (cause) { pending = null; reject(fail(cause)); }
      };
      if (pausing) pausing.then(begin, cause => { if (operation === operationId) { pending = null; reject(fail(cause)); } });
      else begin();
      return promise;
    },
    stop() {
      if (state !== "starting" && state !== "playing" && state !== "paused") return;
      holdSuspension = false;
      ++runId; ++operationId; cancelTimers(); abortPending(); origin = null;
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
