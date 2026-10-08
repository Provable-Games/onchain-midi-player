// @ts-check
// NFT-owned visual and background-audio helpers.
export const PLAY_ICON = "M8 5v14l11-7z";
export const PAUSE_ICON = "M6 5h4v14H6zM14 5h4v14h-4z";
/**
 * The art as a data URL: the SVG text re-encoded as UTF-8 and base64. `restart` > 0 adds a media
 * type parameter, which gives an equivalent image with a distinct URL, so the browser builds a new
 * image (and animation timeline) rather than reusing the running one.
 * @param {string} svg
 * @param {number} [restart]
 */
export function artUrl(svg, restart = 0) {
  let bin = "";
  for (const b of new TextEncoder().encode(svg)) bin += String.fromCharCode(b);
  return "data:image/svg+xml;" + (restart ? "r=" + restart + ";" : "") + "base64," + btoa(bin);
}

/**
 * Where the ▶/❚❚ button goes when the art's root `<svg>` carries `data-play-anchor="X Y"` or
 * `"X Y S"`: a point in the SVG's own units (its `viewBox`, else `width` and `height`), such as the
 * bottom-right corner of a sprite's box, and optionally the button's diameter S in the same units.
 * The button's bottom-right corner is placed at the point, inset by max(S/8, 6) art units (6 px without S: enough to clear a frame's rounded corner), where
 * the <img> draws it: `box` is the <img>'s own rectangle on screen (its `getBoundingClientRect()`),
 * and the art fills it as `object-fit: contain` does, scaled to fit and centred. The diameter is S
 * times the art's scale on screen, between 44 CSS px (a touch target) and 128; without S it is 48.
 * The button is kept inside the `vw` x `vh` viewport. Returns `null` (the button stays at the
 * viewport's bottom-right corner) when the attribute is absent, malformed or outside the art, or the
 * SVG or the image has no usable size.
 * @param {string} svg
 * @param {{left: number, top: number, width: number, height: number}} box
 * @param {number} vw
 * @param {number} vh
 * @returns {{left: number, top: number, size: number} | null}
 */
export function playAnchor(svg, box, vw, vh) {
  const tag = /<svg\b[^>]*>/i.exec(svg);
  const attr = (/** @type {string} */ name) => {
    const m = tag && new RegExp("\\s" + name + "\\s*=\\s*([\"'])(.*?)\\1", "i").exec(tag[0]);
    return m ? m[2].trim() : "";
  };
  const num = (/** @type {string} */ s) => (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s) ? +s : NaN);
  const list = (/** @type {string} */ s) => (s ? s.split(/[\s,]+/).map(num) : []);
  const view = list(attr("viewBox"));
  const [x0, y0, w, h] = view.length == 4 ? view : [0, 0, num(attr("width").replace(/px$/i, "")), num(attr("height").replace(/px$/i, ""))];
  const anchor = list(attr("data-play-anchor"));
  const [ax, ay, diameter] = anchor;
  if (!(w > 0 && h > 0 && box.width > 0 && box.height > 0) || !(anchor.length == 2 || (anchor.length == 3 && diameter > 0)) || !(ax >= x0 && ax <= x0 + w && ay >= y0 && ay <= y0 + h)) return null;
  const k = Math.min(box.width / w, box.height / h);
  const size = anchor.length == 3 ? Math.min(128, Math.max(44, diameter * k)) : 48;
  const inset = anchor.length == 3 ? k * Math.max(diameter / 8, 6) : 6;
  const place = (/** @type {number} */ a, /** @type {number} */ a0, /** @type {number} */ len, /** @type {number} */ at, /** @type {number} */ span, /** @type {number} */ view) =>
    Math.round(Math.max(0, Math.min(view - size, at + (span - len * k) / 2 + (a - a0) * k - size - inset)));
  return { left: place(ax, x0, w, box.left, box.width, vw), top: place(ay, y0, h, box.top, box.height, vh), size: Math.round(size) };
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


// Provisional NFT reference policy: lab value, pending physical display/audio checks in #52.
export const REFERENCE_DISPLAY_LEAD_SECONDS = 0.017;
/**
 * Control every trusted inline SVG timeline with the player's shared audible clock.
 * Optional NFT-owned notes implement play/pause/stop and use clock() below. No correction loop:
 * seeks happen only on start, resume, pass boundaries and accepted latency changes.
 * @param {SVGSVGElement} root
 * @param {import('../../player/api.d.ts').OnchainMidiApi} player
 * @param {{host?: any, notes?: any, displayLead?: number}} [options]
 */
