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
 *
 * The returned dispose function also carries `pause`, `play` and `stop` (syncSvgToMusic's `img`).
 * `pause` freezes the art: no page can stop a GIF inside an image, or read the frame it shows
 * (canvas `drawImage` gets the first frame), so the page works out that frame from the time since
 * the shown image started and its GIF's own delays, and shows the art with that GIF replaced by a
 * PNG of the frame (`stillSvg`), decoded off screen like a restart. Restarts wait while frozen.
 * `play` and `stop` restart the art from its first frame, if the still was shown; the next pass
 * realigns it. Art without a GIF it can still keeps moving, and so does any other animation in
 * the art (SVG/SMIL). On a hidden page the still is made once the page is visible again.
 * Limits: a restart lands up to one decode late, a freeze also, and no page can control GIF
 * frames inside any art (use SMIL sprite animation for motion synced to the music).
 * @param {HTMLImageElement} img the shown art
 * @param {OnchainMidiApi} player
 * @param {{onSwap?: (img: HTMLImageElement) => void,
 *   still?: (svg: string, ms: number, doc: Document) => Promise<string | null>}} [options] onSwap:
 *   each new image once shown (re-attach observers of the art, such as the play button's
 *   placement); still: the art's text frozen `ms` after its image started (stillSvg)
 * @returns {(() => void) & {play(): void, pause(): void, stop(): void}} dispose, with the freeze controls
 */
export function restartImgOnPass(img, player, { onSwap = () => {}, still = stillSvg } = {}) {
  // data:<media type>[;base64],<payload>, split where the browser splits it (the first comma).
  const url = /^data:([^,]*?)(;\x20*base64[\t\n\f\r ]*)?(,[\s\S]*)$/i.exec(img.src);
  const none = () => {};
  if (!url) return Object.assign(none, { play: none, pause: none, stop: none });
  const [, type, base64 = "", payload] = url, doc = img.ownerDocument;
  let restarts = 0, shown = 0, live = true, frozen = false, held = false, shownAt = performance.now();
  /** Decodes `src(n)` off screen and shows it, unless disposed, a newer image is shown or `wanted()` fails. */
  const show = (/** @type {(n: number) => string} */ src, /** @type {() => boolean} */ wanted, still = false) => {
    const n = ++restarts, next = doc.createElement("img");
    for (const { name, value } of img.attributes) if (name !== "src") next.setAttribute(name, value);
    next.onload = () => {
      if (!live || n < shown || !wanted()) return;
      shown = n; held = still; shownAt = performance.now();
      img.replaceWith(next);
      img = next;
      onSwap(next);
    };
    next.src = src(n); // The same bytes at a distinct URL.
  };
  const restart = () => {
    const runId = player.getPlayStatus().runId;
    show((n) => "data:" + type + ";r=" + n + base64 + payload, () => !frozen && player.getPlayStatus().runId === runId);
  };
  const off = player.onPassStart(() => frozen || restart());
  /** The still of the art `ms` after it started, as a base64 URL of the same media type. */
  const hold = (/** @type {number} */ ms) => {
    if (doc.hidden) return doc.addEventListener("visibilitychange", function wait() {
      if (!doc.hidden) { doc.removeEventListener("visibilitychange", wait); if (frozen) hold(ms); }
    });
    Promise.resolve().then(() => {
      // The payload as bytes (one character each), so art in any encoding keeps its other bytes.
      const text = base64 ? atob(payload.slice(1).replace(/[\t\n\f\r ]/g, "")) : unescape(payload.slice(1));
      return still(text, ms, doc);
    }).then((svg) => { if (svg && frozen) show((n) => "data:" + type + ";r=" + n + ";base64," + btoa(svg), () => frozen, true); }, none);
  };
  const thaw = () => {
    if (!frozen) return;
    frozen = false;
    if (held) restart(); // From its first frame; a still never shown leaves the art running.
  };
  return Object.assign(() => { live = false; off(); }, {
    pause() { if (live && !frozen) { frozen = true; hold(performance.now() - shownAt); } },
    play: thaw,
    stop: thaw,
  });
}

/**
 * The frames of a GIF from its block structure, without decoding pixels: `head`, the bytes every
 * frame shares (signature, screen descriptor and global color table), and each frame's bytes
 * (`start` to `end`: its Graphic Control Extension, descriptor, color table and data), `delay` in
 * ms as browsers show it (0 or 1 cs as 100 ms), `disposal` and `rect` (x, y, width, height). Null
 * when the bytes are not a GIF this walk follows.
 * @param {Uint8Array} b
 * @returns {{head: Uint8Array, width: number, height: number,
 *   frames: {start: number, end: number, delay: number, disposal: number, rect: number[]}[]} | null}
 */
export function gifFrames(b) {
  if (b.length < 13 || String.fromCharCode(...b.subarray(0, 4)) != "GIF8") return null;
  let p = 13 + (b[10] & 128 ? 3 << ((b[10] & 7) + 1) : 0), gce = -1;
  const head = b.subarray(0, p), frames = [], skip = () => { while (p < b.length && b[p]) p += b[p] + 1; p++; };
  while (p < b.length && b[p] != 59) {
    const at = p++;
    if (b[at] == 33) { if (b[p] == 249) gce = at; p++; skip(); }
    else if (b[at] == 44) {
      const flags = b[p + 8], cs = gce < 0 ? 0 : b[gce + 4] | (b[gce + 5] << 8);
      const rect = [0, 2, 4, 6].map((i) => b[p + i] | (b[p + i + 1] << 8));
      p += 10 + (flags & 128 ? 3 << ((flags & 7) + 1) : 0);
      skip();
      frames.push({ start: gce < 0 ? at : gce, end: p, delay: cs > 1 ? cs * 10 : 100, disposal: gce < 0 ? 0 : (b[gce + 3] >> 2) & 7, rect });
      gce = -1;
    } else return null;
  }
  return p < b.length && frames.length ? { head, width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8), frames } : null;
}

/**
 * The frame a looping GIF shows `ms` after it started.
 * @param {{delay: number}[]} frames
 * @param {number} ms
 */
export function gifFrameAt(frames, ms) {
  let t = Math.max(0, ms) % frames.reduce((sum, f) => sum + f.delay, 0), k = 0;
  while (t >= frames[k].delay) t -= frames[k++].delay;
  return k;
}

/**
 * The art `svg` (its bytes, one character each) with its first embedded `data:image/gif;base64,`
 * GIF replaced by a PNG of the frame it shows `ms` after it started (gifFrameAt). The page has no
 * GIF decoder: each frame up to that one is cut out of the GIF as a one-frame GIF of its own, which
 * the browser decodes, and they are drawn in order on a canvas with the GIF's disposal methods.
 * Null for art without a GIF this can still; it rejects when the browser cannot (no canvas, say).
 * @param {string} svg
 * @param {number} ms
 * @param {Document} doc
 * @returns {Promise<string | null>}
 */
export async function stillSvg(svg, ms, doc) {
  const m = /data:image\/gif;base64,([A-Za-z0-9+/]+=*)/.exec(svg), bytes = m && Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0));
  const gif = bytes && gifFrames(bytes);
  if (!m || !bytes || !gif) return null;
  const k = gifFrameAt(gif.frames, ms), canvas = doc.createElement("canvas"), g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
  canvas.width = gif.width; canvas.height = gif.height;
  /** @type {ImageData | null} */ let saved = null;
  for (let i = 0; i <= k; i++) {
    const before = gif.frames[i - 1], f = gif.frames[i], one = new Uint8Array(gif.head.length + f.end - f.start + 1);
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
