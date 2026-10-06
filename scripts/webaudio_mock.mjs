// @ts-check
// A WebAudio mock that records every node creation, connection and scheduling call, for running the
// real TinySynth engine in node:vm without audio (scripts/engine_schedule.test.mjs,
// player/player.test.js). Each call to webAudioMock() returns a fresh, independent recorder.

/**
 * @returns {{AudioContext: any, log: any[][], nodes: Record<string, any>, contexts: any[]}}
 */
export function webAudioMock() {
  /** @type {any[][]} */
  const log = [];
  /** @type {Record<string, any>} */
  const nodes = {};
  /** @type {any[]} */
  const contexts = [];
  let id = 0;
  class Param {
    /** @param {string} name @param {number} value */
    constructor(name, value) { this.name = name; this.value = value; }
    /** @param {number} v @param {number} t */
    setValueAtTime(v, t) { log.push([this.name, "set", v, t]); }
    /** @param {number} v @param {number} t */
    linearRampToValueAtTime(v, t) { log.push([this.name, "ramp", v, t]); }
    /** @param {number} v @param {number} t @param {number} c */
    setTargetAtTime(v, t, c) { log.push([this.name, "target", v, t, c]); }
    /** @param {number} t */
    cancelScheduledValues(t) { log.push([this.name, "cancel", t]); }
  }
  class Node {
    /** @param {string} kind */
    constructor(kind) { this.name = `${kind}#${++id}`; nodes[this.name] = this; log.push([this.name, "create"]); }
    /** @param {any} dest */
    connect(dest) { log.push([this.name, "connect", dest.name ?? String(dest)]); }
    disconnect() { log.push([this.name, "disconnect"]); }
    /** @param {number} t */
    start(t) { log.push([this.name, "start", t]); }
    /** @param {number} t */
    stop(t) { log.push([this.name, "stop", t]); }
  }
  class Osc extends Node {
    constructor() {
      super("osc");
      this.frequency = new Param(this.name + ".frequency", 440);
      this.detune = new Param(this.name + ".detune", 0);
    }
    /** @param {string} t */
    set type(t) { log.push([this.name, "type", t]); }
    /** @param {any} w */
    setPeriodicWave(w) { log.push([this.name, "periodicWave", w]); }
  }
  class Src extends Node {
    constructor() {
      super("src");
      this.playbackRate = new Param(this.name + ".playbackRate", 1);
      this.detune = new Param(this.name + ".detune", 0);
    }
  }
  class Gain extends Node {
    constructor() { super("gain"); this.gain = new Param(this.name + ".gain", 1); }
  }
  class Biquad extends Node {
    constructor() {
      super("biquad");
      this.frequency = new Param(this.name + ".frequency", 350);
      this.Q = new Param(this.name + ".Q", 1);
    }
    /** @param {string} t */
    set type(t) { log.push([this.name, "type", t]); this.kind = t; }
  }
  class Ctx {
    constructor() {
      this.sampleRate = 8000; this.currentTime = 0; this.state = "running"; this.outputLatency = 0;
      this.destination = new Node("dest");
      contexts.push(this);
    }
    resume() { log.push(["ctx", "resume"]); this.state = "running"; return Promise.resolve(); }
    suspend() { log.push(["ctx", "suspend"]); this.state = "suspended"; return Promise.resolve(); }
    createGain() { return new Gain(); }
    createOscillator() { return new Osc(); }
    createBufferSource() { return new Src(); }
    createBiquadFilter() { return new Biquad(); }
    /** @param {number} ch @param {number} len */
    createBuffer(ch, len) { const d = Array.from({ length: ch }, () => new Float32Array(len)); return { length: len, getChannelData: (/** @type {number} */ i) => d[i] }; }
    createStereoPanner() { const n = new Node("pan"); return Object.assign(n, { pan: new Param(n.name + ".pan", 0) }); }
    createDynamicsCompressor() { return new Node("comp"); }
    createConvolver() { return new Node("conv"); }
    /** @param {ArrayLike<number>} real @param {ArrayLike<number>} imag */
    createPeriodicWave(real, imag) { const w = { real: Array.from(real), imag: Array.from(imag) }; log.push(["ctx", "createPeriodicWave", w]); return w; }
  }
  return { AudioContext: Ctx, log, nodes, contexts };
}
