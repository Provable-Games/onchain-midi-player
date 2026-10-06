#!/usr/bin/env node
// Calls StressNft.token_uri(1..20) through RPC providers and records, for each provider and token,
// success or the error, the response size, the latency, and whether the result is byte-identical to
// the JS reference (reference.mjs). The tokens' gas runs from 30M to 10.1B Sierra gas (README.md),
// so the matrix shows where each provider stops serving a token. Node 22+, built-ins only.
//
// Usage: node scripts/rpc_check.mjs [env-file] [options]
//
//   env-file        a file of NAME=URL lines (default ~/.config/omp-rpc.env; a missing default file is
//                   skipped), for providers that need an API key. Blank lines and # comments are
//                   ignored. The URLs and keys are never printed or written: output carries only NAME.
//   --only A,B      check only these provider NAMEs
//   --no-public     skip the built-in public Sepolia endpoints
//   --tokens 1-20   token ids to call, e.g. 18-20 or 1,5,9 (default 1-20)
//   --address 0x..  the StressNft contract (default: sepolia.json)
//   --timeout 180   client timeout per call, in seconds
//   --out FILE      JSON results file (default rpc_check_results.json in the current directory)
//
// Providers run in parallel, each calling its tokens one at a time. The number of bars per token is
// read from the contract (`repetitions`), so a retuned token is still compared with the right
// reference; if no provider answers that, repetitions.json is used.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeByteArray, defaultRepetitions, rpcResponseBytes, tokenUri } from './reference.mjs';
import { fixedFragment, sha256 } from '../../../scripts/segments.mjs';

/** The most bars a reference is built for (64 MB of MIDI): a larger count is a malformed reply, not a token. */
export const MAX_BARS = 1_000_000n;

/**
 * Public Sepolia endpoints, checked live on 2026-10-05 (starknet_specVersion). Discontinued, so
 * left out: Lava (rpc.starknet-testnet.lava.build) and BlastAPI (public.blastapi.io) answer that
 * they are gone, and Nethermind's free-rpc.nethermind.io no longer resolves. Alchemy's public
 * URL needs the network enabled on an app, so it belongs in the env file.
 */
export const PUBLIC_ENDPOINTS = {
  zan: 'https://api.zan.top/public/starknet-sepolia/rpc/v0_10',
  cartridge: 'https://api.cartridge.gg/x/starknet/sepolia',
  drpc: 'https://starknet-sepolia.drpc.org',
  publicnode: 'https://starknet-sepolia-rpc.publicnode.com',
};

const DEPLOYMENT = JSON.parse(readFileSync(new URL('../sepolia.json', import.meta.url), 'utf8'));

// --------------------------------------------------------------------------------------------
// Entry point selectors: starknet_keccak(name) = keccak256(name) mod 2^250
// --------------------------------------------------------------------------------------------

const MASK64 = (1n << 64n) - 1n;
const rotl = (x, n) => (n ? ((x << BigInt(n)) | (x >> BigInt(64 - n))) & MASK64 : x);

/** Keccak-256 (the original padding, not SHA3-256) of a byte string, as a bigint. */
export function keccak256(input) {
  const lfsr = (t) => {
    let r = 1;
    for (let i = 0; i < t % 255; i++) r = (r << 1) ^ (r & 0x80 ? 0x171 : 0);
    return r & 1;
  };
  const RC = Array.from({ length: 24 }, (_, ir) => {
    let c = 0n;
    for (let j = 0; j < 7; j++) if (lfsr(j + 7 * ir)) c |= 1n << BigInt(2 ** j - 1);
    return c;
  });
  const ROT = new Array(25).fill(0);
  for (let t = 0, x = 1, y = 0; t < 24; t++) {
    ROT[x + 5 * y] = (((t + 1) * (t + 2)) / 2) % 64;
    [x, y] = [y, (2 * x + 3 * y) % 5];
  }
  const rate = 136;
  const padded = Buffer.alloc(Math.ceil((input.length + 1) / rate) * rate);
  Buffer.from(input).copy(padded);
  padded[input.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;
  const a = new Array(25).fill(0n);
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) a[i] ^= padded.readBigUInt64LE(off + 8 * i);
    for (let round = 0; round < 24; round++) {
      const c = [0, 1, 2, 3, 4].map((x) => a[x] ^ a[x + 5] ^ a[x + 10] ^ a[x + 15] ^ a[x + 20]);
      for (let x = 0; x < 5; x++) {
        const d = c[(x + 4) % 5] ^ rotl(c[(x + 1) % 5], 1);
        for (let y = 0; y < 25; y += 5) a[x + y] ^= d;
      }
      const b = new Array(25);
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(a[x + 5 * y], ROT[x + 5 * y]);
      for (let y = 0; y < 25; y += 5) for (let x = 0; x < 5; x++) a[x + y] = b[x + y] ^ (~b[((x + 1) % 5) + y] & MASK64 & b[((x + 2) % 5) + y]);
      a[0] ^= RC[round];
    }
  }
  const out = Buffer.alloc(32);
  for (let i = 0; i < 4; i++) out.writeBigUInt64LE(a[i], 8 * i);
  return BigInt('0x' + out.toString('hex'));
}

