// @ts-check
// Runs the real page's player script (the second <script> of PAGE, byte for byte) in node:vm
// against a minimal fake DOM, for the player tests (player/player.test.js). The engine is either a
// recording fake (`engine: "fake"`) or the real pinned TinySynth on a WebAudio mock
// (`engine: "real"`), whose 60 ms sequencer interval the test drives by hand (`advance`).

import vm from "node:vm";
import { engineSource } from "./engine.mjs";
import { ART_OPEN, MIDI_OPEN, SETTINGS_OPEN, pageScripts } from "./page.mjs";
import { webAudioMock } from "./webaudio_mock.mjs";

/** A fake DOM element: the handful of properties and methods the player uses. */
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
  /** @param {El} other */
  replaceWith(other) {
    const i = this.page.body.indexOf(this);
    if (i < 0) throw new Error("replaceWith: element not in the body");
    this.page.body[i] = other;
    this.page.events.push(["replace", other.src]);
  }
}

/**
 * @typedef {object} Page
 * @property {Record<string, El>} elements
 * @property {El[]} body
 * @property {any[][]} events  reads of blocks, img src assignments, replacements, in order
 */

/**
 * Splits a decoded animation_url HTML (PAGE ++ D ++ SVG) into the player script and the three
 * blocks, as the HTML parser would.
 * @param {string} html
 */
export function parseDocument(html) {
  const { player } = pageScripts(html);
  const s = html.indexOf(SETTINGS_OPEN) + SETTINGS_OPEN.length;
  const m = html.indexOf(MIDI_OPEN, s);
  const a = html.indexOf(ART_OPEN, m);
  if (s < SETTINGS_OPEN.length || m < 0 || a < 0) throw new Error("blocks not found");
  const button = html.match(/<button id="play"[^>]*>/);
  if (!button) throw new Error("no play button");
  const icon = html.match(/<path id="icon" d="([^"]*)"/);
  if (!icon) throw new Error("no icon");
  return {
    player,
    settings: html.slice(s, m),
    midi: html.slice(m + MIDI_OPEN.length, a),
    art: html.slice(a + ART_OPEN.length),
    buttonDisabled: / disabled[ >]/.test(button[0]),
    icon: icon[1],
  };
}

/**
 * Runs the page's player on `html`. Returns the fake DOM, the engine's record and controls.
 * @param {string} html
 * @param {{engine?: "fake" | "real", outputLatency?: number, constructError?: string, resumeError?: string}} [options]
 *   constructError: the fake engine's constructor throws this message; resumeError: its
 *   AudioContext's resume() rejects with this message
 */
