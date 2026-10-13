// @ts-check
// NFT-owned visual and background-audio helpers.
import { REFERENCE_DISPLAY_LEAD_SECONDS, artTime, restartImgOnPass, syncSvgToMusic } from "./art_sync.js";
export const PLAY_ICON = "M8 5v14l11-7z";
export const PAUSE_ICON = "M6 5h4v14H6zM14 5h4v14h-4z";
/**
 * Where the ▶/❚❚ button goes when the art's root `<svg>` carries `data-play-anchor="X Y"` or
 * `"X Y S"`: a point in the SVG's own units (its `viewBox`, else `width` and `height`), such as the
 * bottom-right corner of a sprite's box, and optionally the button's diameter S in the same units.
 * The button's bottom-right corner is placed at the point, inset by max(S/8, 6) art units (6 px without S: enough to clear a frame's rounded corner), where
 * the <img> draws it: `box` is the <img>'s own rectangle on screen (its `getBoundingClientRect()`),
 * and the art fills it as `object-fit: contain` does, scaled to fit and centred. The diameter is S
 * times the art's scale on screen, between `sizes.min` and `sizes.max` CSS px; without S it is 48.
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
  const num = (/** @type {string} */ s) => (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s) ? +s : NaN);
  const list = (/** @type {string} */ s) => (s ? s.split(/[\s,]+/).map(num) : []);
  const view = list(attr("viewBox"));
  const [x0, y0, w, h] = view.length == 4 ? view : [0, 0, num(attr("width").replace(/px$/i, "")), num(attr("height").replace(/px$/i, ""))];
  const tokens = attr("data-play-anchor").split(/[\s,]+/).filter(Boolean);
  const down = tokens[tokens.length - 1] == "top-right" && !!tokens.pop(); // the point is the button's top-right corner
  const anchor = tokens.map(num);
  const [ax, ay, diameter] = anchor;
  if (!(w > 0 && h > 0 && box.width > 0 && box.height > 0) || !(anchor.length == 2 || (anchor.length == 3 && diameter > 0)) || !(ax >= x0 && ax <= x0 + w && ay >= y0 && ay <= y0 + h)) return null;
  const k = Math.min(box.width / w, box.height / h);
  const size = anchor.length == 3 ? Math.min(sizes.max, Math.max(sizes.min, diameter * k)) : 48;
  const inset = anchor.length == 3 ? k * Math.max(diameter / 8, 6) : 6;
  const place = (/** @type {number} */ a, /** @type {number} */ a0, /** @type {number} */ len, /** @type {number} */ at, /** @type {number} */ span, /** @type {number} */ view, /** @type {boolean} */ below) =>
    Math.round(Math.max(0, Math.min(view - size, at + (span - len * k) / 2 + (a - a0) * k + (below ? inset : -size - inset))));
  return { left: place(ax, x0, w, box.left, box.width, vw, false), top: place(ay, y0, h, box.top, box.height, vh, down), size: Math.round(size) };
}

/** Fallback title of the media session, for art without a <title>. */
export const MEDIA_TITLE = "Onchain music";

/** A silent 6 s WAV (8 kHz, 8-bit mono): long enough for Chrome Android to show media controls (5 s). */
export function silentWav() {
  const b = new Uint8Array(48044).fill(128);
  // RIFF, size 48036, WAVE, "fmt ", 16, PCM, 1 channel, 8000 Hz, 8000 B/s, 1 B/frame, 8 bits, "data", 48000
  b.set([82, 73, 70, 70, 164, 187, 0, 0, 87, 65, 86, 69, 102, 109, 116, 32, 16, 0, 0, 0, 1, 0, 1, 0, 64, 31, 0, 0, 64, 31, 0, 0, 1, 0, 8, 0, 100, 97, 116, 97, 128, 187, 0, 0]);
  return b;
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
    // Only this explicit NFT-owned trust marker enables active inline SVG. Community art stays an image.
    if (document.body.dataset.trustedArt === "inline-svg" && art && svg) {
      const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
      const root = parsed.documentElement;
      if (root.localName === "svg" && root.namespaceURI === "http://www.w3.org/2000/svg") {
        const inline = /** @type {SVGSVGElement} */ (/** @type {unknown} */ (document.importNode(root, true)));
        inline.id = "beast-art";
        // It animates from page load; syncSvgToMusic below seeks it once the music is audible.
        art.replaceWith(inline); art = inline;
      }
    }

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
      const promise = player.play();
      promise.then(() => {
        resuming = false;
        const status = player.getPlayStatus(); setPlaying(status.state === "starting" || status.state === "playing");
      }, e => { resuming = false; if (e.name !== "AbortError") { setPlaying(false); fail(e); } });
      return promise;
    };
    // Art synced to the music (art_sync.js): trusted inline SVG is seeked, an isolated image restarted.
    if (art instanceof SVGSVGElement) {
      syncSvgToMusic(art, player);
      Object.defineProperty(window, "OnchainArtMonitor", { configurable: true, get: monitorArtSync(art, player) });
    } else if (art) {
      // Each restarted <img> replaces the art: the button follows the new one.
      restartImgOnPass(art, player, { onSwap: (img) => { art = img; watch(img); } });
    }
    player.onStateChange(status => {
      if (status.state === "playing" || status.state === "stopped" || status.state === "failed") resuming = false;
      // A resume promise keeps paused status until the clock runs. Do not pause the background
      // element just started in this gesture while waiting for that explicit transport command.
      if (!(resuming && status.state === "paused")) setPlaying(status.state === "starting" || status.state === "playing");
      if (status.error) fail(status.error);
    });
    button.onclick = () => playing ? pause() : start();
    if ((/** @type {any} */ (window)).CompositionFixture) button.dataset.fixture = (/** @type {any} */ (window)).CompositionFixture.label("ready");
    if ((/** @type {any} */ (window)).DependentFixture) button.dataset.dependent = (/** @type {any} */ (window)).DependentFixture;
    button.disabled = false;
}
