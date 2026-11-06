/** Read-only verification of the checked-in evidence using the current strict engine. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LEVELS,
  VERSION,
  createGame,
  exportReplay,
  findDefect,
  getLevel,
  move,
  plan,
  replay,
} from "../../engine.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
assert(process.argv.length <= 3, "Usage: node docs/evidence/verify.mjs [DIRECTORY]");
const evidence = process.argv[2] ? resolve(process.argv[2]) : here;
const readJson = async (path) => JSON.parse(await readFile(join(evidence, path), "utf8"));
const hash = (data) => createHash("sha256").update(data).digest("hex");
const manifest = await readJson("manifest.json");
assert.equal(manifest.format, "paper-route-evidence-manifest");
assert.equal(manifest.runtime.engineVersion, VERSION);
assert.equal(manifest.fixedSeed, 20261106);
assert.equal(manifest.mirrorVariant, manifest.fixedSeed % 4);
for (const entry of [...manifest.source.files, manifest.generator]) {
  const data = await readFile(join(root, entry.path));
  assert.equal(data.length, entry.bytes, `${entry.path}: byte length`);
  assert.equal(hash(data), entry.sha256, `${entry.path}: source SHA-256`);
}
for (const entry of manifest.files) {
  const data = await readFile(join(evidence, entry.path));
  assert.equal(data.length, entry.bytes, `${entry.path}: byte length`);
  assert.equal(hash(data), entry.sha256, `${entry.path}: artifact SHA-256`);
}

const results = await readJson("run-results.json");
assert.equal(results.sourceCommit, manifest.source.commit);
assert.equal(results.seed, manifest.fixedSeed);
assert.equal(results.winningRuns.length, LEVELS.length);
assert.deepEqual(results.winningRuns.map((run) => run.levelId), LEVELS.map((level) => level.id));

const summary = (state) => ({
  position: { ...state.position },
  carry: state.carry,
  delivered: [...state.delivered],
  gatesOpen: state.gatesOpen,
  moves: state.moves,
  phase: state.phase,
});

for (const run of results.winningRuns) {
  const data = await readJson(run.replayPath);
  assert.equal(data.format, "paper-route-replay");
  assert(Buffer.byteLength(JSON.stringify(data)) <= 100000, "UI import size limit");
  assert(data.actions.length <= 2000, "Engine replay action limit");
  assert.equal(data.seed, manifest.fixedSeed);
  const initial = createGame(data.levelId, data.seed);
  const solution = plan(initial);
  assert.deepEqual(run.actions, solution.actions);
  assert.deepEqual(data.actions, run.actions);
  assert.equal(run.planner.visited, solution.visited);
  assert.equal(run.planner.algorithm, solution.algorithm);
  assert.equal(run.planner.status, solution.status);
  assert.deepEqual(run.initial, summary(initial));
  let state = initial;
  const steps = [];
  for (const action of data.actions) {
    const moved = move(state, action);
    assert(moved.changed);
    const events = moved.state.events.slice(state.events.length);
    state = moved.state;
    steps.push({ action, ...summary(state), events });
  }
  assert.deepEqual(run.steps, steps);
  assert.deepEqual(run.final, summary(state));
  assert.equal(state.phase, "won");
  const level = getLevel(data.levelId, data.seed);
  assert.equal(run.budget, level.budget);
  assert(state.moves <= level.budget);
  assert.deepEqual(state.position, level.depot);
  assert.deepEqual(state.delivered, level.parcels.map((parcel) => parcel.id));
  assert.equal(state.carry, null);
  assert.deepEqual(exportReplay(state), data);
  assert.deepEqual(replay(data), state);
  assert.deepEqual(replay({ ...data, result: { phase: "lost" } }), state);
  console.log(`${data.levelId}: actual strict replay PASS (${state.moves}/${level.budget})`);
}

const defectName = `defects/injected-wrong-dock-seed-${manifest.fixedSeed}`;
const defect = await readJson(`${defectName}.json`);
assert.deepEqual(defect, findDefect(manifest.fixedSeed));
const control = await readJson(`${defectName}-strict-replay.json`);
const input = { ...defect.initial, actions: defect.actions };
const strict = replay(input);
const mutant = replay(input, { mutant: true });
assert.deepEqual(control, exportReplay(strict));
assert.deepEqual(replay(control), strict);
assert.equal(strict.carry, "a");
assert.deepEqual(strict.delivered, []);
assert.equal(mutant.carry, null);
assert.deepEqual(mutant.delivered, ["a"]);
assert.deepEqual(results.injectedDefect.strictFinal, summary(strict));
assert.deepEqual(results.injectedDefect.mutantFinal, summary(mutant));
assert.deepEqual(results.injectedDefect.actions, defect.actions);
assert.deepEqual(results.injectedDefect.violation, defect.violation);
assert.equal(results.injectedDefect.visited, defect.visited);
assert.equal(results.injectedDefect.prefixes.length, defect.actions.length + 1);
for (const [length, prefix] of results.injectedDefect.prefixes.entries()) {
  const data = { ...defect.initial, actions: defect.actions.slice(0, length) };
  const expected = replay(data);
  const actual = replay(data, { mutant: true });
  assert.deepEqual(prefix.actions, data.actions);
  assert.deepEqual(prefix.strict, summary(expected));
  assert.deepEqual(prefix.mutant, summary(actual));
  assert.equal(prefix.fullStatesEqual, length < defect.actions.length);
  if (length < defect.actions.length) assert.deepEqual(expected, actual);
  else assert.notDeepEqual(expected, actual);
}
console.log(`Injected mutant: ${defect.actions.length}-step divergence and all shorter prefixes PASS.`);
console.log("Source bytes, generated artifact hashes, all four routes and strict defect control PASS.");
console.log("Local engine verification only; no browser or platform evidence is implied.");
