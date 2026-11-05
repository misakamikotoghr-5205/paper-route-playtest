import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
const root = new URL("../", import.meta.url);
for (const file of [
  "app.js",
  "engine.js",
  "scripts/build.js",
  "scripts/check.js",
]) {
  const result = spawnSync(
    process.execPath,
    ["--check", new URL(file, root).pathname],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
}
const html = await readFile(new URL("index.html", root), "utf8");
const app = await readFile(new URL("app.js", root), "utf8");
const css = await readFile(new URL("styles.css", root), "utf8");
assert(
  !/https?:\/\//.test(html + app + css),
  "Runtime assets must not contain remote URLs",
);
assert(
  !/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/.test(app),
  "Default build has no networking",
);
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
assert.equal(new Set(ids).size, ids.length, "HTML IDs must be unique");
const references = [...app.matchAll(/\$\((["'])([^"']+)\1\)/g)];
assert(references.length > 0, "DOM reference check must inspect actual references");
for (const [, , id] of references)
  assert(ids.includes(id), `Missing HTML element ${id}`);
assert(html.includes('aria-live="polite"'));
assert(css.includes("prefers-reduced-motion"));
console.log("Syntax, DOM references and offline runtime boundary checked.");
