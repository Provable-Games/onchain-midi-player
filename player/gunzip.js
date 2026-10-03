// @ts-check
/**
 * The page's gunzip shim. PAGE carries the TinySynth engine gzipped, as
 * `<script type="text/javascript+gzip" src="data:text/javascript;base64,...">` (the Art Blocks and
 * scripty.sol convention). The browser neither runs nor fetches a script of an unknown type, so
 * this shim, the next `<script>` in PAGE, inflates each such tag and replaces it with an inline
 * `<script>` holding the decompressed source. A script element without `src` that a script inserts
 * runs synchronously on insertion, so the engine has run before the shim returns, and so before the
 * player's `<script>` (after it in the document) is parsed. On any failure (bad base64, bad gzip
 * data, a CRC-32 or length mismatch) it logs the error and leaves the tag in place; the player
 * then finds no engine, shows the error and keeps ▶ disabled (spec D9).
 *
 * Plain browser JavaScript: no eval or Function (the source is inserted as a script element's
 * text, which a CSP allowing inline scripts permits), no network requests, deterministic.
 *
 * Provenance: `gunzip` and everything it calls are derived from fflate 0.8.3
 * (https://github.com/101arrowz/fflate, `esm/browser.js`: `gunzipSync`, `gzs`, `gzl`, `inflt`,
 * `hMap`, `freb`, `rev`, `max`, `bits`, `bits16`, `shft`, the fixed tables and the CRC-32 `crct`
 * and `crc`), MIT License, Copyright (c) 2026 Arjun Barrett (tests/vendor/fflate-0.8.3.LICENSE).
 * `gunzipScripts` follows scripty.sol's `gunzipScripts-0.0.1.js`, which Art Blocks' generator also
 * inlines. Changes from fflate:
 * - one-shot inflation into a buffer of the size the gzip trailer gives: no streaming state, no
 *   output resizing, no dictionary; the block loop is restructured accordingly, stored blocks are
 *   copied byte by byte (so an output past the buffer is caught by the length check rather than
 *   thrown as a RangeError), and the fixed tables are built with condensed loops;
 * - no reverse length and distance maps and no non-reversed Huffman maps (used only to compress);
 * - added: the CRC-32 and the length of the output are checked against the gzip trailer, and a
 *   trailer size more than 1032 times the input (deflate's maximum ratio) is rejected before
 *   anything is allocated;
 * - errors are `Error("gunzip: <fflate's message>")`, without fflate's error codes.
 *
 * scripts/build_page.mjs flattens this module (removing `export`), wraps it in a function that
 * calls `gunzipScripts()`, minifies it with the pinned Terser and checks the result against
 * `SHIM_SHA256` in scripts/page.mjs.
 */

const u8 = Uint8Array;
const u16 = Uint16Array;

