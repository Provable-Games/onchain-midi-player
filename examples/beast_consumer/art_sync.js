// @ts-check
// Sync NFT art to the onchain MIDI player: a small reference to copy.
//
// Never schedule the art. Let it run on the page clock, and seek it to the music's position at
// moments the player already announces: each pass (onPassStart; the first one fires when the music
// becomes audible) and each transport or latency change (onStateChange). Every seek reads
// player.getPlayStatus() at that moment, so a late event cannot misalign the art.
/** @typedef {import("../../player/api.d.ts").OnchainMidiApi} OnchainMidiApi */
/** @typedef {import("../../player/api.d.ts").PlayStatus} PlayStatus */

// Provisional NFT reference policy: lab value, pending physical display/audio checks in #52.
export const REFERENCE_DISPLAY_LEAD_SECONDS = 0.017;

/**
 * Where the art belongs now: the music's estimated audible position plus a display lead, wrapped to
 * one pass (the art loops with the music). 0 while the player has no position.
 * @param {PlayStatus} s
 * @param {number} [displayLead]
 */
export function artTime(s, displayLead = REFERENCE_DISPLAY_LEAD_SECONDS) {
  if (s.positionSeconds === null) return 0;
  const t = Math.max(0, s.positionSeconds + displayLead);
  return s.passSeconds ? t % s.passSeconds : t;
}

/**
 * Inline SVG the page controls (trusted art): seeks the root `<svg>` and every nested `<svg>`.
 * Where the art belongs is worked out from `player.getPlayStatus()` alone, never from what a
 * notification says, so missed or out-of-date events cannot leave it wrong:
 * - free (animating on its own, from where it is): before the run's music is audible, and after
 *   stop, a new run or a failure;
 * - running, aligned to the music: once the run is heard (its initial pass event, or the player's
 *   position past zero) while the AudioContext runs, which includes a pending
 *   pause, whose sound plays on until the suspend completes;
 * - frozen where the audio stopped: once audible, while the AudioContext does not run.
 * It seeks on entering running or frozen, at each pass and on a latency change. One transient: a
 * latency increase larger than the music heard so far makes the player clamp its position to zero
 * until the audio clock catches up; the art runs on from the display lead meanwhile, at most that
 * increase ahead, and realigns at the next pass. Optional NFT-owned
 * `notes` are played, paused and stopped with the art and can read `clock()`: audible seconds since
 * tick zero, or null. Without a root (null: art the page cannot seek, an isolated `<img>`), nothing
 * is seeked or paused, and the notes and `clock()` follow the music all the same. Optional `img`
 * controls (restartImgOnPass's) are played, paused and stopped like the notes: an isolated image
 * freezes where the audio stops and moves again when it runs or the run ends.
 * @param {SVGSVGElement | null} svgRoot
 * @param {OnchainMidiApi} player
 * @param {{displayLead?: number, notes?: {play(): void, pause(): void, stop(): void} | null,
 *   img?: {play(): void, pause(): void, stop(): void} | null,
 *   host?: {requestAnimationFrame(f: () => void): number, cancelAnimationFrame(id: number): void}}} [options]
 * @returns {{clock(): number | null, dispose(): void}}
 */