export function mountArtSync(root, player, { host = window, notes = null, displayLead = REFERENCE_DISPLAY_LEAD_SECONDS } = {}) {
  const timelines = [root, ...root.querySelectorAll('svg')];
  let frame = 0, active = false, revision = -1, started = false;
  let currentDrift = 0, maxDrift = 0;
  /** @type {number | null} */ let initialAlignment = null;
  /** @type {{audioTime: number | null, latencySeconds: number, revision: number}[]} */ const latencyEvents = [];
  const monitor = () => Object.freeze({ currentDrift, maxDrift, initialAlignment,
    latencyEvents: Object.freeze(latencyEvents.map(event => Object.freeze({ ...event }))) });
  const clock = () => {
    const s = player.getPlayStatus();
    return s.positionSeconds === null ? null : Math.max(0, s.positionSeconds + displayLead);
  };
  const phase = () => {
    const s = player.getPlayStatus(), position = clock();
    return position === null ? 0 : s.passSeconds ? position % s.passSeconds : position;
  };
  const pause = () => {
    host.cancelAnimationFrame(frame); frame = 0; active = false;
    for (const svg of timelines) svg.pauseAnimations();
    notes?.pause();
  };
  const seek = () => { const position = phase(); for (const svg of timelines) svg.setCurrentTime(position); };
  const sample = () => {
    const s = player.getPlayStatus(), expected = phase();
    for (const svg of timelines) {
      let drift = svg.getCurrentTime() - expected;
      if (s.passSeconds) drift -= Math.round(drift / s.passSeconds) * s.passSeconds;
      if (svg === root) currentDrift = drift;
      maxDrift = Math.max(maxDrift, Math.abs(drift));
    }
  };
  const tick = () => {
    frame = 0;
    const s = player.getPlayStatus();
    if (s.state !== 'playing' || s.audioState !== 'running') { pause(); return; }
    if (!started) {
      // On play: freeze at zero until tick zero reaches its estimated audible start.
      const ready = s.originTime !== null && s.audioTime !== null && s.audioTime >= s.originTime + s.latencySeconds;
      if (ready) {
        seek(); for (const svg of timelines) svg.unpauseAnimations(); notes?.play();
        started = true; sample(); initialAlignment ??= currentDrift;
      }
    } else sample(); // Read-only drift observation; never seeks or changes compensation here.
    frame = host.requestAnimationFrame(tick);
  };
  const synchronize = () => {
    const s = player.getPlayStatus();
    if (revision !== s.latencyRevision) {
      if (revision >= 0) latencyEvents.push({ audioTime: s.audioTime, latencySeconds: s.latencySeconds, revision: s.latencyRevision });
      revision = s.latencyRevision;
      if (started && s.state === 'playing' && s.audioState === 'running') seek();
    }
    if (s.state !== 'playing' || s.audioState !== 'running') {
      pause();
      if (s.state === 'stopped') { started = false; for (const svg of timelines) svg.setCurrentTime(0); notes?.stop(); }
      return;
    }
    if (!active) {
      active = true;
      if (started) { seek(); for (const svg of timelines) svg.unpauseAnimations(); notes?.play(); }
      frame = host.requestAnimationFrame(tick);
    }
  };
  for (const svg of timelines) { svg.pauseAnimations(); svg.setCurrentTime(0); }
  const offState = player.onStateChange(synchronize);
  const offPass = player.onPassStart(() => { if (started && active) seek(); });
  synchronize();
  return Object.freeze({ clock, getMonitor: monitor, dispose() { pause(); offState(); offPass(); } });
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
        for (const timeline of [inline, ...inline.querySelectorAll("svg")]) { timeline.pauseAnimations(); timeline.setCurrentTime(0); }
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
    const place = () => attempt(() => {
      const r = art && art.getBoundingClientRect();
      const a = r && playAnchor(svg, r, window.innerWidth, window.innerHeight);
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
    if (art instanceof SVGSVGElement) {
      const sync = mountArtSync(art, player);
      // NFT-owned, read-only instrumentation for lab/browser acceptance.
      Object.defineProperty(window, "OnchainArtMonitor", { configurable: true, get: sync.getMonitor });
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
