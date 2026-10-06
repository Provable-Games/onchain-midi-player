// @ts-check
// Runs the real page's scripts (PAGE's gunzip shim and player, byte for byte) in node:vm against a
// minimal fake DOM, in document order, for the player tests (player/player.test.js). The shim
// inflates the engine's gzip tag and inserts the engine as an inline script, which the fake DOM runs
// at once, as a browser does; the player then runs. Once the inflated engine has defined
// `WebAudioTinySynth`, it is either replaced by a recording fake (`engine: "fake"`) or kept and
// recorded (`engine: "real"`, on a WebAudio mock whose 60 ms sequencer interval the test drives by
// hand with `advance`). If the engine did not load, `WebAudioTinySynth` stays undefined. Timeouts
// (the art restarts) run only when a test calls `runTimers`; intervals (the engine's sequencer and
// the player's polling of `startTime`) run on every 60 ms step of `advance`, in the order they were
// set, so the engine moves `startTime` before the player reads it.

import vm from "node:vm";
import { ART_OPEN, MIDI_OPEN, SETTINGS_OPEN } from "./page.mjs";
import { webAudioMock } from "./webaudio_mock.mjs";

/** A fake DOM element: the handful of properties and methods the shim and the player use. */
class El {
  /**
   * @param {string} tag
   * @param {Page} page
   * @param {string} [text]
   */
  constructor(tag, page, text = "") {
    this.tag = tag;
    this.page = page;
    this._text = text;
    /** @type {Record<string, string>} */
    this.attributes = {};
    this.disabled = false;
    this.hidden = false;
    this.title = "";
    this.alt = "";
    this._src = "";
    /** @type {null | (() => void)} */
    this.onclick = null;
    /** @type {null | (() => void)} */
    this.onload = null;
    /** @type {null | (() => void)} */
    this.onerror = null;
    /** @type {El[] | null} the head or body list holding it */
    this.parent = null;
  }
  /** @param {string} name */
  getAttribute(name) {
    return name in this.attributes ? this.attributes[name] : null;
  }
  get textContent() {
    this.page.events.push(["read", this.attributes.id || this.tag]);
    return this._text;
  }
  set textContent(v) {
    this._text = v;
  }
  get src() {
    return this._src;
  }
  set src(v) {
    this._src = v;
    this.page.events.push(["src", v]);
  }
  /** @param {string} name @param {string} value */
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  /**
   * Replaces this element in its list. An inserted <script> runs at once, as in a browser.
   * @param {El} other
   */
  replaceWith(other) {
    const list = this.parent;
    const i = list ? list.indexOf(this) : -1;
    if (!list || i < 0) throw new Error("replaceWith: element not in the document");
    list[i] = other;
    other.parent = list;
    this.parent = null;
    if (other.tag === "script") {
      this.page.events.push(["script", other._text.length]);
      this.page.runScript(other._text);
    } else this.page.events.push(["replace", other.src]);
  }
}

/**
 * @typedef {object} Page
 * @property {Record<string, El>} elements
 * @property {El[]} head
 * @property {El[]} body
 * @property {any[][]} events  reads of blocks, img src assignments, inserted scripts, replacements
 *   and DOMContentLoaded listeners, in order
 * @property {(code: string) => void} runScript  runs an inserted script
 */

/**
 * Splits a decoded animation_url HTML (PAGE ++ D ++ SVG) into its scripts and the three blocks, as
 * the HTML parser would. Tolerant of edited pages: any number of `<script type=... src=...>` tags
 * (normally the engine's one gzip tag), whatever their payload.
 * @param {string} html
 */
export function parseDocument(html) {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  if (scripts.length !== 2) throw new Error("expected two plain <script> elements: the shim and the player");
  const [shim, player] = scripts;
  const srcTags = [...html.matchAll(/<script type="([^"]*)" src="([^"]*)"><\/script>/g)].map((m) => ({ type: m[1], src: m[2] }));
  const s = html.indexOf(SETTINGS_OPEN) + SETTINGS_OPEN.length;
  const m = html.indexOf(MIDI_OPEN, s);
  const a = html.indexOf(ART_OPEN, m);
  if (s < SETTINGS_OPEN.length || m < 0 || a < 0) throw new Error("blocks not found");
  const button = html.match(/<button id="play"[^>]*>/);
  if (!button) throw new Error("no play button");
  const icon = html.match(/<path id="icon" d="([^"]*)"/);
  if (!icon) throw new Error("no icon");
  return {
    shim,
    player,
    srcTags,
    settings: html.slice(s, m),
    midi: html.slice(m + MIDI_OPEN.length, a),
    art: html.slice(a + ART_OPEN.length),
    buttonDisabled: / disabled[ >]/.test(button[0]),
    icon: icon[1],
  };
}

