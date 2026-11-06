/** Run the existing engine and write reviewable local evidence; never modify runtime code. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  VERSION,
  LEVELS,
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
const args = process.argv.slice(2);
assert(
  args.length === 0 || (args.length === 2 && args[0] === "--out"),
  "Usage: node docs/evidence/generate.mjs [--out DIRECTORY]",
);
const out = args.length ? resolve(args[1]) : here;
const seed = 20261106;
const generatedAt = new Date().toISOString();
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const git = (...gitArgs) =>
  execFileSync("git", ["-C", root, ...gitArgs], { encoding: "utf8" }).trim();
const sourceCommit = git("rev-parse", "HEAD");
const sourceFiles = [
  "engine.js",
  "app.js",
  "index.html",
  "styles.css",
  "package.json",
  "scripts/check.js",
  "scripts/build.js",
  "tests/engine.test.js",
];
const sources = [];
for (const path of sourceFiles) {
  const data = await readFile(join(root, path));
  const committed = execFileSync("git", ["-C", root, "show", `${sourceCommit}:${path}`]);
  assert(data.equals(committed), `${path} differs from recorded source HEAD`);
  sources.push({ path, bytes: data.length, sha256: sha256(data) });
}

const generatedFiles = [];
async function save(path, value) {
  const data = Buffer.from(
    typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`,
  );
  await mkdir(dirname(join(out, path)), { recursive: true });
  await writeFile(join(out, path), data);
  generatedFiles.push({ path, bytes: data.length, sha256: sha256(data) });
}

function summarize(state) {
  return {
    position: { ...state.position },
    carry: state.carry,
    delivered: [...state.delivered],
    gatesOpen: state.gatesOpen,
    moves: state.moves,
    phase: state.phase,
  };
}

const wins = [];
const logs = [
  "Paper Route — actual local Node.js engine run",
  `Generated at: ${generatedAt}`,
  `Source HEAD: ${sourceCommit}`,
  `Engine version: ${VERSION}; Node.js: ${process.version}`,
  `Fixed seed: ${seed}; mirror variant: ${seed % 4}`,
  "No browser, network, account, online model or platform deployment used.",
  "",
];

for (const level of LEVELS) {
  const initial = createGame(level.id, seed);
  const initialSnapshot = structuredClone(initial);
  const solution = plan(initial);
  assert.equal(solution.status, "solved", `${level.id} has no solution`);
  assert.deepEqual(initial, initialSnapshot, "Planner must not mutate initial state");
  assert.deepEqual(solution, plan(initial), "Planner must be deterministic");

  let state = initial;
  const steps = [];
  for (const action of solution.actions) {
    const result = move(state, action);
    assert(result.changed, `${level.id}: illegal move ${action}`);
    const newEvents = result.state.events.slice(state.events.length);
    state = result.state;
    steps.push({ action, ...summarize(state), events: newEvents });
  }
  const authored = getLevel(level.id, seed);
  assert.equal(state.phase, "won");
  assert.deepEqual(state.position, authored.depot);
  assert.equal(state.carry, null);
  assert.deepEqual(state.delivered, authored.parcels.map((parcel) => parcel.id));
  assert(state.moves <= authored.budget);
  assert(state.events.every((event) => event.valid));

  const exported = exportReplay(state);
  assert.deepEqual(replay(JSON.parse(JSON.stringify(exported))), state);
  // A claimed result is not trusted by the game importer.
  assert.deepEqual(
    replay({ ...exported, result: { phase: "lost", moves: -1, delivered: [] } }),
    state,
  );
  const path = `replays/${level.id}-seed-${seed}.json`;
  await save(path, exported);
  wins.push({
    levelId: level.id,
    seed,
    variant: authored.variant,
    replayPath: path,
    budget: authored.budget,
    planner: {
      algorithm: solution.algorithm,
      status: solution.status,
      visited: solution.visited,
    },
    actions: [...solution.actions],
    initial: summarize(initial),
    final: summarize(state),
    steps,
    strictRoundTripEqual: true,
    claimedResultIgnored: true,
  });
  logs.push(
    `${level.id}: ${state.phase}; ${state.moves}/${authored.budget} moves; ` +
      `delivered=${state.delivered.join(",")}; planner visited=${solution.visited}; ` +
      "strict JSON round-trip PASS; falsified result ignored PASS",
  );
}

const defect = findDefect(seed);
assert.equal(defect.detected, true);
assert.equal(defect.fixture, "injected-wrong-dock-v1");
assert.deepEqual(findDefect(seed), defect);
const defectInput = { ...defect.initial, actions: defect.actions };
const strict = replay(defectInput);
const mutant = replay(defectInput, { mutant: true });
const reportState = (state) => ({
  carry: state.carry,
  delivered: state.delivered,
  moves: state.moves,
});
assert.deepEqual(reportState(strict), defect.expected);
assert.deepEqual(reportState(mutant), defect.actual);
assert.equal(strict.carry, "a");
assert.deepEqual(strict.delivered, []);
assert.equal(mutant.carry, null);
assert.deepEqual(mutant.delivered, ["a"]);
assert.deepEqual(
  mutant.events.find((event) => event.type === "delivery" && !event.valid),
  defect.violation,
);

const prefixes = [];
for (let length = 0; length <= defect.actions.length; length++) {
  const input = { ...defect.initial, actions: defect.actions.slice(0, length) };
  const expected = replay(input);
  const actual = replay(input, { mutant: true });
  const equal = JSON.stringify(expected) === JSON.stringify(actual);
  assert.equal(equal, length < defect.actions.length);
  prefixes.push({
    actions: [...input.actions],
    strict: summarize(expected),
    mutant: summarize(actual),
    fullStatesEqual: equal,
  });
}

await save(`defects/injected-wrong-dock-seed-${seed}.json`, defect);
await save(
  `defects/injected-wrong-dock-seed-${seed}-strict-replay.json`,
  exportReplay(strict),
);
await save("run-results.json", {
  format: "paper-route-local-evidence",
  version: 1,
  generatedAt,
  sourceCommit,
  engineVersion: VERSION,
  seed,
  scope: "Actual deterministic engine execution, not browser or hosted-platform evidence",
  winningRuns: wins,
  injectedDefect: {
    fixture: defect.fixture,
    seed,
    actions: [...defect.actions],
    visited: defect.visited,
    initial: summarize(createGame(defect.levelId, seed)),
    strictFinal: summarize(strict),
    mutantFinal: summarize(mutant),
    violation: defect.violation,
    prefixes,
    claims: {
      deliberatelyInjected: true,
      productionBugDiscovered: false,
      llmEvaluation: false,
    },
  },
});
logs.push(
  "",
  `Injected defect: detected after ${defect.actions.length} moves; ` +
    `searched ${defect.visited} states; strict carry=${strict.carry}, ` +
    `delivered=${JSON.stringify(strict.delivered)}; mutant carry=${mutant.carry}, ` +
    `delivered=${JSON.stringify(mutant.delivered)}`,
  `All ${defect.actions.length} shorter prefixes have identical complete states; ` +
    "final prefix diverges PASS.",
  "This is a deliberate isolated wrong-dock mutation, not a discovered production bug.",
  "Four winning replay exports and one strict defect control satisfy the documented game-import format.",
  "The defect report itself is not a game-import file.",
  "No browser import, restore UI, screen recording or ModelScope upload was performed.",
  "All local evidence assertions PASS.",
);
await save("run.log", `${logs.join("\n")}\n`);

const generatorData = await readFile(fileURLToPath(import.meta.url));
const manifest = {
  format: "paper-route-evidence-manifest",
  version: 1,
  generatedAt,
  source: {
    commit: sourceCommit,
    committedAt: git("show", "-s", "--format=%cI", sourceCommit),
    note: "Source files below exactly matched this local HEAD before generation; evidence files are a later working-tree addition, not part of that commit.",
    files: sources,
  },
  runtime: { node: process.version, engineVersion: VERSION },
  generator: {
    path: relative(root, fileURLToPath(import.meta.url)).replaceAll("\\", "/"),
    bytes: generatorData.length,
    sha256: sha256(generatorData),
  },
  fixedSeed: seed,
  mirrorVariant: seed % 4,
  files: generatedFiles,
  limitations: [
    "Seed selects one of four authored mirror variants, not a procedurally generated map.",
    "Planning and defect search use deterministic breadth-first search, not an LLM.",
    "No browser, UI import, localStorage restore, screen recording, user study or platform execution is evidenced by this run.",
    "The wrong-dock defect is deliberately injected and isolated from normal gameplay.",
    "Hashes identify bytes; they are not signatures or independent third-party attestation.",
  ],
};
await writeFile(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(logs.join("\n"));
