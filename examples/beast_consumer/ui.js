// @ts-check
// NFT-owned visual and background-audio helpers.
import { REFERENCE_DISPLAY_LEAD_SECONDS, artTime, laterImg, restartImgOnPass, syncSvgToMusic } from "./art_sync.js";
export const PLAY_ICON = "M8 5v14l11-7z";
export const PAUSE_ICON = "M6 5h4v14H6zM14 5h4v14h-4z";
const SVG_NS = "http://www.w3.org/2000/svg";
/** A plain decimal number (sign, digits, one point; no exponent, hex, units or blank), else NaN. */
const decimal = (/** @type {string} */ s) => (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s) ? +s : NaN);
/**
 * Where the ▶/❚❚ button goes when the art's root `<svg>` carries `data-play-anchor="X Y"` or
 * `"X Y S"`: a point in the SVG's own units (its `viewBox`, else `width` and `height`), such as the
 * bottom-right corner of a sprite's box, and optionally the button's diameter S in the same units.
 * The button's bottom-right corner is placed at the point, inset by max(S/8, 6) art units (6 px without S: enough to clear a frame's rounded corner), where
 * the <img> draws it: `box` is the <img>'s own rectangle on screen (its `getBoundingClientRect()`),
 * and the art fills it as `object-fit: contain` does, scaled to fit and centred. The diameter is S
 * times the art's scale on screen, between `sizes.min` and `sizes.max` CSS px; without S it is the
 * 48 px default between the same limits, as the stylesheet's corner button (no anchor) is.
 * The sizes are the page's settings, read from its stylesheet (`--play-min`, `--play-max`; see startUi),
 * and so is the touch target (`--play-target`), drawn by the stylesheet around a smaller button.
 * With a last word `top-right` (`"X Y S top-right"`), the point is the button's top-right corner
 * instead, inset the same way, and the button grows down and left from it (the top-right corner of
 * an art frame, say).
 * The button is kept inside the `vw` x `vh` viewport. Returns `null` (the button stays at the
 * viewport's bottom-right corner) when the attribute is absent, malformed or outside the art, or the
 * SVG or the image has no usable size.
 * @param {string} svg
 * @param {{left: number, top: number, width: number, height: number}} box
 * @param {number} vw
 * @param {number} vh
 * @param {{min: number, max: number}} sizes the diameter's limits in CSS px
 * @returns {{left: number, top: number, size: number} | null}
 */
export function playAnchor(svg, box, vw, vh, sizes) {
  const tag = /<svg\b[^>]*>/i.exec(svg);
  const attr = (/** @type {string} */ name) => {
    const m = tag && new RegExp("\\s" + name + "\\s*=\\s*([\"'])(.*?)\\1", "i").exec(tag[0]);
    return m ? m[2].trim() : "";
  };
  const list = (/** @type {string} */ s) => (s ? s.split(/[\s,]+/).map(decimal) : []);
  const view = list(attr("viewBox"));
  const [x0, y0, w, h] = view.length == 4 ? view : [0, 0, decimal(attr("width").replace(/px$/i, "")), decimal(attr("height").replace(/px$/i, ""))];
  const tokens = attr("data-play-anchor").split(/[\s,]+/).filter(Boolean);
  const down = tokens[tokens.length - 1] == "top-right" && !!tokens.pop(); // the point is the button's top-right corner
  const anchor = tokens.map(decimal);
  const [ax, ay, diameter] = anchor;
  if (!(w > 0 && h > 0 && box.width > 0 && box.height > 0) || !(anchor.length == 2 || (anchor.length == 3 && diameter > 0)) || !(ax >= x0 && ax <= x0 + w && ay >= y0 && ay <= y0 + h)) return null;
  const k = Math.min(box.width / w, box.height / h);
  const size = Math.min(sizes.max, Math.max(sizes.min, anchor.length == 3 ? diameter * k : 48));
  const inset = anchor.length == 3 ? k * Math.max(diameter / 8, 6) : 6;
  const place = (/** @type {number} */ a, /** @type {number} */ a0, /** @type {number} */ len, /** @type {number} */ at, /** @type {number} */ span, /** @type {number} */ view, /** @type {boolean} */ below) =>
    Math.round(Math.max(0, Math.min(view - size, at + (span - len * k) / 2 + (a - a0) * k + (below ? inset : -size - inset))));
  return { left: place(ax, x0, w, box.left, box.width, vw, false), top: place(ay, y0, h, box.top, box.height, vh, down), size: Math.round(size) };
}

