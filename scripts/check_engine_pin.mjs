#!/usr/bin/env node
// @ts-check
// Offline audit against a full-history pocket-synth checkout. Fetch origin and
// tags explicitly before --latest; normal builds and playback make no requests.
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { ENGINE_PIN, ENGINE_BUILD, ENGINE_RELEASE_SIGNER, engineSource, engineNotice, sha256Hex } from "./engine.mjs";
import { VERSION, fixedFragment } from "./segments.mjs";
import { verifyEngine } from "./verify_engine.mjs";

export function checkEnginePin({ fork, latest = false, pin = ENGINE_PIN, build = ENGINE_BUILD, signer = ENGINE_RELEASE_SIGNER, env = process.env, embedded = true }) {
  if (!fork) throw new Error("--fork <pocket-synth checkout> is required");
  if (!/^v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(pin.ref) || build.provisional) throw new Error("audit requires a non-provisional release tag");
  const git = (...args) => execFileSync("git", ["-C", fork, ...args], { env, maxBuffer: 1 << 26 });
  const text = (...args) => git(...args).toString("utf8").trim();
  const ref = "refs/tags/" + pin.ref;
  if (text("cat-file", "-t", ref) !== "tag") throw new Error("engine release must use an annotated signed tag");
  const commit = text("rev-parse", ref + "^{commit}");
  if (commit !== pin.commit) throw new Error("release tag does not resolve to ENGINE_PIN.commit");
  const signed = spawnSync("git", ["-C", fork, "verify-tag", "--raw", ref], { env, encoding: "utf8" });
  const signature = /\[GNUPG:\] VALIDSIG ([0-9A-F]{40,64}) /.exec(signed.stderr || "");
  if (signed.status !== 0 || !signature) throw new Error("engine release tag GPG signature verification failed");
  if (signature[1] !== signer) throw new Error("engine release tag signer differs from ENGINE_RELEASE_SIGNER");
  const hash = (at, file, expected) => {
    const actual = sha256Hex(git("show", at + ":" + file));
    if (actual !== expected) throw new Error(at + ":" + file + " SHA-256 differs from the engine pin");
    return actual;
  };
  const identities = {
    "webaudio-tinysynth.min.js": pin.sha256,
    "NOTICE": pin.noticeSha256,
    "webaudio-tinysynth.js": build.sourceSha256,
    "webaudio-tinysynth.min.js.map": build.sourceMapSha256,
    "scripts/build.js": build.recipeSha256,
    "package-lock.json": build.packageLockSha256,
  };
  for (const [file, expected] of Object.entries(identities)) hash(commit, file, expected);
  for (const file of ["webaudio-tinysynth.js", "scripts/build.js", "package-lock.json"]) hash(build.sourceCommit, file, identities[file]);
  for (const file of ["webaudio-tinysynth.min.js", "webaudio-tinysynth.min.js.map", "NOTICE"]) hash(build.distributionCommit, file, identities[file]);
  const pkg = JSON.parse(git("show", commit + ":package.json").toString("utf8"));
  if (pkg.name !== "pocket-synth" || pin.ref !== "v" + pkg.version || pkg.devDependencies.terser !== build.terser) throw new Error("release package version or compiler differs from the pin");
  let head;
  if (latest) {
    head = text("rev-parse", "refs/remotes/origin/main");
    for (const [file, expected] of Object.entries(identities)) hash(head, file, expected);
  }
  if (embedded) {
    // Hash-checked vendor files and the actual decompressed current fragment.
    engineSource(); engineNotice();
    const actual = verifyEngine(fixedFragment("player")).engine;
    if (actual.sha256 !== pin.sha256) throw new Error("embedded player engine differs from the release");
  }
  return {
    playerVersion: VERSION, release: pin.ref, commit,
    tagObject: text("rev-parse", ref), signerFingerprint: signature[1],
    engineSha256: pin.sha256, noticeSha256: pin.noticeSha256,
    ...(head ? { checkedOriginMain: head, sameEngineInputs: true } : {}),
    embeddedEngineVerified: embedded,
    scope: "Local Git objects, signed tag, pinned source/build/distribution hashes and embedded bytes. Fetch first for freshness; rebuild with the fork's npm run verify for reproducibility.",
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    let fork;
    let latest = false;
    while (args.length) {
      const flag = args.shift();
      if (flag === "--fork" && args.length && !args[0].startsWith("--")) fork = resolve(args.shift());
      else if (flag === "--latest") latest = true;
      else throw new Error("usage: check_engine_pin.mjs --fork CHECKOUT [--latest]");
    }
    console.log(JSON.stringify(checkEnginePin({ fork, latest }), null, 2));
  } catch (error) {
    console.error("engine pin verification failed: " + error.message);
    process.exitCode = 1;
  }
}
