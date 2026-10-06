// @ts-check
/**
 * The notes UI: the token's MIDI drawn as a piano roll on a <canvas>, scrolling with the music. An
 * optional UI utility, separate from the player: a page that wants it injects this script beside the
 * player and calls `OnchainMidiNotes.mount(canvas, options)` (onchain-midi-player #59 makes it a
 * segment of its own; until then it is built by `notesScript()` in scripts/build_page.mjs and is not
 * part of PAGE). It reads only the MIDI, a canvas and a clock, never the engine.
 *
 * Notes enter on the right and travel left; a note sounds as it reaches the playhead, near the left
 * edge (`playheadX`). One colour per channel; the drum channel (9, "channel 10") is ticks along a
 * band at the bottom; pitch maps to height over the song's own range. Before ▶, and for a reader
 * who prefers reduced motion, the opening bars stand still, muted (`idleAlpha`); while playing they
 * scroll with the clock (`playAlpha`), only while the page is visible (the browser pauses animation
 * frames for a hidden page); paused, they hold where they are. The defaults suit the Beasts card (250x350, its art
 * frame at (15, 58), 220x156), so a Beasts page's call is short:
 *
 *   OnchainMidiNotes.mount(canvas, { midi, clock, img })
 *
 * Plain browser JavaScript, no dependencies, no network, no storage. Failing silently is the caller's
 * choice: `mount` throws on a MIDI it cannot read; drawing errors stop the animation.
 */

/**
 * Every option of `mount`, with its default.
 * - `midi`: the MIDI file, as bytes or base64 text (surrounding spaces allowed).
 * - `clock`: returns the seconds heard since tick 0 of the first pass (the player's `startTime`
 *   at ▶, the AudioContext's `currentTime` minus its `outputLatency`). Read only while playing.
 * - `img`: the art's <img>, or a function returning the current one (a player that restarts the art
 *   swaps the element). With it, `box` and `hide` are in the art's units (`view`), mapped to where
 *   the <img> draws the art (`object-fit: contain`), and the canvas is inserted just before the
 *   <img> (behind it) unless already in the document. Without it they are CSS pixels of the
 *   viewport. Either way the canvas is `position: fixed` over `box`, at the device's pixel ratio,
 *   and follows resizes.
 * - `view`: the art's own units [x, y, width, height] (its viewBox).
 * - `box`: where the notes go [x, y, width, height].
 * - `hide`: rectangles [x, y, width, height] where no note is drawn (a sprite's box, say).
 * - `playheadX`: where notes sound, as a fraction of the box's width from its left; a thin line marks
 *   it. `null`: no line, notes sound at the left edge.
 * - `beats`: how many beats the box spans, at the song's average tempo.
 * - `palette`: CSS colours, one per channel: channel modulo the array's length, the drum channel
 *   (9) included. The composer chooses them (Beasts passes its card's colours).
 * - `idleAlpha`, `playAlpha`: the notes' opacity standing still and playing (times 0.6 to 1 by
 *   velocity); a sounding note is drawn at twice `playAlpha` (at most 1).
 * - `drums`: the drum band's height at the bottom of the box; 0 draws no drums and keeps no band.
 * - `drumColor`: a CSS colour for the drum ticks instead of the palette's; null: the palette's.
 * - `background`: the canvas's CSS background (the art's own colour behind the notes), "" for none.
 */
export const DEFAULTS = {
  midi: /** @type {Uint8Array | string} */ (""),
  clock: /** @type {() => number} */ (() => 0),
  img: /** @type {HTMLImageElement | (() => HTMLImageElement | null) | null} */ (null),
  view: [0, 0, 250, 350],
  box: [15, 58, 220, 156],
  hide: /** @type {number[][]} */ ([]),
  playheadX: /** @type {number | null} */ (0.07),
  beats: 24,
  palette: ["#7a3cff", "#e0a800", "#1fb6a6", "#ff5c8a", "#4a90e2", "#f07b2a", "#8bc34a", "#c06bd6"],
  idleAlpha: 0.35,
  playAlpha: 0.5,
  drums: 12,
  drumColor: /** @type {string | null} */ (null),
  background: "#000",
};