/** Extra bits of the length codes 257-285 (fflate's `fleb`). */
const fleb = new u8([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0, 0, 0, 0]);
/** Extra bits of the distance codes (fflate's `fdeb`). */
const fdeb = new u8([0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13, 0, 0]);
/** Order of the code length code lengths (fflate's `clim`). */
const clim = new u8([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);

/**
 * Base values from extra bits (fflate's `freb`, without the reverse map).
 * @param {Uint8Array} eb
 * @param {number} start
 */
const freb = (eb, start) => {
  const b = new u16(31);
  for (let i = 0; i < 31; ++i) b[i] = start += 1 << eb[i - 1];
  return b;
};
/** Length bases (fflate's `fl`). */
const fl = freb(fleb, 2);
fl[28] = 258;
/** Distance bases (fflate's `fd`). */
const fd = freb(fdeb, 0);

/** 15-bit bit reversal (fflate's `rev`). */
const rev = new u16(32768);
for (let i = 0; i < 32768; ++i) {
  let x = ((i & 0xaaaa) >> 1) | ((i & 0x5555) << 1);
  x = ((x & 0xcccc) >> 2) | ((x & 0x3333) << 2);
  x = ((x & 0xf0f0) >> 4) | ((x & 0x0f0f) << 4);
  rev[i] = (((x & 0xff00) >> 8) | ((x & 0x00ff) << 8)) >> 1;
}

/**
 * Decoding map of a Huffman code from its code lengths (fflate's `hMap` with `r` set): indexed by
 * the next `mb` input bits, each entry is `symbol << 4 | code length`.
 * @param {Uint8Array} cd code lengths
 * @param {number} mb maximum code length (at most 15)
 */
const hMap = (cd, mb) => {
  const s = cd.length;
  const l = new u16(mb);
  for (let i = 0; i < s; ++i) if (cd[i]) ++l[cd[i] - 1];
  const le = new u16(mb);
  for (let i = 1; i < mb; ++i) le[i] = (le[i - 1] + l[i - 1]) << 1;
  const co = new u16(1 << mb);
  const rvb = 15 - mb;
  for (let i = 0; i < s; ++i) {
    if (cd[i]) {
      const sv = (i << 4) | cd[i];
      const r = mb - cd[i];
      let v = le[cd[i] - 1]++ << r;
      for (const m = v | ((1 << r) - 1); v <= m; ++v) co[rev[v] >> rvb] = sv;
    }
  }
  return co;
};

/** The fixed literal/length code (fflate's `flt`) and its map (`flrm`). */
const flt = new u8(288);
for (let i = 0; i < 288; ++i) flt[i] = i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8;
const flrm = hMap(flt, 9);
/** The fixed distance code (fflate's `fdt`) and its map (`fdrm`). */
const fdrm = hMap(new u8(32).fill(5), 5);

/** @param {Uint8Array} a */
const max = (a) => {
  let m = a[0];
  for (let i = 1; i < a.length; ++i) if (a[i] > m) m = a[i];
  return m;
};
/**
 * The bits of `d` from bit `p` on, masked with `m` (at most 9 bits).
 * @param {Uint8Array} d
 * @param {number} p
 * @param {number} m
 */
const bits = (d, p, m) => {
  const o = (p / 8) | 0;
  return ((d[o] | (d[o + 1] << 8)) >> (p & 7)) & m;
};
/**
 * At least 16 bits of `d` from bit `p` on.
 * @param {Uint8Array} d
 * @param {number} p
 */
const bits16 = (d, p) => {
  const o = (p / 8) | 0;
  return (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16)) >> (p & 7);
};
/** The byte after bit `p`. */
const shft = (/** @type {number} */ p) => ((p + 7) / 8) | 0;

const MESSAGES = ["unexpected EOF", "invalid block type", "invalid length/literal", "invalid distance", "invalid gzip data", "CRC-32 or length mismatch"];
/** @param {number} i @returns {never} */
const err = (i) => {
  throw new Error("gunzip: " + MESSAGES[i]);
};

/**
 * Inflates raw DEFLATE data into `buf` (fflate's `inflt`, one shot). Returns the number of bytes
 * the data decodes to; bytes past the end of `buf` are dropped.
 * @param {Uint8Array} dat
 * @param {Uint8Array} buf
 */
