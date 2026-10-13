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
 * tick zero, or null.
 * @param {SVGSVGElement} svgRoot
 * @param {OnchainMidiApi} player
 * @param {{displayLead?: number, notes?: {play(): void, pause(): void, stop(): void} | null,
 *   host?: {requestAnimationFrame(f: () => void): number, cancelAnimationFrame(id: number): void}}} [options]
 * @returns {{clock(): number | null, dispose(): void}}
 */
export function syncSvgToMusic(svgRoot, player, { displayLead = REFERENCE_DISPLAY_LEAD_SECONDS, notes = null, host = window } = {}) {
  const timelines = [svgRoot, ...svgRoot.querySelectorAll("svg")];
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
      if (mode !== "running") { animate(true); notes?.play(); }
    } else if (next === "frozen") {
      if (mode !== "frozen") {
        animate(false); seek(s); // Where the audio stopped.
        // Heard, now paused: notes that never played start, so they read the clock, then hold.
        if (mode === "free") notes?.play();
        notes?.pause();
      }
    } else if (mode !== "free") {
      animate(true); // From where it is, without a rewind.
      if (s.state === "failed") notes?.pause(); else notes?.stop();
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
      if (mode !== "free") { animate(true); notes?.stop(); }
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
 * Limits: the restart lands up to one decode late; the image keeps animating while paused; and no
 * page can control GIF frames inside any art (use SMIL sprite animation for motion synced to the music).
 * @param {HTMLImageElement} img the shown art
 * @param {OnchainMidiApi} player
 * @param {{onSwap?: (img: HTMLImageElement) => void}} [options] onSwap: each new image once shown
 *   (re-attach observers of the art, such as the play button's placement)
 * @returns {() => void} dispose
 */
export function restartImgOnPass(img, player, { onSwap = () => {} } = {}) {
  // data:<media type>[;base64],<payload>, split where the browser splits it (the first comma).
  const url = /^data:([^,]*?)(;\x20*base64[\t\n\f\r ]*)?(,[\s\S]*)$/i.exec(img.src);
  if (!url) return () => {};
  const [, type, base64 = "", payload] = url;
  let restarts = 0, shown = 0, live = true;
  const off = player.onPassStart(() => {
    const n = ++restarts, runId = player.getPlayStatus().runId;
    const next = img.ownerDocument.createElement("img");
    for (const { name, value } of img.attributes) if (name !== "src") next.setAttribute(name, value);
    next.onload = () => {
      if (!live || n < shown || player.getPlayStatus().runId !== runId) return;
      shown = n;
      img.replaceWith(next);
      img = next;
      onSwap(next);
    };
    next.src = "data:" + type + ";r=" + n + base64 + payload; // The same bytes at a distinct URL.
  });
  return () => { live = false; off(); };
}