/** @typedef {typeof DEFAULTS} NotesOptions */
/** @typedef {{start: number, end: number, key: number, ch: number, vel: number}} Note */

/**
 * The notes of a Standard MIDI File as bars: each note on to the next note off of the same channel
 * and key (a note on of velocity 0 is an off; a note on over a sounding one ends it; a note never
 * ended lasts to the end of the pass), in seconds under the tempo map (120 BPM until the first
 * tempo event), sorted by start. `seconds` is one pass (End-of-Track, the player's loop), `beat` the
 * average beat over it, `lo` and `hi` the pitch range outside the drum channel. Reads files the
 * player accepts (its `checkMidi`); throws on what it cannot read.
 * @param {Uint8Array} u
 */
export function midiNotes(u) {
  let p = 14;
  const vlq = () => {
    let v = 0;
    let b;
    do {
      if (p >= u.length) throw new Error("notes: truncated MIDI");
      b = u[p++];
      v = v * 128 + (b & 127);
    } while (b & 128);
    return v;
  };
  const division = (u[12] << 8) | u[13];
  if (String.fromCharCode(...u.subarray(0, 4)) != "MThd" || !division || division & 0x8000) throw new Error("notes: not a MIDI file");
  /** @type {number[][]} [tick, microseconds per beat] */
  const tempos = [];
  /** @type {number[][]} [tick, status, data1, data2] */
  const events = [];
  let maxTick = 0;
  for (let t = (u[10] << 8) | u[11]; t--;) {
    const end = p + 8 + ((u[p + 4] << 24) | (u[p + 5] << 16) | (u[p + 6] << 8) | u[p + 7]);
    p += 8;
    let tick = 0;
    let run = 0;
    while (p < end) {
      tick += vlq();
      let st = u[p];
      if (st < 128) st = run;
      else p++;
      if (st == 0xff) {
        const type = u[p++];
        const n = vlq();
        if (type == 0x51) tempos.push([tick, (u[p] << 16) | (u[p + 1] << 8) | u[p + 2]]);
        p += n;
      } else if (st >= 0xf0) {
        const n = vlq(); // not p += vlq(): that would read p before vlq() moves it
        p += n;
      }
      else {
        run = st;
        events.push([tick, st, u[p++], (st & 0xe0) == 0xc0 ? 0 : u[p++]]);
      }
    }
    if (tick > maxTick) maxTick = tick;
    p = end;
  }
  tempos.sort((a, b) => a[0] - b[0]);
  const time = (/** @type {number} */ to) => {
    let s = 0;
    let at = 0;
    let us = 500000;
    for (const [tick, tempo] of tempos) {
      if (tick >= to) break;
      s += ((tick - at) * us) / 1e6 / division;
      at = tick;
      us = tempo;
    }
    return s + ((to - at) * us) / 1e6 / division;
  };
  const seconds = time(maxTick);
  if (!(seconds > 0)) throw new Error("notes: empty MIDI");
  /** @type {Note[]} */
  const notes = [];
  /** @type {Record<number, Note>} */
  const open = {};
  let lo = 127;
  let hi = 0;
  events.sort((a, b) => a[0] - b[0]); // stable: a track's events at one tick keep their order
  for (const [tick, st, key, vel] of events) {
    if ((st & 0xe0) != 0x80) continue; // 8n note off, 9n note on
    const ch = st & 15;
    const id = ch * 128 + key;
    const t = time(tick);
    if (open[id]) open[id].end = t;
    delete open[id];
    if (st >= 0x90 && vel) {
      notes.push((open[id] = { start: t, end: seconds, key, ch, vel }));
      if (ch != 9) (lo = Math.min(lo, key)), (hi = Math.max(hi, key));
    }
  }
  return { notes, seconds, beat: (seconds * division) / maxTick, lo, hi };
}

/**
 * Where a box goes on screen, in CSS px: `box` [x, y, w, h] in the art's units `view`, where an
 * <img> whose own rectangle is `rect` draws the art, scaled to fit and centred (`object-fit:
 * contain`, the SVG's default `preserveAspectRatio`). `k` is the art's scale on screen. Null
 * without a usable size.
 * @param {number[]} box
 * @param {number[]} view
 * @param {{left: number, top: number, width: number, height: number}} rect
 */