/**
 * Where optional notes go (startNotes), read from the art itself so that a change of layout cannot
 * leave them behind: `view`, the root `<svg>`'s `viewBox`, and `box`, the `x`, `y`, `width` and
 * `height` of the root's first child marked `data-notes-bg` (the element `cutout` masks, in
 * player/notes.js), in those units. That child must be a `<rect>`; a missing `x` or `y` is 0. Null
 * when the root is not an SVG `<svg>`, without such a child (a marked element deeper in the art does
 * not count, as for `cutout`), without a four-number viewBox, or with a number that is not plain
 * (playAnchor's parser: no blank, hex, exponent or units) or a size that is not positive. A
 * transform on the marked element is not applied.
 * @param {string} svg
 * @returns {{view: number[], box: number[]} | null}
 */
export function notesFrame(svg) {
  const root = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
  if (root.localName != "svg" || root.namespaceURI != SVG_NS) return null;
  let node = root.firstChild;
  while (node && !(node.nodeType == 1 && /** @type {Element} */ (node).hasAttribute("data-notes-bg"))) node = node.nextSibling;
  const el = /** @type {Element | null} */ (node);
  if (!el || el.localName != "rect" || el.namespaceURI != SVG_NS) return null;
  const view = (root.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(decimal);
  const box = ["x", "y", "width", "height"].map((a, i) => (i < 2 && !el.hasAttribute(a) ? 0 : decimal((el.getAttribute(a) || "").trim())));
  const ok = (/** @type {number[]} */ r) => r.length == 4 && r.every(Number.isFinite) && r[2] > 0 && r[3] > 0;
  return ok(view) && ok(box) ? { view, box } : null;
}

/**
 * Optional notes behind the art: the token's MIDI as a piano roll scrolling with the music
 * (player/notes.js, whose `mount` and `cutout` the page's notes fragment exposes as `notes`). For
 * art with a notes frame (notesFrame), it mounts the notes standing still on `canvas`, just before
 * the art element `img()` returns and over the frame, and returns `svg`, the page's copy of the
 * art to show instead (`cutout`: the frame's background and what is painted before it are cut
 * out, so the notes show through under the rest), with the notes' `play`, `pause` and `stop` for
 * syncSvgToMusic, each failing silently, and `remove`, which takes the notes away for good (when
 * that copy cannot be shown). The metadata's `image` is never touched. Null, with nothing changed
 * (no canvas, the art as it is), without the module or a notes frame, or when `cutout` or `mount`
 * throws (a MIDI the notes cannot read, say): the page then plays as it does without notes.
 * @param {{mount: typeof import("../../player/notes.js").mount, cutout(svg: string): string} | null | undefined} notes
 * @param {string} svg the art
 * @param {HTMLCanvasElement} canvas a new canvas
 * @param {{midi: string, clock(): number | null, img(): Element | null}} options `midi`: the page's
 *   MIDI (base64); `clock`: syncSvgToMusic's `clock()`; `img`: the art element now
 * @returns {{svg: string, play(): void, pause(): void, stop(): void, remove(): void} | null}
 */
export function startNotes(notes, svg, canvas, { midi, clock, img }) {
  try {
    const frame = notes && notesFrame(svg);
    if (!notes || !frame) return null;
    const cut = notes.cutout(svg);
    const ui = notes.mount(canvas, { midi, clock, img: /** @type {() => HTMLImageElement | null} */ (img), ...frame });
    const quiet = (/** @type {() => void} */ f) => () => { try { f(); } catch (e) {} };
    return { svg: cut, play: quiet(() => ui.play()), pause: quiet(() => ui.pause()), stop: quiet(() => ui.stop()), remove: quiet(() => ui.remove()) };
  } catch (e) {
    canvas.remove(); // mount may have placed it before failing
    return null;
  }
}

/**
 * Shows `url` in the <img> `img` only once it decodes: an off-screen copy loads it first, so art
 * that fails to decode never leaves the image blank. On error `img` keeps its own URL and `onError`
 * runs. Resolves once settled, either way. (The footer shows the page's cut-out copy of the art this
 * way, and removes the notes, which the uncut art would hide, if it cannot.)
 * @param {HTMLImageElement} img
 * @param {string} url
 * @param {() => void} onError
 * @returns {Promise<void>}
 */
export function showWhenDecoded(img, url, onError) {
  return new Promise((settled) => {
    const copy = img.ownerDocument.createElement("img");
    copy.onload = () => { img.src = url; settled(); };
    copy.onerror = () => { onError(); settled(); };
    copy.src = url;
  });
}

/** Fallback title of the media session, for art without a <title>. */
export const MEDIA_TITLE = "Onchain music";

/**
 * A silent 6 s WAV (8 kHz, 8-bit mono): long enough for Chrome Android to show media controls (5 s).
 * Its length is not the track's: the page publishes the musical pass as the media session's
 * position (positionState), which the notification shows instead.
 */
export function silentWav() {
  const b = new Uint8Array(48044).fill(128);
  // RIFF, size 48036, WAVE, "fmt ", 16, PCM, 1 channel, 8000 Hz, 8000 B/s, 1 B/frame, 8 bits, "data", 48000
  b.set([82, 73, 70, 70, 164, 187, 0, 0, 87, 65, 86, 69, 102, 109, 116, 32, 16, 0, 0, 0, 1, 0, 1, 0, 64, 31, 0, 0, 64, 31, 0, 0, 1, 0, 8, 0, 100, 97, 116, 97, 128, 187, 0, 0]);
  return b;
}

/** Within this much of a pass's end, a position counts as the next pass's start (positionState). */
export const MEDIA_END_GUARD_SECONDS = 0.05;

/**
 * The media session's position state (`navigator.mediaSession.setPositionState`): one pass of the
 * music as the track, so the notification shows the pass's length, not the silent element's 6 s.
 * The position is the music's audible position wrapped to the pass, with no display lead (that is
 * the art's). A pass event can come up to ~20 ms before its pass is heard, which puts the position
 * just before the end; the browser would hold it there for a whole pass, so a position within
 * MEDIA_END_GUARD_SECONDS of the end is 0. The rate stays 1 while paused (0 throws): the session's
 * `playbackState` holds the bar. Null without a pass length or a position.
 * @param {import("../../player/api.d.ts").PlayStatus} s
 * @returns {{duration: number, playbackRate: number, position: number} | null}
 */
export function positionState(s) {
  if (!s.passSeconds || s.positionSeconds === null) return null;
  const position = s.positionSeconds % s.passSeconds;
  return { duration: s.passSeconds, playbackRate: 1, position: s.passSeconds - position < MEDIA_END_GUARD_SECONDS ? 0 : position };
}


/**
 * NFT-owned, read-only lab instrumentation (`window.OnchainArtMonitor`, read by the browser checks),
 * kept apart from the sync itself. After a run's first pass event (subscribe after
 * syncSvgToMusic, which seeks there), it samples every frame, while the music plays, how far each
 * SVG timeline is from artTime(): the drift now and the largest so far, and the drift right after
 * that first seek. It also records each latency update. It never seeks: there is no drift correction.
 * @param {SVGSVGElement} root
 * @param {import('../../player/api.d.ts').OnchainMidiApi} player
 * @param {{host?: {requestAnimationFrame(f: () => void): number, cancelAnimationFrame(id: number): void}, displayLead?: number}} [options]
 */
export function monitorArtSync(root, player, { host = window, displayLead = REFERENCE_DISPLAY_LEAD_SECONDS } = {}) {
  const timelines = [root, ...root.querySelectorAll("svg")];
  let currentDrift = 0, maxDrift = 0, frame = 0, syncedRun = -1, revision = player.getPlayStatus().latencyRevision;
  /** @type {number | null} */ let initialAlignment = null;
  /** @type {{audioTime: number | null, latencySeconds: number, revision: number}[]} */ const latencyEvents = [];
  const sample = () => {
    frame = 0;
    const s = player.getPlayStatus();
    if (s.runId !== syncedRun || s.state !== "playing" || s.audioState !== "running") return;
    const expected = artTime(s, displayLead);
    for (const svg of timelines) {
      let drift = svg.getCurrentTime() - expected;
      if (s.passSeconds) drift -= Math.round(drift / s.passSeconds) * s.passSeconds;
      if (svg === root) currentDrift = drift;
      maxDrift = Math.max(maxDrift, Math.abs(drift));
    }
    frame = host.requestAnimationFrame(sample);
  };
  player.onPassStart((event) => {
    if (event.runId === syncedRun) return;
    syncedRun = event.runId; host.cancelAnimationFrame(frame); sample(); initialAlignment ??= currentDrift;
  });
  player.onStateChange((s) => {
    if (s.latencyRevision !== revision) latencyEvents.push({ audioTime: s.audioTime, latencySeconds: s.latencySeconds, revision: s.latencyRevision });
    revision = s.latencyRevision;
    if (!frame) sample();
  });
  return () => Object.freeze({ currentDrift, maxDrift, initialAlignment,
    latencyEvents: Object.freeze(latencyEvents.map((event) => Object.freeze({ ...event }))) });
}

/** NFT bootstrap. Only the player API owns sound/timing; all media and visual policy is here. */
export async function startUi() {
    const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
    const button = /** @type {HTMLButtonElement} */ ($("play"));
    const icon = $("icon");
    const message = $("error");
    /** @param {unknown} e */
    const fail = (e) => {
      const text = String((e && /** @type {Error} */ (e).message) || e);
      button.disabled = true;
      button.title = message.textContent = text;
      message.hidden = false;

    };

    let art = /** @type {HTMLImageElement | SVGSVGElement | null} */ (document.getElementById("beast-art"));
    let svg = "";
    try { svg = new TextDecoder().decode(Uint8Array.from(atob(/** @type {HTMLImageElement} */ (art).src.split(",")[1]), c => c.charCodeAt(0))); } catch (_) {}
    try { document.title = new DOMParser().parseFromString(svg, "image/svg+xml").getElementsByTagName("title")[0]?.textContent || MEDIA_TITLE; } catch (_) {}
    // Optional notes behind the art (startNotes), when the page has the notes fragment and the art
    // a notes frame: standing still from now, following the music with the art below.
    /** @type {ReturnType<typeof syncSvgToMusic> | null} */
    let sync = null;
    const lib = /** @type {any} */ (window).OnchainMidiNotes;
    let notes = lib && art ? startNotes(lib, svg, document.createElement("canvas"), {
      midi: document.getElementById("onchain-midi-data")?.textContent || "",
      clock: () => (sync ? sync.clock() : null),
      img: () => art,
    }) : null;
    // Only this explicit NFT-owned trust marker enables active inline SVG. Community art stays an image.
    if (document.body.dataset.trustedArt === "inline-svg" && art && svg) {
      // The cut-out copy is serializer output; should it not parse to an <svg>, the art stays an
      // <img> and goes through the decode-checked swap below.
      const parsed = new DOMParser().parseFromString(notes ? notes.svg : svg, "image/svg+xml");
      const root = parsed.documentElement;
      if (root.localName === "svg" && root.namespaceURI === "http://www.w3.org/2000/svg") {
        const inline = /** @type {SVGSVGElement} */ (/** @type {unknown} */ (document.importNode(root, true)));
        inline.id = "beast-art";
        // It animates from page load; syncSvgToMusic below seeks it once the music is audible.
        art.replaceWith(inline); art = inline;
      }
    }
    // An <img> shows the page's copy with the notes frame cut out once that decodes; if it cannot, the
    // art stays as it is and the notes go. Restarts (below) begin once this has settled.
    const shown = notes && art instanceof HTMLImageElement
      ? showWhenDecoded(art, "data:image/svg+xml," + encodeURIComponent(notes.svg), () => { notes?.remove(); notes = null; })
      : null;

    /** @param {() => unknown} f best effort: a failure is silent */
    const attempt = (f) => {
      try {
        f();
      } catch (e) {}
    };
    // The button sits at the art's `data-play-anchor` if it has one (see playAnchor), else at the
    // viewport's bottom-right corner (the stylesheet's). It follows the <img>'s actual box.
    // The button's size limits are stylesheet settings (--play-min/--play-max), so a page restyles
    // the button without touching this code; the fallbacks keep a page without them touch-safe.
    const setting = (/** @type {string} */ name, /** @type {number} */ fallback) => {
      const v = parseFloat(getComputedStyle(button).getPropertyValue(name));
      return v > 0 ? v : fallback;
    };
    const place = () => attempt(() => {
      const r = art && art.getBoundingClientRect();
      const a = r && playAnchor(svg, r, window.innerWidth, window.innerHeight, { min: setting("--play-min", 44), max: setting("--play-max", 128) });
      const s = button.style;
      s.right = s.bottom = a ? "auto" : "";
      s.left = a ? a.left + "px" : "";
      s.top = a ? a.top + "px" : "";
      s.width = s.height = a ? a.size + "px" : "";
      s.padding = a ? a.size / 4 + "px" : "";
    });
    /** @type {ResizeObserver | undefined} */
    let observer;
    /** @param {HTMLImageElement | SVGSVGElement | null} img the current art image */
    const watch = (img) => attempt(() => {
      observer = observer || new ResizeObserver(place);
      observer.disconnect();
      if (img) observer.observe(img);
    });
    place();
    watch(art);
    attempt(() => window.addEventListener("resize", place));

    let playing = false, resuming = false;
    try { await window.OnchainLibraries.ready; if (!window.OnchainMidiPlayer) throw new Error("player: library did not load"); await window.OnchainMidiPlayer.ready; }
    catch (e) { fail(e); return; }
    const player = window.OnchainMidiPlayer;
    /** @type {HTMLAudioElement | null} the silent element of the media session */
    let silent = null;
    let background = false; // the silent element is playing: the page may keep playing when hidden
    let armed = false; // the media session's metadata and handlers are set
    /** @param {boolean} on */
    const setPlaying = (on) => {
      playing = on;
      icon.setAttribute("d", on ? PAUSE_ICON : PLAY_ICON);
      button.setAttribute("aria-label", on ? "Pause" : "Play");
      if (!on) attempt(() => silent && silent.pause());
      attempt(() => (navigator.mediaSession.playbackState = on ? "playing" : "paused"));
    };
    const pause = () => { resuming = false; const promise = player.pause(); setPlaying(false); promise.catch(fail); return promise; };
    // The pass as the media session's position (positionState), at each pass and state change; the
    // browser advances it in between. `fromZero`: before a run has a position, the pass from 0.
    const publish = (fromZero = false) => attempt(() => {
      const s = player.getPlayStatus();
      const p = positionState(fromZero && s.positionSeconds === null ? { ...s, positionSeconds: 0 } : s);
      if (p) navigator.mediaSession.setPositionState(p);
    });
    /** The media session, once: the title and art, and the handlers that resume or pause. Media stop also pauses, preserving #60's policy. */
    const arm = () => {
      armed = true;
      /** @param {Array<{src: string, sizes: string, type: string}>} artwork */
      const meta = (artwork) => attempt(() => (navigator.mediaSession.metadata = new MediaMetadata({ title, artwork })));
      let title = MEDIA_TITLE;
      attempt(() => (title = new DOMParser().parseFromString(svg, "image/svg+xml").getElementsByTagName("title")[0].textContent || title));
      meta([]);
      for (const action of /** @type {const} */ (["play", "pause", "stop"])) {
        attempt(() => navigator.mediaSession.setActionHandler(action, action == "play" ? () => playing || button.disabled || start() : () => playing && pause()));
      }
      // Artwork: the art's own bitmap (the first embedded PNG, GIF or WebP: a Beast's 32x32 sprite),
      // as a static frame row on a dark card colour, at the sizes Chrome Android asks for (512, and
      // 256 on low-end devices): the frames of a sprite sheet (square, side by side; a GIF or a
      // plain image gives its one frame) in one row, centred, nearest-neighbour at a whole scale
      // (5x for one 32 px frame: 160 px of 512). Android 13+ shows the artwork centre-cropped to a
      // wide panel, so the row stays in the middle band; iOS shows the square as it is. The card SVG
      // itself is not drawn: its foreignObject can taint the canvas. Art without a bitmap gets no
      // artwork. The image is static: updating the metadata to animate it would flicker and cost power.
      const raster = /data:image\/(?:png|gif|webp);base64,[A-Za-z0-9+/=]+/.exec(svg);
      if (raster) {
        attempt(() => {
          const img = document.createElement("img");
          img.onload = () => attempt(() => {
            const h = img.naturalHeight;
            const count = img.naturalWidth % h ? 1 : img.naturalWidth / h;
            const w = img.naturalWidth / count;
            const canvas = document.createElement("canvas");
            meta([512, 256].map((n) => {
              canvas.width = canvas.height = n;
              const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
              g.fillStyle = "#1e1e22";
              g.fillRect(0, 0, n, n);
              g.imageSmoothingEnabled = false;
              const fit = Math.min((n * 5 * 32) / 512 / h, n / (w * count));
              const k = fit < 1 ? fit : Math.floor(fit);
              for (let i = 0; i < count; i++) {
                g.drawImage(img, i * w, 0, w, h, Math.floor((n - w * k * count) / 2) + i * w * k, Math.floor((n - h * k) / 2), w * k, h * k);
              }
              return { src: canvas.toDataURL("image/png"), sizes: n + "x" + n, type: "image/png" };
            }));
          });
          img.src = raster[0];
        });
      }
    };
    /** The iOS audio session and the silent element, inside the gesture, before the AudioContext resumes. */
    const session = () => {
      attempt(() => (/** @type {any} */ (navigator).audioSession.type = "playback"));
      background = false;
      attempt(() => {
        if (!silent) {
          silent = new Audio(URL.createObjectURL(new Blob([silentWav()], { type: "audio/wav" })));
          silent.loop = true;
          // Paused from outside (the notification, a headset, a call): the same transport pause. It is paused
          // here only if ▶ has not started it again since.
          silent.onpause = () => playing && silent && silent.paused && pause();
        }
        silent.play().then(() => (background = true), () => {});
      });
      if (!armed) attempt(arm);
    };
    // Without a playing background element, a hidden page pauses.
    document.addEventListener("visibilitychange", () => document.hidden && playing && !background && pause());
    const start = () => {
      resuming = true; setPlaying(true);
      session();
      // A new run shows the pass from 0 at once, rather than the silent element's 6 s: its bar runs up
      // to a few hundred ms early (start-up, tick 0 sounding 0.1 s after the engine starts, and the
      // output latency) until the initial pass resets it. A resume shows the held position.
      publish(true);
      const promise = player.play();
      promise.then(() => {
        resuming = false;
        const status = player.getPlayStatus(); setPlaying(status.state === "starting" || status.state === "playing");
      }, e => { resuming = false; if (e.name !== "AbortError") { setPlaying(false); fail(e); } });
      return promise;
    };
    // Art synced to the music (art_sync.js): trusted inline SVG is seeked, an isolated image restarted.
    if (art instanceof SVGSVGElement) {
      sync = syncSvgToMusic(art, player, { notes });
      Object.defineProperty(window, "OnchainArtMonitor", { configurable: true, get: monitorArtSync(art, player) });
    } else if (art) {
      // The notes follow the music without art to seek, and the image freezes where the audio
      // stops: restartImgOnPass's controls, once they exist, get the transport's last call too.
      const image = laterImg();
      sync = syncSvgToMusic(null, player, { notes, img: image });
      // Each restarted <img> replaces the art: the button and the notes follow the new one. A restart
      // copies the URL the art shows, so restarts begin once the cut-out copy is showing, or failed.
      // Who prefers reduced motion (read once, when the art is set up) gets the art standing still,
      // as the notes do: a still of its first frame from the start, which play and stop leave as it
      // is. Art that cannot be stilled moves and restarts at passes as usual.
      const restart = () => {
        if (!art) return;
        const controls = restartImgOnPass(/** @type {HTMLImageElement} */ (art), player, { onSwap: (img) => { art = img; watch(img); } });
        if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) controls.pause(); else image.attach(controls);
      };
      if (shown) shown.then(restart); else restart();
    }
    player.onStateChange(status => {
      if (status.state === "playing" || status.state === "stopped" || status.state === "failed") resuming = false;
      // A resume promise keeps paused status until the clock runs. Do not pause the background
      // element just started in this gesture while waiting for that explicit transport command.
      if (!(resuming && status.state === "paused")) setPlaying(status.state === "starting" || status.state === "playing");
      if (status.error) fail(status.error);
      publish();
    });
    player.onPassStart(() => publish());
    button.onclick = () => playing ? pause() : start();
    if ((/** @type {any} */ (window)).CompositionFixture) button.dataset.fixture = (/** @type {any} */ (window)).CompositionFixture.label("ready");
    if ((/** @type {any} */ (window)).DependentFixture) button.dataset.dependent = (/** @type {any} */ (window)).DependentFixture;
    button.disabled = false;
}