export function runPage(html, { engine = "fake", outputLatency = 0.02, constructError, resumeError } = {}) {
  const doc = parseDocument(html);
  /** @type {Page} */
  const page = { elements: {}, body: [], events: [] };
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

  /** @type {Array<() => void>} */
  let ready = [];
  /** @type {Map<number, {fn: () => void, delay: number}>} */
  const timers = new Map();
  let timerId = 0;
  /** @type {string[]} */
  const consoleErrors = [];
  /** @type {any[]} */
  const synths = [];
  /** @type {any[][]} */
  const calls = [];
  /** @type {(() => void) | null} */
  let interval = null;
  /** @type {El[]} */
  const created = [];

  /** @type {Record<string, any>} */
  const sandbox = {
    document: {
      body: { prepend: (/** @type {El} */ e) => { page.body.unshift(e); page.events.push(["prepend", e.src]); } },
      getElementById: (/** @type {string} */ id) => page.elements[id] || null,
      createElement: (/** @type {string} */ tag) => {
        const e = new El(tag, page);
        created.push(e);
        return e;
      },
      addEventListener: (/** @type {string} */ type, /** @type {() => void} */ fn) => { if (type === "DOMContentLoaded") ready.push(fn); },
    },
    setTimeout: (/** @type {() => void} */ fn, /** @type {number} */ delay) => { timers.set(++timerId, { fn, delay }); return timerId; },
    clearTimeout: (/** @type {number} */ id) => { timers.delete(id); },
    atob, btoa, TextEncoder,
    console: { error: (/** @type {any} */ e) => consoleErrors.push(String((e && e.message) || e)), log() {}, warn() {} },
  };
  sandbox.window = sandbox;

  /** @type {any} */
  let audio = null;
  if (engine === "real") {
    audio = webAudioMock();
    Object.assign(sandbox, {
      AudioContext: audio.AudioContext,
      performance: { now: () => 0 },
      setInterval: (/** @type {() => void} */ fn) => { interval = fn; return 1; },
      clearInterval() {},
    });
    vm.createContext(sandbox);
    vm.runInContext(engineSource(), sandbox);
    // Record what the page does with the engine, and every MIDI message it schedules.
    const Real = sandbox.WebAudioTinySynth;
    sandbox.WebAudioTinySynth = function (/** @type {any} */ opts) {
      const synth = new Real(opts);
      synth.getAudioContext().outputLatency = outputLatency;
      // Only the page's own calls are recorded, not the engine's calls to itself (loadMIDI calls
      // stopMIDI, for example).
      let depth = 0;
      for (const name of ["setLoop", "setLoopEnd", "loadMIDI", "playMIDI", "stopMIDI"]) {
        const f = synth[name];
        synth[name] = (/** @type {any[]} */ ...args) => {
          if (!depth) calls.push([name, ...args]);
          depth++;
          try {
            return f(...args);
          } finally {
            depth--;
          }
        };
      }
      const send = synth.send;
      synth.sent = [];
      synth.send = (/** @type {number[]} */ msg, /** @type {number} */ t) => { synth.sent.push([msg, t]); return send(msg, t); };
      synths.push(synth);
      calls.push(["new", { ...opts }]);
      return synth;
    };
  } else {
    vm.createContext(sandbox);
    sandbox.WebAudioTinySynth = function FakeSynth(/** @type {any} */ opts) {
      if (constructError) throw new Error(constructError);
      const ctx = { state: "suspended", currentTime: 1.5, outputLatency, resume: () => {
        calls.push(["resume"]);
        if (resumeError) return Promise.reject(new Error(resumeError));
        ctx.state = "running";
        return Promise.resolve();
      } };
      /** @type {Record<string, any>} */
      const synth = { opts, ctx, maxTick: 0, playTime: 0, playTick: 0, tick2Time: 0.01, timbres: [] };
      // Channel nodes, whose pending automation the player cancels on ■.
      const param = (/** @type {string} */ name, /** @type {number} */ ch) => ({ cancelScheduledValues: (/** @type {number} */ t) => calls.push(["cancel", name, ch, t]) });
      synth.chvol = Array.from({ length: 16 }, (_, ch) => ({ gain: param("chvol", ch) }));
      synth.chmod = Array.from({ length: 16 }, (_, ch) => ({ gain: param("chmod", ch) }));
      synth.chpan = Array.from({ length: 16 }, (_, ch) => ({ pan: param("chpan", ch) }));
      const record = (/** @type {string} */ name, /** @type {(...a: any[]) => void} */ f = () => {}) => (/** @type {any[]} */ ...args) => { calls.push([name, ...args]); f(...args); };
      Object.assign(synth, {
        getAudioContext: () => ctx,
        setQuality: record("setQuality"), setMasterVol: record("setMasterVol"), setReverbLev: record("setReverbLev"),
        setVoices: record("setVoices"), setTimbre: record("setTimbre"), setLoop: record("setLoop"), setLoopEnd: record("setLoopEnd"),
        loadMIDI: record("loadMIDI", (/** @type {Uint8Array} */ bytes) => { synth.maxTick = 4242; synth.playTick = 0; synth.midi = bytes; }),
        playMIDI: record("playMIDI", () => { synth.playTime = ctx.currentTime + 0.1; }),
        stopMIDI: record("stopMIDI"),
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
    synths,
    consoleErrors,
    timers,
    audio,
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
    /** Fires the onload handler of every image created so far (images "decode" on demand here). */
    loadImages() {
      for (const img of created.splice(0)) if (img.onload) img.onload();
    },
    /** Lets pending promise callbacks run. */
    flush: () => new Promise((resolve) => setImmediate(resolve)),
    /** Real engine only: advances the AudioContext clock in 60 ms steps, running the sequencer. */
    advance(/** @type {number} */ seconds) {
      const ctx = synths[0].getAudioContext();
      for (let t = 0; t < seconds; t += 0.06) {
        ctx.currentTime += 0.06;
        if (interval) interval();
      }
    },
  };
}
