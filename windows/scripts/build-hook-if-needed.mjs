// Builds miku-hook only when something it is made of changed.
//
// package.json's predev/prebuild used to run `cargo build --release -p
// miku-hook` every time, which relinked the LTO binary (10–30 s) even when
// hook/ had not been touched. The binary's mtime is the marker: newer sources
// (or a missing binary) mean a build, anything else is skipped.

import { existsSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const binary = join(root, "target", "release", process.platform === "win32" ? "miku-hook.exe" : "miku-hook");

/** The newest mtime under `path`; build output (`target/`) is never an input. */
function newestMtime(path) {
  const st = statSync(path);
  if (!st.isDirectory()) return st.mtimeMs;
  // A directory's own time changes when a file is added or removed, which is
  // a source change too.
  let newest = st.mtimeMs;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.name === "target") continue;
    newest = Math.max(newest, newestMtime(join(path, entry.name)));
  }
  return newest;
}

const inputs = [join(root, "hook"), join(root, "Cargo.toml"), join(root, "Cargo.lock")];
const source = Math.max(...inputs.map(newestMtime));

if (existsSync(binary) && statSync(binary).mtimeMs >= source) {
  console.log("miku-hook is up to date");
  process.exit(0);
}

console.log("building miku-hook");
const built = spawnSync("cargo", ["build", "--release", "-p", "miku-hook"], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(built.status ?? 1);