export function syncSvgToMusic(svgRoot, player, { displayLead = REFERENCE_DISPLAY_LEAD_SECONDS, notes = null, img = null, host = window } = {}) {
  const timelines = svgRoot ? [svgRoot, ...svgRoot.querySelectorAll("svg")] : [];
  /** @type {"free" | "running" | "frozen"} */ let mode = "free";
  let heardRun = -1, revision = -1, frame = 0, live = true;
  const seek = (/** @type {PlayStatus} */ s) => { const t = artTime(s, displayLead); for (const svg of timelines) svg.setCurrentTime(t); };
  const animate = (/** @type {boolean} */ on) => { for (const svg of timelines) if (on) svg.unpauseAnimations(); else svg.pauseAnimations(); };
  // Heard, per the player: a pass event, or a position past zero (live, or held while suspended,
  // which keeps what was heard when the audio stopped whatever the latency estimate does since).
  // A run stays heard until it ends.
  /** @returns {"free" | "running" | "frozen"} */
  const want = (/** @type {PlayStatus} */ s) => {
    if (s.state !== "playing" && s.state !== "paused") return "free"; // Not started, stopped or failed.
    if (s.runId !== heardRun) {
      if (s.positionSeconds !== null && s.positionSeconds > 0) heardRun = s.runId;
      // The player fires the initial pass event up to 1 ms before the audio clock reaches tick zero's
      // audible start: within that window running audio is followed, but not yet counted as heard.
      else if (!(s.audioState === "running" && s.originTime !== null && s.audioTime !== null
        && s.audioTime >= s.originTime + s.latencySeconds - 0.002)) return "free";
    }
    return s.audioState === "running" ? "running" : "frozen";
  };
  const update = (pass = false) => {
    if (!live) return;
    const s = player.getPlayStatus(), waited = frame !== 0;
    if (pass) heardRun = s.runId; // Pass events come only while the run plays: it is audible.
    host.cancelAnimationFrame(frame);
    // A pause is announced at once, but the sound plays on until the suspend completes, which
    // nothing announces: look again each frame until then.
    frame = s.state === "paused" && s.audioState === "running" ? host.requestAnimationFrame(() => { frame = 0; update(); }) : 0;
    const next = want(s);
    if (next === "running") {
      // Also a latency change, and a resume that came before a frame saw the suspend (the art ran on
      // while the audio was held).
      if (mode !== "running" || pass || s.latencyRevision !== revision || (waited && s.state === "playing")) seek(s);
      if (mode !== "running") { animate(true); notes?.play(); img?.play(); }
    } else if (next === "frozen") {
      if (mode !== "frozen") {
        animate(false); seek(s); // Where the audio stopped.
        // Heard, now paused: notes that never played start, so they read the clock, then hold.
        if (mode === "free") notes?.play();
        notes?.pause(); img?.pause();
      }
    } else if (mode !== "free") {
      animate(true); // From where it is, without a rewind.
      if (s.state === "failed") notes?.pause(); else notes?.stop();
      img?.stop();
    }
    mode = next;
    revision = s.latencyRevision;
  };
  const offPass = player.onPassStart(() => update(true));
  const offState = player.onStateChange(() => update()); // A trigger only: the snapshot may be out of date.
  // Mounted mid-run: follow it at once, but after returning, so notes can read the returned clock().
  queueMicrotask(() => update());
  return {
    clock: () => { const s = player.getPlayStatus(); return s.positionSeconds === null ? null : Math.max(0, s.positionSeconds + displayLead); },
    dispose() {
      live = false; offPass(); offState(); host.cancelAnimationFrame(frame); frame = 0;
      if (mode !== "free") { animate(true); notes?.stop(); img?.stop(); }
      mode = "free";
    },
  };
}