const inflt = (dat, buf) => {
  const sl = dat.length;
  const tbts = sl * 8;
  let pos = 0;
  let bt = 0;
  for (let final = 0; !final;) {
    final = bits(dat, pos, 1);
    const type = bits(dat, pos + 1, 3);
    pos += 3;
    if (!type) {
      // Stored block: LEN at the next byte boundary, then LEN raw bytes.
      const s = shft(pos) + 4;
      const l = dat[s - 4] | (dat[s - 3] << 8);
      const t = s + l;
      if (t > sl) err(0);
      // Byte by byte, like the literals: what does not fit in `buf` is dropped, and the length
      // check after inflation rejects it.
      for (let i = s; i < t;) buf[bt++] = dat[i++];
      pos = t * 8;
      continue;
    }
    let lm = flrm;
    let dm = fdrm;
    let lbt = 9;
    let dbt = 5;
    if (type == 2) {
      // Dynamic block: the code lengths, themselves Huffman-coded.
      const hLit = bits(dat, pos, 31) + 257;
      const hcLen = bits(dat, pos + 10, 15) + 4;
      const tl = hLit + bits(dat, pos + 5, 31) + 1;
      pos += 14;
      const ldt = new u8(tl);
      const clt = new u8(19);
      for (let i = 0; i < hcLen; ++i) clt[clim[i]] = bits(dat, pos + i * 3, 7);
      pos += hcLen * 3;
      const clb = max(clt);
      const clbmsk = (1 << clb) - 1;
      const clm = hMap(clt, clb);
      for (let i = 0; i < tl;) {
        const r = clm[bits(dat, pos, clbmsk)];
        pos += r & 15;
        const s = r >> 4;
        if (s < 16) ldt[i++] = s;
        else {
          let c = 0;
          let n = 0;
          if (s == 16) {
            n = 3 + bits(dat, pos, 3);
            pos += 2;
            c = ldt[i - 1];
          } else if (s == 17) {
            n = 3 + bits(dat, pos, 7);
            pos += 3;
          } else if (s == 18) {
            n = 11 + bits(dat, pos, 127);
            pos += 7;
          }
          while (n--) ldt[i++] = c;
        }
      }
      const lt = ldt.subarray(0, hLit);
      const dt = ldt.subarray(hLit);
      lbt = max(lt);
      dbt = max(dt);
      lm = hMap(lt, lbt);
      dm = hMap(dt, dbt);
    } else if (type != 1) err(1);
    if (pos > tbts) err(0);
    const lms = (1 << lbt) - 1;
    const dms = (1 << dbt) - 1;
    for (;;) {
      const c = lm[bits16(dat, pos) & lms];
      const sym = c >> 4;
      pos += c & 15;
      if (pos > tbts) err(0);
      if (!c) err(2);
      if (sym < 256) buf[bt++] = sym;
      else if (sym == 256) break;
      else {
        let add = sym - 254;
        if (sym > 264) {
          const i = sym - 257;
          const b = fleb[i];
          add = bits(dat, pos, (1 << b) - 1) + fl[i];
          pos += b;
        }
        const d = dm[bits16(dat, pos) & dms];
        const dsym = d >> 4;
        if (!d) err(3);
        pos += d & 15;
        let dist = fd[dsym];
        if (dsym > 3) {
          const b = fdeb[dsym];
          dist += bits16(dat, pos) & ((1 << b) - 1);
          pos += b;
        }
        if (pos > tbts) err(0);
        if (bt < dist) err(3);
        for (const end = bt + add; bt < end; ++bt) buf[bt] = buf[bt - dist];
      }
    }
  }
  return bt;
};

/** CRC-32 table (fflate's `crct`). */
const crct = new Int32Array(256);
for (let i = 0; i < 256; ++i) {
  let c = i;
  for (let k = 8; k--;) c = ((c & 1) && -306674912) ^ (c >>> 1);
  crct[i] = c;
}

/**
 * The 32-bit little-endian integer at `i`, signed.
 * @param {Uint8Array} d
 * @param {number} i
 */
const le32 = (d, i) => d[i] | (d[i + 1] << 8) | (d[i + 2] << 16) | (d[i + 3] << 24);

/**
 * Decompresses a gzip member (RFC 1952; fflate's `gunzipSync`), checking the CRC-32 and the length
 * in its trailer. Throws `Error("gunzip: ...")`.
 * @param {Uint8Array} d
 * @returns {Uint8Array}
 */
export function gunzip(d) {
  const n = d.length;
  if (d[0] != 31 || d[1] != 139 || d[2] != 8) err(4);
  // Skip the optional header fields: FEXTRA, then FNAME and FCOMMENT (zero-terminated), FHCRC.
  const flg = d[3];
  let st = 10;
  if (flg & 4) st += (d[10] | (d[11] << 8)) + 2;
  for (let zs = ((flg >> 3) & 1) + ((flg >> 4) & 1); zs > 0;) if (!d[st++]) --zs;
  st += flg & 2;
  const size = le32(d, n - 4) >>> 0;
  if (st + 8 > n || size > n * 1032) err(4);
  const out = new u8(size);
  if (inflt(d.subarray(st, n - 8), out) != size) err(5);
  let c = -1;
  for (let i = 0; i < size; ++i) c = crct[(c & 255) ^ out[i]] ^ (c >>> 8);
  if (~c != le32(d, n - 8)) err(5);
  return out;
}

/**
 * Replaces every `<script type="text/javascript+gzip" src="data:...;base64,...">` in the document
 * with an inline `<script>` holding the decompressed source, which runs on insertion. A tag that
 * fails is logged and left in place; the others are still replaced.
 */
export function gunzipScripts() {
  document.querySelectorAll('script[type="text/javascript+gzip"]').forEach((tag) => {
    try {
      const src = tag.getAttribute("src") || "";
      const bin = atob(src.slice(src.indexOf(",") + 1));
      const bytes = new u8(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const script = document.createElement("script");
      script.textContent = new TextDecoder().decode(gunzip(bytes));
      tag.replaceWith(script);
    } catch (e) {
      console.error(e);
    }
  });
}
