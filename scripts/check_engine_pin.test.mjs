import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { checkEnginePin } from "./check_engine_pin.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "engine-pin-test-"));
  const repo = join(root, "repo"), home = join(root, "gpg");
  mkdirSync(repo); mkdirSync(home, { mode: 0o700 });
  const env = { ...process.env, GNUPGHOME: home, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  t.after(() => { spawnSync("gpgconf", ["--homedir", home, "--kill", "gpg-agent"]); rmSync(root, { recursive: true, force: true }); });
  execFileSync("gpg", ["--batch", "--pinentry-mode", "loopback", "--passphrase", "", "--quick-generate-key", "Engine fixture <fixture@example.invalid>", "ed25519", "sign", "0"], { env, stdio: "pipe" });
  const fingerprint = execFileSync("gpg", ["--with-colons", "--list-secret-keys"], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).split("\n").find(line => line.startsWith("fpr:")).split(":")[9];
  mkdirSync(join(repo, "scripts"));
  const files = {
    "webaudio-tinysynth.js": "source\n", "webaudio-tinysynth.min.js": "minified\n",
    "webaudio-tinysynth.min.js.map": "map\n", NOTICE: "notice\n",
    "scripts/build.js": "recipe\n", "package-lock.json": "lock\n",
    "package.json": JSON.stringify({ name: "pocket-synth", version: "9.8.7", devDependencies: { terser: "5.51.2" } }),
  };
  for (const [file, bytes] of Object.entries(files)) writeFileSync(join(repo, file), bytes);
  const digest = (file) => createHash("sha256").update(files[file]).digest("hex");
  const git = (...args) => execFileSync("git", ["-C", repo, ...args], { env, encoding: "utf8", stdio: "pipe" }).trim();
  git("init", "-q"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid");
  git("config", "user.signingkey", fingerprint); git("config", "commit.gpgsign", "false");
  git("add", "."); git("commit", "-qm", "Release fixture"); git("tag", "-s", "v9.8.7", "-m", "Release");
  const commit = git("rev-parse", "HEAD");
  git("update-ref", "refs/remotes/origin/main", commit);
  const pin = { ref: "v9.8.7", commit, sha256: digest("webaudio-tinysynth.min.js"), noticeSha256: digest("NOTICE") };
  const build = { provisional: false, sourceCommit: commit, distributionCommit: commit,
    sourceSha256: digest("webaudio-tinysynth.js"), sourceMapSha256: digest("webaudio-tinysynth.min.js.map"),
    recipeSha256: digest("scripts/build.js"), packageLockSha256: digest("package-lock.json"), terser: "5.51.2" };
  return { fork: repo, env, pin, build, embedded: false, git, fingerprint };
}

test("offline audit binds signed tag, source/build identities and freshly fetched main", (t) => {
  const f = fixture(t), result = checkEnginePin({ ...f, latest: true });
  assert.equal(result.commit, f.pin.commit);
  assert.equal(result.signerFingerprint, f.fingerprint);
  assert.equal(result.checkedOriginMain, f.pin.commit);
  assert.equal(result.embeddedEngineVerified, false, "fixture audit does not claim to be the player artifact");
  assert.throws(() => checkEnginePin({ ...f, pin: { ...f.pin, commit: "0".repeat(40) } }), /does not resolve/);
  assert.throws(() => checkEnginePin({ ...f, pin: { ...f.pin, sha256: "0".repeat(64) } }), /SHA-256 differs/);
  assert.throws(() => checkEnginePin({ ...f, build: { ...f.build, sourceSha256: "0".repeat(64) } }), /SHA-256 differs/);
  assert.throws(() => checkEnginePin({ ...f, build: { ...f.build, provisional: true } }), /non-provisional/);
  assert.throws(() => checkEnginePin({ ...f, embedded: true }), /embedded player engine differs/);
});

test("lightweight and unsigned annotated tags are rejected", (t) => {
  const f = fixture(t);
  f.git("tag", "-d", "v9.8.7"); f.git("tag", "v9.8.7");
  assert.throws(() => checkEnginePin(f), /annotated signed tag/);
  f.git("tag", "-d", "v9.8.7"); f.git("tag", "-a", "v9.8.7", "-m", "Unsigned");
  assert.throws(() => checkEnginePin(f), /signature verification failed/);
});

test("new main source fails freshness while the pinned release remains independently auditable", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.fork, "webaudio-tinysynth.js"), "newer source\n");
  f.git("add", "."); f.git("commit", "-qm", "New source");
  f.git("update-ref", "refs/remotes/origin/main", f.git("rev-parse", "HEAD"));
  assert.throws(() => checkEnginePin({ ...f, latest: true }), /SHA-256 differs/);
  assert.equal(checkEnginePin(f).commit, f.pin.commit);
});