/**
 * Isolated art (community art, generic composed pages) is an `<img>`, which can't be paused or
 * seeked: restart it instead. At each pass event (the first fires when the music becomes audible),
 * a fresh copy decodes off screen and replaces the shown image once loaded, unless a newer restart
 * is already shown or the run changed (stop or replay). Each copy is the image's own `data:` URL
 * with a distinct `r=<n>` parameter added to its media type, so the browser decodes it afresh: the
 * media type, its other parameters and the payload stay byte for byte, whatever the art's encoding.
 * An image from any other URL is never restarted: changing that URL could fetch something else.
 * With `beat`, each copy has the art's first GIF timed to the music instead (retimeGif: each frame
 * on the beat, the loop repeated until it keeps to the beat over the pass), base64-encoded, and
 * the rest of the art byte for byte; a GIF it cannot time, or none, gives the plain copy.
 *
 * The returned dispose function also carries `pause`, `play` and `stop` (syncSvgToMusic's `img`).
 * `pause` freezes the art: no page can stop a GIF inside an image, or read the frame it shows
 * (canvas `drawImage` gets the first frame), so the page works out that frame from the audio
 * clock's time since the shown image started (audioElapsedMs), plus any suspension it played
 * through unfrozen (seen at each transport change and pass), or the page time without that clock,
 * and its GIF's own delays, and shows the art with that GIF replaced by a
 * PNG of the frame (`stillSvg`), decoded off screen like a restart. Restarts wait while frozen.
 * `play` restarts the art, if the still was shown: a retimed GIF from the frame the music is on,
 * shortened to fit (retimeGif's `at`, where artTime says), so it carries on in time; otherwise
 * from its first frame, and the next pass realigns it. A retimed image that played on through the
 * pause (its still never shown) restarts there too. `stop` restarts a shown still from its first
 * frame. A page made visible while the music plays restarts a retimed image where the music is.
 * The still of a retimed image is worked out from that image's own GIF. A pause while the still
 * is still shown (the restart after a resume not yet decoded) keeps that still. Only the latest pause's still is ever shown. Art without a GIF it can
 * still, or a still that fails to be made or decoded, keeps moving and restarting at passes, and so does any other
 * animation in the art (SVG/SMIL). On a hidden page the still is made once the page is visible
 * again; dispose drops a still still waiting for that.
 * Limits: a restart lands up to one decode late, a freeze also; a browser shows a GIF frame up to
 * one screen refresh late; and no page can pause or seek GIF frames inside any art (use SMIL sprite
 * animation for motion seeked with the music).
 * @param {HTMLImageElement} img the shown art
 * @param {OnchainMidiApi} player
 * @param {{onSwap?: (img: HTMLImageElement) => void,
 *   still?: (svg: string, ms: number, doc: Document) => Promise<string | null>,
 *   beat?: (s: PlayStatus) => number | null}} [options] onSwap:
 *   each new image once shown (re-attach observers of the art, such as the play button's
 *   placement); still: the art's text frozen `ms` after its image started (stillSvg); beat: the
 *   music's seconds per beat (beatSeconds), null to keep the art's own timing (the default)
 * @returns {(() => void) & {play(): void, pause(): void, stop(): void}} dispose, with the freeze controls
 */
