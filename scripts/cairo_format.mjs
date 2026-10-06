// Format generated Cairo with the repository-pinned Scarb formatter.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
/** @param {string} source @returns {string} */
export function formatCairo(source) {
  const dir = mkdtempSync(join(tmpdir(), "onchain-midi-cairo-"));
  try {
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, ".tool-versions"), readFileSync(new URL("../.tool-versions", import.meta.url)));
    writeFileSync(join(dir, "Scarb.toml"), '[package]\nname = "generated"\nversion = "0.1.0"\nedition = "2025_12"\n[lib]\n');
    const file = join(dir, "src", "lib.cairo");
    writeFileSync(file, source);
    const result = spawnSync("scarb", ["fmt", "--emit", "stdout", "--no-color", file], { cwd: dir, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    // Scarb returns 1 when --emit would change the input, as well as for errors.
    if (result.error || result.status === null || ![0, 1].includes(result.status) || !result.stdout || /^error:/m.test(result.stdout) || result.stderr) throw new Error(result.stderr || result.stdout || String(result.error));
    return result.stdout;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