export function screenBox(box, view, rect) {
  const [x0, y0, w, h] = view;
  if (!(w > 0 && h > 0 && rect.width > 0 && rect.height > 0)) return null;
  const k = Math.min(rect.width / w, rect.height / h);
  return { left: rect.left + (rect.width - w * k) / 2 + (box[0] - x0) * k, top: rect.top + (rect.height - h * k) / 2 + (box[1] - y0) * k, width: box[2] * k, height: box[3] * k, k };
}

/**
 * Draws one frame on `g`, whose units are those of `o.box` with its top-left corner at 0, 0: the
 * notes heard `at` seconds after tick 0 of the first pass, repeating every pass, none before the
 * first. `live`: playing (`playAlpha`, sounding notes brighter), else standing still (`idleAlpha`).
 * @param {CanvasRenderingContext2D} g
 * @param {ReturnType<typeof midiNotes>} roll
 * @param {NotesOptions} o
 * @param {number} at
 * @param {boolean} live
 */
export function drawNotes(g, roll, o, at, live) {
  const [bx, by, w, h] = o.box;
  const { notes, seconds: pass, lo, hi } = roll;
  const k = w / (o.beats * roll.beat); // units per second
  const now = (o.playheadX || 0) * w;
  const top = 4;
  const row = (h - (o.drums ? o.drums + 2 : 4) - top) / Math.max(1, hi - lo + 1);
  const bar = Math.max(1, Math.min(row * 0.8, 5));
  const alpha = live ? o.playAlpha : o.idleAlpha;
  g.globalAlpha = 1;
  g.clearRect(0, 0, w, h);
  g.save();
  if (o.hide.length) {
    g.beginPath();
    g.rect(0, 0, w, h);
    for (const [x, y, rw, rh] of o.hide) g.rect(x - bx, y - by, rw, rh);
    g.clip("evenodd");
  }
  // The passes j that can show: those overlapping the seconds [at - now/k, at + (w - now)/k].
  for (let j = Math.max(0, Math.floor((at - now / k) / pass)); j * pass <= at + (w - now) / k; j++) {
    for (const n of notes) {
      if (n.ch == 9 && !o.drums) continue;
      const x = now + (j * pass + n.start - at) * k;
      const len = (n.end - n.start) * k;
      if (x >= w || x + Math.max(1, len) <= 0) continue;
      const sounding = live && x <= now && x + len > now;
      g.globalAlpha = Math.min(1, sounding ? 2 * alpha : alpha) * (0.6 + (0.4 * n.vel) / 127);
      if (n.ch == 9) {
        const th = ((0.3 + (0.7 * n.vel) / 127) * o.drums) / 2;
        g.fillStyle = o.drumColor || o.palette[9 % o.palette.length];
        g.fillRect(x, h - 2 - th, 1, th);
      } else {
        g.fillStyle = o.palette[n.ch % o.palette.length];
        g.fillRect(x, top + (hi - n.key + 0.5) * row - bar / 2, Math.max(1, len - 0.3), bar);
      }
    }
  }
  if (o.playheadX != null) {
    g.globalAlpha = live ? 0.3 : 0.15;
    g.fillStyle = "#fff";
    g.fillRect(now - 0.3, 0, 0.6, h);
  }
  g.restore();
}

/**
 * Mounts the notes UI on `canvas` (see DEFAULTS for the options) and draws it standing still.
 * Returns `play()` (scroll with the clock, from wherever it is: also resumes), `pause()` (hold the
 * current frame; no animation frames until `play()`), `stop()` (back to the still opening bars),
 * `draw()` (lay out and redraw), and the resolved `options`.
 * @param {HTMLCanvasElement} canvas
 * @param {Partial<NotesOptions>} options
 */