export function restartImgOnPass(img, player, { onSwap = () => {}, still = stillSvg, beat = () => null } = {}) {
  // data:<media type>[;base64],<payload>, split where the browser splits it (the first comma).
  const url = /^data:([^,]*?)(;\x20*base64[\t\n\f\r ]*)?(,[\s\S]*)$/i.exec(img.src);
  const none = () => {};
  if (!url) return Object.assign(none, { play: none, pause: none, stop: none });
  const [, type, base64 = "", payload] = url, doc = img.ownerDocument;
  // The art's payload as bytes (one character each), so art in any encoding keeps its other bytes.
  const art = () => (base64 ? atob(payload.slice(1).replace(/[\t\n\f\r ]/g, "")) : unescape(payload.slice(1)));
  // frozen: a still is wanted (pending or shown); held: a still is shown; gen: the latest pause;
  // shownAt and shownStatus: when the image now shown started, on the page and the audio clocks;
  // stalled: how long it has played while the audio clock stood still (suspensions it ran through);
  // retimed: the art shown with its GIF timed to the music (retimeGif), or null for the art itself.
  let restarts = 0, shown = 0, live = true, frozen = false, held = false, gen = 0, shownAt = performance.now(), stalled = 0;
  /** @type {PlayStatus | null} */ let shownStatus = null;
  /** @type {string | null} */ let retimed = null;
  /** @type {(() => void) | null} */ let waiting = null;
  const unwait = () => { if (waiting) doc.removeEventListener("visibilitychange", waiting); waiting = null; };
  /**
   * Decodes `src(n)` off screen and shows it, unless disposed, a newer image is shown or `wanted()`
   * fails; `svg`: the retimed art it shows, and `failed`, what to show instead if it cannot decode.
   */
  const show = (/** @type {(n: number) => string} */ src, /** @type {() => boolean} */ wanted, still = false, /** @type {string | null} */ svg = null, /** @type {(() => void) | null} */ failed = null) => {
    const n = ++restarts, next = doc.createElement("img");
    for (const { name, value } of img.attributes) if (name !== "src") next.setAttribute(name, value);
    next.onload = () => {
      if (!live || n < shown || !wanted()) return;
      shown = n; held = still; retimed = svg; shownAt = performance.now(); shownStatus = player.getPlayStatus(); stalled = 0;
      img.replaceWith(next);
      img = next;
      onSwap(next);
    };
    // A still that fails to decode gives up the freeze it was for: the art moves and restarts at passes.
    // A retimed copy that fails gives way to the plain copy.
    next.onerror = () => { if (live && n > shown && wanted()) { if (still) frozen = false; else failed?.(); } };
    next.src = src(n); // The same bytes at a distinct URL.
  };
  /** Restarts the art from its first frame, or with `at` from where the music is (retimeGif's `at`). */
  const restart = (at = false) => {
    const s = player.getPlayStatus(), runId = s.runId;
    /** @type {string | null} */ let svg = null;
    try {
      // The art with its first GIF timed to the music (null: no beat, or no GIF retimeGif can time).
      // The new image starts once decoded: up to one decode after the position it was built for.
      const b = beat(s), text = b ? art() : "", m = GIF_URI.exec(text);
      const gif = m && retimeGif(Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0)), /** @type {number} */ (b), s.passSeconds || 0, at && s.positionSeconds !== null ? artTime(s) : null);
      if (gif) { let bin = ""; for (const x of gif) bin += String.fromCharCode(x); svg = text.replace(m[0], () => "data:image/gif;base64," + btoa(bin)); }
    } catch (e) {}
    const wanted = () => !frozen && player.getPlayStatus().runId === runId, plain = (/** @type {number} */ n) => "data:" + type + ";r=" + n + base64 + payload;
    if (svg === null) show(plain, wanted);
    else show((n) => "data:" + type + ";r=" + n + ";base64," + btoa(/** @type {string} */ (svg)), wanted, false, svg, () => show(plain, wanted));
  };
  // While the audio runs, the page time the shown image has played beyond the audio clock is the
  // suspensions it ran through (a resume that cancelled a pending still, or a pause and resume the
  // transport never reported here): look at each transport change and pass, and remember it.
  const ran = () => {
    const s = player.getPlayStatus(), audio = audioElapsedMs(shownStatus, s);
    if (s.audioState === "running" && audio !== null) stalled = Math.max(0, performance.now() - shownAt - audio);
  };
  // A page made visible while the music plays shows the retimed art from where the music is: a
  // hidden page's images may not have moved meanwhile.
  const visible = () => {
    const s = player.getPlayStatus();
    if (!doc.hidden && !frozen && retimed !== null && s.state === "playing" && s.audioState === "running") restart(true);
  };
  doc.addEventListener("visibilitychange", visible);
  const offState = player.onStateChange(ran);
  const offPass = player.onPassStart(() => { ran(); if (!frozen) restart(); });
  const off = () => { offState(); offPass(); doc.removeEventListener("visibilitychange", visible); };
  /** Shows the still of the art `ms` after it started for pause `g`, unless a later pause or a resume came. */
  const hold = (/** @type {number} */ g, /** @type {number} */ ms) => {
    unwait();
    if (doc.hidden) {
      waiting = () => { if (!doc.hidden) { unwait(); if (live && g == gen && frozen) hold(g, ms); } };
      return doc.addEventListener("visibilitychange", waiting);
    }
    const current = () => live && g == gen && frozen;
    // The art as shown: its GIF retimed, or the art itself.
    const shownArt = retimed;
    Promise.resolve().then(() => still(shownArt ?? art(), ms, doc)).then((svg) => {
      if (!current()) return;
      if (svg) show((n) => "data:" + type + ";r=" + n + ";base64," + btoa(svg), current, true);
      else frozen = false; // Nothing to show: the art keeps moving, and restarting at passes.
    }, () => { if (current()) frozen = false; });
  };
  // Play restarts a still from where the music is, and so a retimed image that played on through a
  // pause whose still never showed; stop restarts a still from its first frame. A still never shown
  // otherwise leaves the art running.
  const thaw = (/** @type {boolean} */ resume) => {
    if (!frozen) return;
    frozen = false;
    unwait();
    if (held || (resume && retimed !== null)) restart(resume);
  };
  return Object.assign(() => { live = false; off(); unwait(); }, {
    pause() {
      if (!live || frozen) return;
      frozen = true;
      // A still still shown (a resume's restart not yet decoded) is where the art stopped: keep it.
      // Otherwise the frame is the one the image showed when the audio stopped: the audio clock's
      // time since it started, held where the clock stopped (a pause can be noticed late, say on a
      // hidden page that defers animation frames), plus the suspensions it played through before;
      // or, without that clock, the page time since.
      const audio = audioElapsedMs(shownStatus, player.getPlayStatus());
      if (!held) hold(++gen, audio === null ? performance.now() - shownAt : audio + stalled);
    },
    play: () => thaw(true),
    stop: () => thaw(false),
  });
}

