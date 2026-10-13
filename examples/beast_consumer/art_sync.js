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
 * Inline SVG the page controls (trusted art): seeks the root `<svg>` and every nested `<svg>`. The
 * art animates freely until the music is audible, follows the music until stop, a new run or a
 * failure, then animates freely again from where it is. Optional NFT-owned `notes` are played,
 * paused and stopped with the art and can read `clock()`: audible seconds since tick zero, or null.
 * @param {SVGSVGElement} svgRoot
 * @param {OnchainMidiApi} player
 * @param {{displayLead?: number, notes?: {play(): void, pause(): void, stop(): void} | null,
 *   host?: {requestAnimationFrame(f: () => void): number, cancelAnimationFrame(id: number): void}}} [options]
 * @returns {{clock(): number | null, dispose(): void}}
 */
export function syncSvgToMusic(svgRoot, player, { displayLead = REFERENCE_DISPLAY_LEAD_SECONDS, notes = null, host = window } = {}) {
  const timelines = [svgRoot, ...svgRoot.querySelectorAll("svg")];
  const start = player.getPlayStatus();
  let synced = false, frozen = false, frame = 0, runId = start.runId, revision = start.latencyRevision;
  const seek = () => { const t = artTime(player.getPlayStatus(), displayLead); for (const svg of timelines) svg.setCurrentTime(t); };
  const run = () => { for (const svg of timelines) svg.unpauseAnimations(); frozen = false; notes?.play(); };
  const freeze = () => { for (const svg of timelines) svg.pauseAnimations(); frozen = true; seek(); notes?.pause(); };
  const stopWaiting = () => { host.cancelAnimationFrame(frame); frame = 0; };
  // A pause is announced at once, but the sound plays on until the AudioContext's suspend completes,
  // which nothing announces. Until then the art runs on; the first frame after it, it freezes where
  // the audio stopped (getPlayStatus() holds that position).
  const waitForSilence = () => {
    const s = player.getPlayStatus();
    frame = s.state === "paused" && s.audioState === "running" ? host.requestAnimationFrame(waitForSilence) : 0;
    if (s.state === "paused" && s.audioState !== "running") freeze();
  };
  // Stop, a new run or a failure: animate freely again, without a reset.
  const release = (/** @type {boolean} */ failed) => {
    stopWaiting();
    if (!synced) return;
    synced = frozen = false;
    for (const svg of timelines) svg.unpauseAnimations();
    if (failed) notes?.pause(); else notes?.stop();
  };
  const offPass = player.onPassStart(() => {
    seek();
    if (!synced) { synced = true; run(); } // The music is audible: follow it from here.
  });
  const offState = player.onStateChange((s) => {
    const latencyChanged = s.latencyRevision !== revision;
    revision = s.latencyRevision;
    if (s.runId !== runId || s.state === "stopped" || s.state === "failed") { runId = s.runId; release(s.state === "failed"); return; }
    if (!synced) return; // Before the music is audible, pause and resume leave the art alone.
    if (s.state === "playing" && s.audioState === "running") {
      // Resume, a latency change, or a resume before a pending suspend completed.
      if (frozen || frame || latencyChanged) seek();
      stopWaiting();
      if (frozen) run();
    } else if (s.state === "paused" && s.audioState === "running") {
      // A pending suspend; when frozen already, a resume in progress: wait for "playing".
      if (!frozen && !frame) frame = host.requestAnimationFrame(waitForSilence);
    } else if (!frozen) { stopWaiting(); freeze(); } // Suspended: freeze at the held position.
  });
  return {
    clock: () => { const s = player.getPlayStatus(); return s.positionSeconds === null ? null : Math.max(0, s.positionSeconds + displayLead); },
    dispose() { offPass(); offState(); release(false); },
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
