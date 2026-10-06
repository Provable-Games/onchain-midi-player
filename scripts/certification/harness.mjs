// @ts-nocheck
// Runs the actual composed NFT HTML: shared loader, combined player payload, data and NFT UI.
// The deterministic node recorder supplies scheduling evidence only; it never renders audio.
import vm from "node:vm";
import { parse } from "parse5";
import { webAudioMock } from "../webaudio_mock.mjs";

class Element {
  constructor(tag, page, text = "") {
    this.tag = tag; this.tagName = tag.toUpperCase(); this.page = page; this._text = text;
    this.namespaceURI = "http://www.w3.org/1999/xhtml";
    this.attributes = {}; this.dataset = {}; this.style = {}; this.disabled = false;
    this.hidden = false; this.onclick = null; this.parent = null;
  }
  get id() { return this.getAttribute("id") || ""; }
  set id(value) { this.setAttribute("id", value); }
  get src() { return this.getAttribute("src") || ""; }
  set src(value) { this.setAttribute("src", value); }
  get textContent() { return this._text; }
  set textContent(value) { this._text = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name.startsWith("data-")) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
    if (name === "disabled") this.disabled = true;
    if (name === "hidden") this.hidden = true;
  }
  replaceWith(other) {
    const at = this.page.nodes.indexOf(this);
    if (at < 0) throw Error("element is not in the document");
    this.page.nodes[at] = other;
    if (other.tag === "script") this.page.runScript(other.textContent);
  }
}