/** The first embedded GIF of art (its base64 payload in group 1): what stillSvg freezes and restartImgOnPass retimes. */
const GIF_URI = /data:image\/gif;base64,([A-Za-z0-9+/]+=*)/;

/**
 * Milliseconds the AudioContext ran between two play statuses of one run, `from` and the later
 * `to`, by their `audioTime`: how long art started on screen at `from` has played by `to`, however
 * late `to` is read, since the context's clock stops where a suspend stops it. It is the
 * context's own clock, not `positionSeconds`: that one subtracts the latency estimate, which can
 * change in between while an image plays on regardless. And the latency itself is not added: the
 * image runs from when it is shown, not from when the music it was shown with is heard. (An image
 * shown while the context is suspended counts from when the clock runs again.) Null when either
 * has no clock time or they belong to different runs.
 * @param {PlayStatus | null} from
 * @param {PlayStatus} to
 * @returns {number | null}
 */
export function audioElapsedMs(from, to) {
  return from && from.runId === to.runId && from.audioTime != null && to.audioTime != null
    ? Math.round(Math.max(0, to.audioTime - from.audioTime) * 1e6) / 1000 : null; // To the microsecond.
}

/**
 * syncSvgToMusic's `img` for controls that come later (restartImgOnPass's, once the art it copies
 * is showing): each call goes to them once attached, and attaching replays the last call, so a
 * pause that came first still freezes the art.
 * @returns {{play(): void, pause(): void, stop(): void, attach(controls: {play(): void, pause(): void, stop(): void}): void}}
 */
export function laterImg() {
  /** @type {{play(): void, pause(): void, stop(): void} | null} */ let to = null;
  /** @type {"play" | "pause" | "stop" | null} */ let last = null;
  const call = (/** @type {"play" | "pause" | "stop"} */ name) => () => { last = name; to?.[name](); };
  return { play: call("play"), pause: call("pause"), stop: call("stop"), attach(controls) { to = controls; if (last) controls[last](); } };
}

/**
 * The frames of a GIF from its block structure, without decoding pixels: `head`, the bytes every
 * frame shares (signature, screen descriptor and global color table), and each frame's bytes
 * (`start` to `end`: its Graphic Control Extension, descriptor, color table and data), `delay` in
 * ms as browsers show it (0 or 1 cs as 100 ms), `disposal`, `rect` (x, y, width, height) and
 * `transparent` (its Graphic Control Extension's transparency flag); and
 * `plays`, how many times browsers show the loop: once without a NETSCAPE2.0 loop extension, its
 * count plus one (the count is repeats), 0 (forever) for a count of 0. Null when the bytes are not
 * a GIF this walk follows.
 * @param {Uint8Array} b
 * @returns {{head: Uint8Array, width: number, height: number, plays: number,
 *   frames: {start: number, end: number, delay: number, disposal: number, rect: number[], transparent: boolean}[]} | null}
 */