/**
 * Runs the page's shim and player on `html`. Returns the fake DOM, the engine's record and controls.
 * @param {string} html
 * @param {{engine?: "fake" | "real", outputLatency?: number | null, constructError?: string, resumeError?: string,
 *   sampleRate?: number, onConstruct?: (synth: any, audio: any) => void}} [options]
 *   outputLatency: the AudioContext's, in seconds, or null for a context without the property (an
 *   engine that does not support it); constructError: the fake engine's constructor throws this
 *   message; resumeError: its AudioContext's resume() rejects with this message
 */
export function runPage(html, { engine = "fake", outputLatency = 0.02, constructError, resumeError, sampleRate = 8000, onConstruct } = {}) {
  const doc = parseDocument(html);
  /** @type {string[]} errors thrown by inserted scripts, which a browser reports as uncaught */
  const uncaught = [];
  /** @type {Record<string, any>} */
  let sandbox = {};
  /** @type {Page} */
  const page = {
    elements: {}, head: [], body: [], events: [],
    // A script inserted by another runs at once; what it throws is reported, not propagated to the
    // script that inserted it.
    runScript(code) {
      try {
        vm.runInContext(code, sandbox, { filename: "page-inserted.js" });
      } catch (e) {
        uncaught.push(String((e && /** @type {Error} */ (e).message) || e));
      }
    },
  };
  for (const { type, src } of doc.srcTags) {
    const tag = new El("script", page);
    Object.assign(tag.attributes, { type, src });
    tag.parent = page.head;
    page.head.push(tag);
  }
  const el = (/** @type {string} */ tag, /** @type {string} */ id, text = "") => {
    const e = new El(tag, page, text);
    e.attributes.id = id;
    page.elements[id] = e;
    return e;
  };
  const button = el("button", "play");
  button.disabled = doc.buttonDisabled;
  el("path", "icon").attributes.d = doc.icon;
  const error = el("p", "error");
  error.hidden = true;
  el("script", "settings", doc.settings);
  el("script", "midi", doc.midi);
  el("script", "art", doc.art);
  page.body.push(button, error);
  button.parent = error.parent = page.body;

  /** @type {Array<() => void>} */
  let ready = [];
  /** @type {Map<number, {fn: () => void, delay: number, at: number}>} at: the AudioContext time when set */
  const timers = new Map();
  /** @type {number[]} */
  const timeoutDelays = [];
  /** @type {Map<number, {fn: () => void, delay: number}>} the engine's and the page's intervals */
  const intervals = new Map();
  /** @type {number[]} */
  const intervalDelays = [];
  /** @type {any[]} */
  const intervalObservations = [];
  let timerId = 0;
  /** @type {string[]} */
  const consoleErrors = [];
  /** @type {any[]} */
  const synths = [];
  /** @type {any[][]} */
  const calls = [];
  /** @type {any[][]} full page-install trace used only by certification reports */
  const certificationCalls = [];
  /** @type {El[]} */
  const created = [];

  sandbox = {
    document: {
      body: { prepend: (/** @type {El} */ e) => { page.body.unshift(e); e.parent = page.body; page.events.push(["prepend", e.src]); } },
      getElementById: (/** @type {string} */ id) => page.elements[id] || null,
      createElement: (/** @type {string} */ tag) => {
        const e = new El(tag, page);
        created.push(e);
        return e;
      },
      // Only the selector form the shim uses: script[type="..."].
      querySelectorAll: (/** @type {string} */ selector) => {
        const m = /^script\[type="([^"]*)"\]$/.exec(selector);
        if (!m) throw new Error(`fake DOM: unsupported selector ${selector}`);
        return [...page.head, ...page.body].filter((e) => e.tag === "script" && e.attributes.type === m[1]);
      },
      addEventListener: (/** @type {string} */ type, /** @type {() => void} */ fn) => {
        page.events.push(["listen", type]);
        if (type === "DOMContentLoaded") ready.push(fn);
      },
    },
    setTimeout: (/** @type {() => void} */ fn, /** @type {number} */ delay) => {
      // Browsers fire a longer delay than 2^31 - 1 ms at once: the player must never ask for one.
      if (!(delay >= 0 && delay <= 2147483647)) throw new Error(`setTimeout delay out of range: ${delay}`);
      timeoutDelays.push(delay);
      timers.set(++timerId, { fn, delay, at: synths.length ? synths[0].getAudioContext().currentTime : 0 });
      return timerId;
    },
    clearTimeout: (/** @type {number} */ id) => { timers.delete(id); },
    setInterval: (/** @type {() => void} */ fn, /** @type {number} */ delay) => { intervalDelays.push(delay); intervals.set(++timerId, { fn, delay }); return timerId; },
    clearInterval: (/** @type {number} */ id) => { intervals.delete(id); },
    atob, btoa, TextEncoder, TextDecoder,
    console: { error: (/** @type {any} */ e) => consoleErrors.push(String((e && e.message) || e)), log() {}, warn() {} },
  };
  sandbox.window = sandbox;

  /** @type {any} */
  let audio = null;
  if (engine === "real") {
    audio = webAudioMock({ sampleRate });
    Object.assign(sandbox, { AudioContext: audio.AudioContext, performance: { now: () => 0 } });
  }
  vm.createContext(sandbox);
  // The shim, as the page runs it while parsing <head>: it inflates the engine, which runs at once.
  // Errors in the shim and the player themselves propagate, so a test sees them.
  vm.runInContext(doc.shim, sandbox, { filename: "page-shim.js" });
  const loaded = typeof sandbox.WebAudioTinySynth === "function";
  if (!loaded) {
    // The engine did not load: the player must fail closed.
  } else if (engine === "real") {
    // Record what the page does with the engine, and every MIDI message it schedules.
    const Real = sandbox.WebAudioTinySynth;
    sandbox.WebAudioTinySynth = function (/** @type {any} */ opts) {
      const synth = new Real(opts);
      synth.playInvocations = [];
      synth.syncObservations = [];
      synth.waveRegistrations = [];
      if (outputLatency === null) delete synth.getAudioContext().outputLatency;
      else synth.getAudioContext().outputLatency = outputLatency;
      // Only the page's own calls are recorded, not the engine's calls to itself (loadMIDI calls
      // stopMIDI, for example).
      let depth = 0;
      for (const name of ["setSampleWave", "setHarmonicWave", "setQuality", "setMasterVol", "setReverbLev", "setVoices", "setTimbre", "setLoop", "setLoopEnd", "loadMIDI", "playMIDI", "stopMIDI"]) {
        const f = synth[name];
        synth[name] = (/** @type {any[]} */ ...args) => {
          if (!depth) {
            certificationCalls.push([name, ...args]);
            if (!["setSampleWave", "setHarmonicWave", "setQuality", "setMasterVol", "setReverbLev", "setVoices", "setTimbre"].includes(name)) calls.push([name, ...args]);
          }
          depth++;
          try {
            if (name === "playMIDI") {
              const before = { contextTime: synth.getAudioContext().currentTime, playTime: synth.playTime, startTime: synth.startTime };
              const result = f(...args);
              synth.playInvocations.push({ before, after: { contextTime: synth.getAudioContext().currentTime, playTime: synth.playTime, startTime: synth.startTime } });
              return result;
            }
            const bufferStart = audio?.buffers?.length ?? 0;
            const result = f(...args);
            if (name === "setSampleWave" || name === "setHarmonicWave") {
              synth.waveRegistrations.push({
                method: name,
                name: args[0],
                createdBufferIds: (audio?.buffers || []).slice(bufferStart).map((/** @type {any} */ buffer) => buffer.id),
              });
            }
            return result;
          } finally {
            depth--;
          }
        };
      }
      if (typeof synth.sync === "function") {
        const sync = synth.sync;
        synth.sync = (/** @type {any[]} */ ...args) => {
          const status = synth.getPlayStatus();
          const before = {
            contextTime: synth.getAudioContext().currentTime,
            playTime: synth.playTime,
            startTime: synth.startTime,
            initialStartTime: status?.initialStartTime,
          };
          const result = sync(...args);
          const afterStatus = synth.getPlayStatus();
          synth.syncObservations.push({
            args,
            before,
            after: {
              contextTime: synth.getAudioContext().currentTime,
              playTime: synth.playTime,
              startTime: synth.startTime,
              initialStartTime: afterStatus?.initialStartTime,
            },
          });
          return result;
        };
      }
      const send = synth.send;
      synth.sent = [];
      synth.sendObservations = [];
      synth.send = (/** @type {number[]} */ msg, /** @type {number} */ t) => {
        const audioLogStart = audio.log.length;
        const result = send(msg, t);
        synth.sent.push([msg, t]);
        const audioLog = audio.log.slice(audioLogStart);
        const newNodeNames = audioLog.filter((/** @type {any[]} */ row) => row.length === 2 && row[1] === "create").map((/** @type {any[]} */ row) => row[0]);
        synth.sendObservations.push({
          message: [...msg], time: t, scheduledAt: synth.getAudioContext().currentTime,
          audioLog,
          nodes: newNodeNames.map((/** @type {string} */ name) => {
            const node = audio.nodes[name];
            return {
              name,
              kind: name.slice(0, name.indexOf("#")),
              frequencyHz: node?.frequency?.value ?? null,
              waveType: node?.waveType ?? null,
              periodicWave: node?.periodicWave ?? null,
              playbackRate: node?.playbackRate?.value ?? null,
              detuneCents: node?.detune?.value ?? null,
              bufferId: node?.buffer?.id ?? null,
              bufferLength: node?.buffer?.length ?? null,
              bufferSampleRate: node?.buffer?.sampleRate ?? null,
              bufferHomeHz: node?.buffer?._b ?? null,
              bufferSeconds: node?.buffer?._l ?? null,
              gain: node?.gain?.value ?? null,
              filterType: node?.kind ?? null,
              q: node?.Q?.value ?? null,
            };
          }),
        });
        return result;
      };
      if (onConstruct) onConstruct(synth, audio);
      synths.push(synth);
      calls.push(["new", { ...opts }]);
      certificationCalls.push(["new", { ...opts }]);
      return synth;
    };
  } else {
    sandbox.WebAudioTinySynth = function FakeSynth(/** @type {any} */ opts) {
      if (constructError) throw new Error(constructError);
      const ctx = {
        state: "suspended", currentTime: 1.5, ...(outputLatency === null ? {} : { outputLatency }),
        resume: () => {
        calls.push(["resume"]);
        if (resumeError) return Promise.reject(new Error(resumeError));
        ctx.state = "running";
        return Promise.resolve();
      } };
      /** @type {Record<string, any>} */
      const synth = { opts, ctx, maxTick: 0, play: 0, startTime: /** @type {number | null} */ (null), timbres: [] };
      const record = (/** @type {string} */ name, /** @type {(...a: any[]) => void} */ f = () => {}) => (/** @type {any[]} */ ...args) => { calls.push([name, ...args]); f(...args); };
      Object.assign(synth, {
        getAudioContext: () => ctx,
        // The engine's public status; startTime as TinySynth sets it: tick 0 sounds 0.1 s after playMIDI().
        getPlayStatus: () => ({ play: synth.play, maxTick: synth.maxTick, curTick: 0, startTime: synth.play ? synth.startTime : null }),
        setQuality: record("setQuality"), setMasterVol: record("setMasterVol"), setReverbLev: record("setReverbLev"),
        setVoices: record("setVoices"), setTimbre: record("setTimbre"), setLoop: record("setLoop"), setLoopEnd: record("setLoopEnd"),
        loadMIDI: record("loadMIDI", (/** @type {Uint8Array} */ bytes) => { synth.maxTick = 4242; synth.play = 0; synth.midi = bytes; }),
        playMIDI: record("playMIDI", () => { synth.play = 1; synth.startTime = ctx.currentTime + 0.1; }),
        stopMIDI: record("stopMIDI", () => { synth.play = 0; }),
      });
      calls.push(["new", { ...opts }]);
      synths.push(synth);
      return synth;
    };
  }

  vm.runInContext(doc.player, sandbox, { filename: "page-player.js" });
  return {
    doc,
    page,
    els: page.elements,
    calls,
    certificationCalls,
    synths,
    consoleErrors,
    uncaught,
    timers,
    timeoutDelays,
    intervals,
    intervalDelays,
    intervalObservations,
    audio,
    /** Whether the inflated engine defined WebAudioTinySynth. */
    engineLoaded: loaded,
    /** The current art <img> (first element of the body), if any. */
    art: () => page.body.find((e) => e.tag === "img") || null,
    /** Fires DOMContentLoaded. */
    ready() {
      const fns = ready;
      ready = [];
      for (const fn of fns) fn();
    },
    /** Clicks the button as a user would: nothing happens while it is disabled. */
    click() {
      if (!button.disabled && button.onclick) button.onclick();
    },
    /** Runs the pending timers (in creation order). */
    runTimers() {
      for (const [id, t] of [...timers]) {
        timers.delete(id);
        t.fn();
      }
    },
    /**
     * Advances the AudioContext clock in `step` increments, running each interval when its own
     * period has passed (the engine's every 60 ms, the player's poll every 50 ms) and the timeouts
     * as they fall due (runDue). Returns what runDue returned, in order.
     */
    run(/** @type {number} */ seconds, step = 0.005) {
      const ctx = synths[0].getAudioContext();
      const end = ctx.currentTime + seconds;
      /** @type {Array<{due: number, images: string[]}>} */
      const ran = [];
      while (ctx.currentTime < end - 1e-9) {
        ctx.currentTime = Math.round((ctx.currentTime + step) * 1e6) / 1e6;
        for (const iv of [...intervals.values()]) {
          const t = /** @type {any} */ (iv);
          if (t.last === undefined) t.last = ctx.currentTime - step;
          if (ctx.currentTime - t.last >= iv.delay / 1000 - 1e-9) {
            t.last = ctx.currentTime;
            const synth = synths[0];
            const statusBefore = synth?.getPlayStatus?.() ?? null;
            iv.fn();
            const statusAfter = synth?.getPlayStatus?.() ?? null;
            intervalObservations.push({ delay: iv.delay, contextTime: ctx.currentTime, statusBefore, statusAfter });
          }
        }
        ran.push(...this.runDue());
      }
      return ran;
    },
    /**
     * Runs the timeouts that are due by the AudioContext clock (the harness runs the page clock with
     * it), and those they set that are due too. Returns, in order, the time each was due and the
     * images its callback created (an art restart creates one).
     */
    runDue() {
      const now = synths[0].getAudioContext().currentTime;
      /** @type {Array<{due: number, images: string[]}>} */
      const ran = [];
      for (;;) {
        const due = [...timers].find(([, t]) => t.at + t.delay / 1000 <= now + 1e-9);
        if (!due) return ran;
        timers.delete(due[0]);
        const from = created.length;
        due[1].fn();
        ran.push({ due: due[1].at + due[1].delay / 1000, images: created.slice(from).map((img) => img.src) });
      }
    },
    /**
     * Fires the onload handler of every image created so far (images "decode" on demand here), in
     * creation order, or newest first with `reverse`.
     */
    loadImages({ reverse = false } = {}) {
      const imgs = created.splice(0);
      for (const img of reverse ? imgs.reverse() : imgs) if (img.onload) img.onload();
    },
    /** Lets pending promise callbacks run. */
    flush: () => new Promise((resolve) => setImmediate(resolve)),
    /**
     * Advances the AudioContext clock in 60 ms steps, running every interval at each step: the real
     * engine's sequencer, then the player's polling.
     */
    advance(/** @type {number} */ seconds) {
      const ctx = synths[0].getAudioContext();
      for (let t = 0; t < seconds; t += 0.06) {
        ctx.currentTime += 0.06;
        for (const interval of [...intervals.values()]) {
          const synth = synths[0];
          const statusBefore = synth?.getPlayStatus?.() ?? null;
          interval.fn();
          const statusAfter = synth?.getPlayStatus?.() ?? null;
          intervalObservations.push({ delay: interval.delay, contextTime: ctx.currentTime, statusBefore, statusAfter });
        }
      }
    },
  };
}