export function mount(canvas, options) {
  const o = /** @type {NotesOptions} */ ({ ...DEFAULTS, ...options });
  let midi = o.midi;
  if (typeof midi == "string") midi = Uint8Array.from(atob(midi.trim()), (c) => c.charCodeAt(0));
  const roll = midiNotes(midi);
  const img = () => (typeof o.img == "function" ? o.img() : o.img);
  let frame = 0;
  let live = false; // playing or paused: the scrolling view, at the clock's last reading
  let at = 0;
  canvas.style.position = "fixed";
  canvas.style.background = o.background;
  const first = img();
  if (first && !canvas.isConnected) first.before(canvas);
  /** Lays the canvas over the box, then draws the frame heard at `at`. */
  const paint = (/** @type {number} */ at) => {
    const i = img();
    const [x, y, w, h] = o.box;
    const r = i ? screenBox(o.box, o.view, i.getBoundingClientRect()) : { left: x, top: y, width: w, height: h };
    canvas.hidden = !r;
    if (!r) return;
    const s = canvas.style;
    [s.left, s.top, s.width, s.height] = [r.left, r.top, r.width, r.height].map((v) => v + "px");
    const d = globalThis.devicePixelRatio || 1;
    const cw = Math.round(r.width * d);
    const ch = Math.round(r.height * d);
    if (canvas.width != cw || canvas.height != ch) [canvas.width, canvas.height] = [cw, ch];
    const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
    g.setTransform(cw / w, 0, 0, ch / h, 0, 0);
    drawNotes(g, roll, o, Math.max(0, at), live);
  };
  const tick = () => {
    frame = 0;
    try {
      paint((at = o.clock()));
      frame = globalThis.requestAnimationFrame(tick);
    } catch (e) {} // the notes stop where they are
  };
  const halt = () => {
    if (frame) globalThis.cancelAnimationFrame(frame);
    frame = 0;
  };
  const draw = () => frame || paint(at);
  const stop = () => {
    halt();
    live = false;
    paint((at = 0));
  };
  globalThis.addEventListener?.("resize", draw);
  draw();
  return {
    play() {
      halt();
      if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return stop();
      live = true;
      tick();
    },
    pause() {
      halt();
      paint(at);
    },
    stop,
    draw,
    options: o,
  };
}

/**
 * The art for a page that draws the notes behind it: the SVG text with its root's `data-notes-bg`
 * child (the opaque background of the notes box, such as a frame's rect), and every root child
 * painted before it (the card's own background), masked out by that element's own shape, so a
 * canvas behind the <img> shows through there, under whatever is painted after it (a sprite).
 * Titles and animations stay where they are (an animation applies to its parent). Unchanged without
 * a `data-notes-bg` child of the root. The `image` a marketplace shows is not touched: only the
 * page's copy. Uses the browser's DOMParser and XMLSerializer.
 * @param {string} svg
 */
export function cutout(svg) {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  let bg = root.firstChild;
  while (bg && !(bg.nodeType == 1 && /** @type {Element} */ (bg).hasAttribute("data-notes-bg"))) bg = bg.nextSibling;
  if (!bg) return svg;
  const el = /** @type {Element} */ (bg);
  /** @param {string} name @param {Record<string, string | number>} attrs */
  const make = (name, attrs) => {
    const e = doc.createElementNS("http://www.w3.org/2000/svg", name);
    for (const a in attrs) e.setAttribute(a, String(attrs[a]));
    return e;
  };
  const all = { x: -1e4, y: -1e4, width: 2e4, height: 2e4 };
  const mask = make("mask", { id: "onchain-midi-notes", maskUnits: "userSpaceOnUse", ...all });
  const hole = /** @type {Element} */ (el.cloneNode(false));
  hole.removeAttribute("id");
  hole.setAttribute("fill", "#000");
  mask.appendChild(make("rect", { ...all, fill: "#fff" }));
  mask.appendChild(hole);
  const g = make("g", { mask: "url(#onchain-midi-notes)" });
  const next = el.nextSibling;
  for (let n = root.firstChild; n && n != next;) {
    const after = n.nextSibling;
    if (n.nodeType == 1 && !/^(title|desc|metadata|set|animate\w*)$/.test(/** @type {Element} */ (n).localName)) g.appendChild(n);
    n = after;
  }
  root.insertBefore(mask, next);
  root.insertBefore(g, next);
  return new XMLSerializer().serializeToString(doc);
}