export function gifFrames(b) {
  if (b.length < 13 || String.fromCharCode(...b.subarray(0, 4)) != "GIF8") return null;
  let p = 13 + (b[10] & 128 ? 3 << ((b[10] & 7) + 1) : 0), gce = -1, plays = 1;
  const head = b.subarray(0, p), frames = [], skip = () => { while (p < b.length && b[p]) p += b[p] + 1; p++; };
  while (p < b.length && b[p] != 59) {
    const at = p++;
    if (b[at] == 33) {
      if (b[p] == 249) gce = at;
      // 21 FF 0B "NETSCAPE2.0" 03 01 <count, little-endian> 00
      if (b[p] == 255 && b[p + 1] == 11 && String.fromCharCode(...b.subarray(p + 2, p + 13)) == "NETSCAPE2.0" && b[p + 13] == 3 && b[p + 14] == 1) {
        const count = b[p + 15] | (b[p + 16] << 8);
        plays = count && count + 1;
      }
      p++; skip();
    }
    else if (b[at] == 44) {
      const flags = b[p + 8], cs = gce < 0 ? 0 : b[gce + 4] | (b[gce + 5] << 8);
      const rect = [0, 2, 4, 6].map((i) => b[p + i] | (b[p + i + 1] << 8));
      p += 10 + (flags & 128 ? 3 << ((flags & 7) + 1) : 0);
      skip();
      frames.push({ start: gce < 0 ? at : gce, end: p, delay: cs > 1 ? cs * 10 : 100, disposal: gce < 0 ? 0 : (b[gce + 3] >> 2) & 7, rect, transparent: gce >= 0 && !!(b[gce + 3] & 1) });
      gce = -1;
    } else return null;
  }
  return p < b.length && frames.length ? { head, width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8), plays, frames } : null;
}

/**
 * The frame a GIF shows `ms` after it started, played `plays` times (0: forever); once done, the
 * last frame stays.
 * @param {{delay: number}[]} frames
 * @param {number} ms
 * @param {number} [plays]
 */
export function gifFrameAt(frames, ms, plays = 0) {
  const loop = frames.reduce((sum, f) => sum + f.delay, 0);
  if (plays && ms >= loop * plays) return frames.length - 1;
  let t = Math.max(0, ms) % loop, k = 0;
  while (t >= frames[k].delay) t -= frames[k++].delay;
  return k;
}

/**
 * Which frames of a GIF a loop can start from: true for frame i when what it shows, and so what
 * the frames after it show, does not depend on the frames before it, since the canvas is clear
 * before it (`clear`: the loop starts clear, as browsers start each loop, or the frames before
 * left nothing behind) or it covers the screen with opaque pixels and restores nothing under it
 * (disposal 3). The extra last entry: whether the loop ends with the canvas clear.
 * @param {{width: number, height: number, frames: {disposal: number, rect: number[], transparent: boolean}[]}} gif
 * @param {boolean} [clear] whether the canvas is clear before the first frame
 * @returns {boolean[]}
 */
export function gifStarts(gif, clear = true) {
  const starts = [];
  for (const f of gif.frames) {
    const full = !f.rect[0] && !f.rect[1] && f.rect[2] == gif.width && f.rect[3] == gif.height;
    starts.push(clear || (full && !f.transparent && f.disposal != 3));
    clear = f.disposal == 2 ? clear || full : f.disposal == 3 && clear;
  }
  return [...starts, clear];
}

/**
 * The art's frame step, in µs, for a beat of `beatUs` µs: an eighth note, or the beat itself when
 * the eighth would be under 0.2 s (above 150 BPM). The Beast Sound Check's policy (its `frameUs`);
 * change it here to retune every page.
 * @param {number} beatUs
 */
export const frameUs = (beatUs) => (beatUs / 2 < 200000 ? beatUs : Math.round(beatUs / 2));

/**
 * Seconds per beat of the music playing: one pass (`passSeconds`, from the player's own tempo map)
 * times the MIDI's ticks per beat (its header's bytes 12-13) over the pass's ticks (`maxTick`), as
 * the notes work out their beat. A song with tempo changes gets its average beat. Null without a
 * status, a pass or ticks, for a header that is not `MThd`, SMPTE time (bit 15) and a result that
 * is not a positive number: the art then keeps its own timing.
 * @param {PlayStatus | null | undefined} s
 * @param {Uint8Array | null | undefined} midi the page's MIDI file (its first 14 bytes are enough)
 * @returns {number | null}
 */
export function beatSeconds(s, midi) {
  if (!s || !s.passSeconds || !s.maxTick || !midi || midi.length < 14 || String.fromCharCode(...midi.subarray(0, 4)) != "MThd") return null;
  const division = (midi[12] << 8) | midi[13], beat = (s.passSeconds * division) / s.maxTick;
  return division & 0x8000 || !(beat > 0 && beat < Infinity) ? null : beat;
}