export const selector = (name) => '0x' + (keccak256(Buffer.from(name)) & ((1n << 250n) - 1n)).toString(16);

// --------------------------------------------------------------------------------------------
// Calls
// --------------------------------------------------------------------------------------------

/**
 * Redacts everything in `urls` that could carry a credential from a message: each URL, its host,
 * user and password, every path segment of at least 3 characters (a key may be any string,
 * including letters only or digits only) and every query value, also percent-decoded. Pass only
 * the URLs of providers whose URL is a secret: the built-in public ones are not.
 */
export function redactor(urls) {
  const secrets = new Set();
  const add = (part) => {
    if (!part) return;
    secrets.add(part);
    try {
      secrets.add(decodeURIComponent(part));
    } catch {
      /* not percent-encoded */
    }
  };
  for (const u of urls) {
    add(u);
    try {
      const url = new URL(u);
      add(url.host);
      add(url.hostname);
      add(url.username);
      add(url.password);
      for (const part of url.pathname.split('/')) if (part.length >= 3) add(part);
      for (const pair of url.search.slice(1).split('&')) add(pair.slice(pair.indexOf('=') + 1)); // raw, as an error echoes it
      for (const [, v] of url.searchParams) add(v);
    } catch {
      /* not a URL: redacted whole */
    }
  }
  const list = [...secrets].filter(Boolean).sort((a, b) => b.length - a.length);
  return (msg) => list.reduce((m, s) => m.split(s).join('<redacted>'), String(msg)).replace(/https?:\/\/\S+/g, '<url>');
}