/** Execute current composed HTML, keeping the embedded engine and recording its public calls. */
export function runPage(html, { sampleRate = 44100, outputLatency = 0.02, onConstruct } = {}) {
  const uncaught = [], consoleErrors = [], synths = [], calls = [], certificationCalls = [];
  const timers = new Map(), intervals = new Map(), intervalDelays = [], intervalObservations = [];
  const handlers = new Map(), ready = [];
  let sandbox, timerId = 0, wallTime = 0;
  const page = { nodes: [], elements: {}, runScript(code) {
    try { vm.runInContext(code, sandbox, { filename: "composed-nft.js" }); }
    catch (error) {
      uncaught.push(String(error.message || error));
      for (const fn of handlers.get("error") || []) fn({ error, message: error.message, preventDefault() {} });
    }
  }};
  function visit(node) {
    if (node.tagName) {
      const el = new Element(node.tagName, page, (node.childNodes || []).filter(n => n.nodeName === "#text").map(n => n.value).join(""));
      el.namespaceURI = node.namespaceURI;
      for (const attr of node.attrs || []) el.setAttribute(attr.name, attr.value);
      page.nodes.push(el);
      if (el.id) page.elements[el.id] = el;
    }
    // parse5 keeps template.content separate, as a browser does; it is deliberately inert here.
    for (const child of node.childNodes || []) visit(child);
  }
  visit(parse(html));
  const body = page.nodes.find(el => el.tag === "body");
  const button = page.elements.play;
  const audio = webAudioMock({ sampleRate });
  sandbox = {
    document: {
      body, readyState: "loading", hidden: false,
      getElementById: id => page.nodes.find(el => el.id === id) || null,
      createElement: tag => new Element(tag, page),
      querySelectorAll(selector) {
        const script = /^script\[type="([^"]*)"\]$/.exec(selector);
        if (script) return page.nodes.filter(el => el.tag === "script" && el.getAttribute("type") === script[1]);
        const id = /^\[id="([^"]*)"\]$/.exec(selector);
        if (id) return page.nodes.filter(el => el.id === id[1]);
        throw Error("unsupported recorder selector " + selector);
      },
      addEventListener(type, fn) { if (type === "DOMContentLoaded") ready.push(fn); },
    },
    setTimeout(fn, delay) {
      if (!(delay >= 0 && delay <= 2147483647)) throw Error("timer delay out of range");
      timers.set(++timerId, { fn, due: wallTime + delay / 1000 }); return timerId;
    },
    clearTimeout(id) { timers.delete(id); },
    setInterval(fn, delay) {
      intervalDelays.push(delay); intervals.set(++timerId, { fn, delay, last: wallTime }); return timerId;
    },
    clearInterval(id) { intervals.delete(id); },
    addEventListener(type, fn) { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type).add(fn); },
    removeEventListener(type, fn) { handlers.get(type)?.delete(fn); },
    atob, btoa, TextEncoder, TextDecoder, AudioContext: audio.AudioContext,
    performance: { now: () => wallTime * 1000 },
    navigator: {}, SVGSVGElement: class SVGSVGElement {},
    console: { error: e => consoleErrors.push(String(e?.message || e)), log() {}, warn() {} },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  let Real;
  function RecordedSynth(opts) {
      const synth = new Real(opts);
      synth.playInvocations = [];
      synth.waveRegistrations = [];
      if (outputLatency === null) delete synth.getAudioContext().outputLatency;
      else synth.getAudioContext().outputLatency = outputLatency;
      // Only the page's own calls are recorded, not the engine's calls to itself (loadMIDI calls
      // stopMIDI, for example).
      let depth = 0;
      for (const name of ["setSampleWave", "setHarmonicWave", "setQuality", "setMasterVol", "setReverbLev", "setVoices", "setTimbre", "setLoop", "setLoopEnd", "loadMIDI", "playMIDI", "stopMIDI", "prewarm", "resume"]) {
        const f = synth[name];
        synth[name] = (/** @type {any[]} */ ...args) => {
          if (!depth) {
            certificationCalls.push([name, ...args]);
            if (!["setSampleWave", "setHarmonicWave", "setQuality", "setMasterVol", "setReverbLev", "setVoices", "setTimbre"].includes(name)) calls.push([name, ...args]);
          }
          depth++;
          try {
            if (name === "playMIDI") {
              const before = { contextTime: synth.getAudioContext().currentTime, startTime: synth.getPlayStatus().startTime };
              const result = f(...args);
              synth.playInvocations.push({ before, after: { contextTime: synth.getAudioContext().currentTime, startTime: synth.getPlayStatus().startTime } });
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
    }
  Object.defineProperty(sandbox, "WebAudioTinySynth", {
    configurable: true, get: () => Real && RecordedSynth, set: value => { Real = value; },
  });
  // Run only executable HTML classic scripts in document order. The loader executes gzip scripts.
  for (const el of [...page.nodes]) {
    if (el.tag === "script" && el.namespaceURI === "http://www.w3.org/1999/xhtml" &&
        [null, "text/javascript"].includes(el.getAttribute("type")) && !el.src) page.runScript(el.textContent);
  }
  return {
    page, els: page.elements, calls, certificationCalls, synths, consoleErrors, uncaught, timers,
    intervals, intervalDelays, intervalObservations, audio,
    get engineLoaded() { return typeof Real === "function"; },
    get api() { return sandbox.OnchainMidiPlayer; },
    ready() { sandbox.document.readyState = "interactive"; for (const fn of ready.splice(0)) fn(); },
    click() { if (!button.disabled) button.onclick?.(); },
    flush: () => new Promise(resolve => setImmediate(resolve)),
    run(seconds, step = 0.005) {
      const ctx = synths[0].getAudioContext(), end = wallTime + seconds;
      while (wallTime < end - 1e-9) {
        const increment = Math.min(step, end - wallTime);
        wallTime = Math.round((wallTime + increment) * 1e6) / 1e6;
        if (ctx.state === "running") ctx.currentTime = Math.round((ctx.currentTime + increment) * 1e6) / 1e6;
        for (const [id, iv] of [...intervals]) {
          if (!intervals.has(id) || wallTime - iv.last < iv.delay / 1000 - 1e-9) continue;
          iv.last = wallTime;
          const statusBefore = synths[0].getPlayStatus(); iv.fn();
          intervalObservations.push({ delay: iv.delay, contextTime: ctx.currentTime, statusBefore, statusAfter: synths[0].getPlayStatus() });
        }
        for (;;) {
          const due = [...timers].find(([, t]) => t.due <= wallTime + 1e-9);
          if (!due) break;
          timers.delete(due[0]); due[1].fn();
        }
      }
    },
  };
}