/** A retimed GIF's frame changes may be this far from the beat over a whole pass before more copies are tried (µs). */
export const RETIME_TARGET_US = 6000;
/** The most copies of its frames one retimed GIF holds, and of pixels all its frames hold (about 4 bytes each, decoded). */
export const RETIME_COPIES = 64, RETIME_PIXELS = 1 << 20;

/**
 * The GIF `b` timed to the music: each frame lasts whole frame steps (frameUs of the beat, `beat`
 * seconds), one each for frames of equal delays and, for uneven ones, in proportion to its delay,
 * `max(1, round(n * delay / total))` (20, 40, 20, 20, 20 cs make 1, 2, 1, 1, 1). Delays are whole
 * centiseconds, so frame i ends at the centisecond nearest its place on the step grid (the error
 * carries, never adding up), never under 2 cs (browsers show 0 and 1 cs as 10). A loop the
 * centiseconds cannot hold exactly would drift a little every time round: the frames are repeated
 * (up to RETIME_COPIES times, and RETIME_PIXELS) until every frame change stays within
 * RETIME_TARGET_US of the grid over a `pass` seconds long, or as near as that allows. With `at`
 * (seconds into the pass), the loop starts there: on the frame the grid shows then, that frame
 * shortened to fit, and the rest of the loop in order, ending with the rest of that frame.
 * Only the delays change, and the frames are copied byte for byte. A repeated or rotated loop puts
 * the first frame after the last, where browsers start each loop on a clear canvas: when the last
 * frame leaves something that the first frame would not cover, it restores its area to the
 * background (disposal 2), which only clears what the next loop clears anyway. Where that or a
 * rotation would change what a frame shows (gifStarts), or the GIF plays a set number of times, the
 * loop is neither repeated nor rotated. Null when the GIF is not one gifFrames reads, has fewer than
 * two frames or a frame without its own Graphic Control Extension, or for a beat that is not a
 * positive number.
 * @param {Uint8Array} b
 * @param {number} beat seconds per beat (beatSeconds)
 * @param {number} [pass] seconds per pass of the music
 * @param {number | null} [at] seconds into the pass to start at
 * @returns {Uint8Array | null}
 */
export function retimeGif(b, beat, pass = 0, at = null) {
  const gif = gifFrames(b), frames = gif ? gif.frames : [], n = frames.length, step = frameUs(Math.round(beat * 1e6));
  if (!gif || n < 2 || !(step > 0) || frames.some((f) => b[f.start] != 33 || b[f.start + 1] != 249 || b[f.start + 2] != 4)) return null;
  const starts = gifStarts(gif), [x, y, w, h] = frames[n - 1].rect, total = frames.reduce((t, f) => t + f.delay, 0);
  // The first frame after the last: right as it is, or made right by disposal 2.
  const seam = starts[n] || gifStarts(gif, false)[0], loops = !gif.plays && (seam || starts[n - 1] || (!x && !y && w == gif.width && h == gif.height));
  const steps = frames.map((f) => Math.max(1, Math.round((n * f.delay) / total)));
  /** The frames of `copies` copies, each with where it ends on the grid (µs). */
  const grid = (/** @type {number} */ copies) => {
    let t = 0;
    return Array.from({ length: copies * n }, (_, i) => [i % n, (t += steps[i % n]) * step]);
  };
  let copies = 1, best = Infinity;
  for (let c = 1; c == 1 || (loops && c <= RETIME_COPIES && c * n * gif.width * gif.height <= RETIME_PIXELS); c++) {
    const ends = grid(c), loop = ends[ends.length - 1][1], off = (/** @type {number} */ us) => Math.abs(Math.round(us / 1e4) * 1e4 - us);
    // Each loop adds its own error to every frame change after it.
    const worst = Math.max(...ends.map(([, us]) => off(us))) + Math.max(0, Math.ceil((pass * 1e6) / loop) - 1) * off(loop);
    if (worst < best) (best = worst), (copies = c);
    if (worst <= RETIME_TARGET_US) break;
  }
  let list = grid(copies), rotated = false;
  const loop = list[list.length - 1][1];
  if (at !== null && loops) {
    const q = (((at * 1e6) % loop) + loop) % loop, k = list.findIndex(([, us]) => us > q);
    const turned = [...list.slice(k), ...list.slice(0, k).map(([i, us]) => [i, us + loop]), [list[k][0], loop + q]].map(([i, us]) => [i, us - q]);
    if (turned[0][1] < 1e4) turned.shift(); // Under 1 cs of the first frame left: the next one, that much early.
    if (q && starts[turned[0][0]]) {
      list = turned; rotated = true;
      // The rest of the first frame, under 1 cs: the frame before it lasts to the loop's end instead;
      // under 2 cs: 2 cs, the frame before it ending that much early.
      const rest = loop - list[list.length - 2][1];
      if (rest < 1e4) list.pop(), (list[list.length - 1][1] = loop);
      else if (rest < 2e4) list[list.length - 2][1] = loop - 2e4;
    }
  }
  const patch = !seam && (rotated || copies > 1), pre = b.subarray(0, frames[0].start), end = b.subarray(frames[n - 1].end);
  // Each frame with the bytes before it (the first one's are the loop's own, kept once in `pre`).
  const parts = list.map(([i]) => b.subarray(i ? frames[i - 1].end : frames[0].start, frames[i].end));
  const out = new Uint8Array(pre.length + parts.reduce((t, p) => t + p.length, 0) + end.length);
  let o = pre.length, cs = 0;
  out.set(pre);
  list.forEach(([i, us], k) => {
    // Ends at the centisecond nearest the grid, measured from where the frames before actually end.
    const g = o + parts[k].length - (frames[i].end - frames[i].start), delay = Math.min(65535, Math.max(2, Math.round(us / 1e4) - cs));
    out.set(parts[k], o);
    out[g + 4] = delay & 255; out[g + 5] = delay >> 8;
    if (patch && i == n - 1) out[g + 3] = (out[g + 3] & ~28) | 8;
    o += parts[k].length; cs += delay;
  });
  out.set(end, o);
  return out;
}