/** Appends the text of each hex short string (a revert reason) in `msg`: `0x4f..73` becomes `0x4f..73 ('Out of gas')`. */
export function withText(msg) {
  return msg.replace(/0x([0-9a-f]{6,62})(?![0-9a-f']| \()/g, (hex, digits) => {
    const text = digits.length % 2 ? '' : Buffer.from(digits, 'hex').toString('latin1');
    return /^[\x20-\x7e]+$/.test(text) ? `${hex} ('${text}')` : hex;
  });
}

/** Whether `result` is an array of `0x` hex strings. */
export const isFelts = (result) => Array.isArray(result) && result.every((f) => typeof f === 'string' && /^0x[0-9a-fA-F]+$/.test(f));

/** The single felt of a successful call, as a bigint, or undefined if the call failed or returned anything else. */
export const scalar = (r) => (r.ok && r.felts.length === 1 ? BigInt(r.felts[0]) : undefined);

/** One starknet_call. Returns {ok, felts | error, bytes, ms}. `redact` strips provider URLs from errors. */
async function call(url, redact, timeoutS, address, name, calldata) {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'starknet_call',
    params: [{ contract_address: address, entry_point_selector: selector(name), calldata }, 'latest'],
  });
  const t0 = performance.now();
  let bytes = 0;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'accept-encoding': 'identity' },
      body,
      signal: AbortSignal.timeout(timeoutS * 1000),
    });
    const text = Buffer.from(await res.arrayBuffer());
    bytes = text.length;
    const ms = Math.round(performance.now() - t0);
    let json;
    try {
      json = JSON.parse(text.toString('utf8'));
    } catch {
      return { ok: false, error: `HTTP ${res.status}: ${redact(text.toString('utf8').replace(/\s+/g, ' ')).slice(0, 200)}`, bytes, ms };
    }
    if (json.error) {
      const data = json.error.data;
      let detail = data?.execution_error ?? data?.revert_error ?? data ?? '';
      while (detail && typeof detail === 'object' && 'error' in detail) detail = detail.error; // the innermost frame
      const msg = `${json.error.code}: ${json.error.message}${detail ? ` | ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`;
      return { ok: false, error: redact(withText(msg).replace(/\s+/g, ' ')).slice(0, 300), bytes, ms };
    }
    if (!res.ok || !Array.isArray(json.result)) return { ok: false, error: `HTTP ${res.status}: no result`, bytes, ms };
    // A result is hex felts: anything else is not decoded or echoed, since it could carry a credential.
    if (!isFelts(json.result)) return { ok: false, error: 'malformed result: not an array of hex felts', bytes, ms };
    return { ok: true, felts: json.result, bytes, ms };
  } catch (e) {
    const ms = Math.round(performance.now() - t0);
    const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    const cause = e?.cause?.code ?? e?.cause?.message ?? '';
    return { ok: false, error: timedOut ? `timeout after ${timeoutS} s` : redact(`${e?.message ?? e}${cause ? ` (${cause})` : ''}`), bytes, ms };
  }
}

/** A short label for the matrix. */
export function label(r) {
  if (r.ok) return r.identical ? 'ok' : 'DIFF';
  const e = r.error;
  if (/timeout/i.test(e)) return 'TIMEOUT';
  if (/out of gas|OutOfGas|could not reach the end|gas/i.test(e)) return 'OOG';
  const http = /^HTTP (\d+)/.exec(e);
  if (http && http[1] !== '413') return `HTTP ${http[1]}`;
  if (/^HTTP 413|too large|payload|response size|message size/i.test(e)) return 'TOO BIG';
  return 'ERR';
}

function parseTokens(spec) {
  const out = [];
  for (const part of spec.split(',')) {
    const [a, b] = part.split('-').map(Number);
    for (let i = a; i <= (b ?? a); i++) out.push(i);
  }
  return out;
}

function parseEnv(path) {
  const providers = {};
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim().replace(/^export\s+/, '');
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const name = line.slice(0, eq).trim();
    const url = line.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    if (/^https?:\/\//.test(url)) providers[name] = url;
  }
  return providers;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = { only: null, public: true, tokens: '1-20', address: DEPLOYMENT.address, timeout: 180, out: 'rpc_check_results.json' };
  let envFile = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--only') opt.only = args[++i].split(',');
    else if (a === '--no-public') opt.public = false;
    else if (a === '--tokens') opt.tokens = args[++i];
    else if (a === '--address') opt.address = args[++i];
    else if (a === '--timeout') opt.timeout = Number(args[++i]);
    else if (a === '--out') opt.out = args[++i];
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
    else envFile = a;
  }
  const defaultEnv = `${homedir()}/.config/omp-rpc.env`;
  let providers = {};
  if (opt.public) providers = { ...PUBLIC_ENDPOINTS };
  try {
    providers = { ...providers, ...parseEnv(envFile ?? defaultEnv) };
  } catch (e) {
    if (envFile || e.code !== 'ENOENT') throw new Error(`cannot read the env file: ${e.code ?? e.message}`);
  }
  if (opt.only) providers = Object.fromEntries(Object.entries(providers).filter(([n]) => opt.only.includes(n)));
  const names = Object.keys(providers);
  if (!names.length) throw new Error('no providers: pass an env file of NAME=URL lines, or drop --no-public');
  const tokens = parseTokens(opt.tokens);
  // Only the providers from the env file have secret URLs.
  const redact = redactor(Object.keys(providers).filter((n) => !(n in PUBLIC_ENDPOINTS) || providers[n] !== PUBLIC_ENDPOINTS[n]).map((n) => providers[n]));
  console.log(`providers: ${names.join(', ')}; tokens ${opt.tokens}; contract ${opt.address}`);

  // The class the contract library-calls. The reference is the NFT-owned composition of this checkout, so it matches
  // only a contract that pins a class with these provider fragments: find the class's version in deployments/ and
  // compare the page's SHA-256 with scripts/library_versions.json.
  const versionOf = new Map();
  for (const f of readdirSync(new URL('../../../deployments/', import.meta.url)).filter((f) => f.endsWith('.json') && f !== 'historical-builds.json')) {
    const c = JSON.parse(readFileSync(new URL(`../../../deployments/${f}`, import.meta.url), 'utf8')).class;
    versionOf.set(BigInt(c.class_hash), c.version);
  }
  const engineFragmentSha = sha256(fixedFragment("engine"));
  const recorded = JSON.parse(readFileSync(new URL('../../../scripts/library_versions.json', import.meta.url), 'utf8'));
  for (const name of names) {
    const pinned = scalar(await call(providers[name], redact, 30, opt.address, 'tinysynth_class_hash', []));
    if (pinned === undefined) continue;
    const version = versionOf.get(pinned);
    if (version === undefined || recorded[version]?.artifacts.engine.raw_sha256 !== engineFragmentSha) {
      console.log(`warning: the contract pins class 0x${pinned.toString(16)}, ${version === undefined ? 'which is not a class in deployments/' : `version ${version}, whose engine fragment is not this checkout's`}: the reference is the composition of this checkout, so DIFF may be a consumer/build mismatch, not a provider fault`);
    }
    break;
  }

  // The number of bars per token, from the contract: each token from the first provider that
  // answers for it. Tokens no provider answers for use repetitions.json.
  const bars = Object.fromEntries(tokens.map((t) => [t, defaultRepetitions()[t - 1]]));
  const live = {};
  for (const name of names) {
    for (const t of tokens.filter((t) => !(t in live))) {
      const n = scalar(await call(providers[name], redact, 30, opt.address, 'repetitions', [`0x${t.toString(16)}`, '0x0']));
      if (n === undefined || n < 1n || n > MAX_BARS) break; // not a count the contract can hold: try the next provider
      live[t] = Number(n);
    }
    if (Object.keys(live).length === tokens.length) break;
  }
  Object.assign(bars, live);
  const fallback = tokens.filter((t) => !(t in live));
  const changed = tokens.filter((t) => t in live && live[t] !== defaultRepetitions()[t - 1]);
  console.log(
    `bars per token: ${fallback.length === tokens.length ? 'from repetitions.json' : 'from the contract'}` +
      (fallback.length && fallback.length < tokens.length ? `, except tokens ${fallback.join(',')} (repetitions.json)` : '') +
      (changed.length ? `; differs from repetitions.json for tokens ${changed.join(',')}` : ''),
  );
  const reference = new Map();
  const expected = (t) => {
    if (!reference.has(t)) reference.set(t, tokenUri(t, bars[t]));
    return reference.get(t);
  };

  const results = {};
  await Promise.all(
    names.map(async (name) => {
      results[name] = {};
      for (const t of tokens) {
        const r = await call(providers[name], redact, opt.timeout, opt.address, 'token_uri', [`0x${t.toString(16)}`, '0x0']);
        const row = { ok: r.ok, bytes: r.bytes, ms: r.ms };
        if (r.ok) {
          try {
            const uri = decodeByteArray(r.felts);
            row.identical = uri === expected(t);
            row.uri_chars = uri.length;
            if (!row.identical) row.error = `differs from the reference (${uri.length} chars, expected ${expected(t).length})`;
          } catch (e) {
            row.ok = false;
            row.error = redact(`undecodable result: ${e.message}`);
          }
        } else row.error = r.error;
        row.label = label(row);
        results[name][t] = row;
        console.error(`${name} token ${t}: ${row.label} ${(row.bytes / 1e6).toFixed(2)} MB ${(row.ms / 1000).toFixed(1)} s`);
      }
    }),
  );

  // The matrix, as a Markdown table.
  const cell = (r) => (r.ok && r.identical ? `ok ${(r.ms / 1000).toFixed(1)}s` : r.label);
  const lines = [
    `| token | bars | response | ${names.join(' | ')} |`,
    `| --- | --- | --- | ${names.map(() => '---').join(' | ')} |`,
  ];
  for (const t of tokens) {
    const size = expected(t).length ? rpcResponseBytes(expected(t)) : 0;
    lines.push(`| ${t} | ${bars[t]} | ${(size / 1e6).toFixed(2)} MB | ${names.map((n) => cell(results[n][t])).join(' | ')} |`);
  }
  console.log('\n' + lines.join('\n'));
  console.log('\n"response" is the computed size of the JSON-RPC response; ok is byte-identical to the JS reference, with the latency.');
  const errors = {};
  for (const n of names) for (const t of tokens) {
    const r = results[n][t];
    if (!r.error) continue;
    const key = `${n}: ${r.label}: ${r.error.slice(0, 200)}`;
    (errors[key] ??= []).push(t);
  }
  for (const [msg, ts] of Object.entries(errors)) console.log(`- tokens ${ts.join(',')} - ${msg}`);

  writeFileSync(opt.out, JSON.stringify({ address: opt.address, class_hash: opt.address === DEPLOYMENT.address ? DEPLOYMENT.class_hash : null, date: new Date().toISOString(), bars, providers: results }, null, 2) + '\n');
  console.log(`\nresults written to ${opt.out}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`rpc_check: ${e.message}`);
    process.exit(1);
  });
}