/**
 * The art `svg` (its bytes, one character each) with its first embedded `data:image/gif;base64,`
 * GIF replaced by a PNG of the frame it shows `ms` after it started (gifFrameAt). The page has no
 * GIF decoder: each frame up to that one, from the last that draws regardless of the frames before
 * it (gifStarts), is cut out of the GIF as a one-frame GIF of its own, which the browser decodes,
 * and they are drawn in order on a canvas with the GIF's disposal methods.
 * Null for art without a GIF this can still; it rejects when the browser cannot (no canvas, say).
 * @param {string} svg
 * @param {number} ms
 * @param {Document} doc
 * @returns {Promise<string | null>}
 */
export async function stillSvg(svg, ms, doc) {
  const m = GIF_URI.exec(svg), bytes = m && Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0));
  const gif = bytes && gifFrames(bytes);
  if (!m || !bytes || !gif) return null;
  const k = gifFrameAt(gif.frames, ms, gif.plays), canvas = doc.createElement("canvas"), g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
  canvas.width = gif.width; canvas.height = gif.height;
  /** @type {ImageData | null} */ let saved = null;
  // From the last frame up to it that draws regardless of the frames before (gifStarts).
  for (let i = gifStarts(gif).lastIndexOf(true, k), from = i; i <= k; i++) {
    const before = i > from ? gif.frames[i - 1] : null, f = gif.frames[i], one = new Uint8Array(gif.head.length + f.end - f.start + 1);
    if (before?.disposal == 2) g.clearRect(before.rect[0], before.rect[1], before.rect[2], before.rect[3]);
    else if (before?.disposal == 3 && saved) g.putImageData(saved, 0, 0);
    if (f.disposal == 3) saved = g.getImageData(0, 0, gif.width, gif.height);
    one.set(gif.head); one.set(bytes.subarray(f.start, f.end), gif.head.length); one[one.length - 1] = 59;
    let s = ""; for (const byte of one) s += String.fromCharCode(byte);
    const frame = doc.createElement("img");
    await new Promise((loaded, failed) => { frame.onload = loaded; frame.onerror = failed; frame.src = "data:image/gif;base64," + btoa(s); });
    g.drawImage(frame, 0, 0);
  }
  return svg.replace(m[0], canvas.toDataURL("image/png"));
}
