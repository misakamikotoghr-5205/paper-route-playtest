import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIONS,
  LEVELS,
  createGame,
  exportReplay,
  findDefect,
  getLevel,
  move,
  normalizeSeed,
  plan,
  replay,
  undo,
} from "../engine.js";
function walk(state, actions, options) {
  for (const action of actions) {
    const result = move(state, action, options);
    assert(result.changed, `Expected legal ${action}: ${result.reason}`);
    state = result.state;
  }
  return state;
}
test("four authored levels in four mirrored variants finish within budget", () => {
  const expectedShortest = [12, 20, 12, 28];
  LEVELS.forEach((level, index) => {
    for (let seed = 0; seed < 4; seed++) {
      const initial = createGame(level.id, seed),
        solution = plan(initial);
      assert.equal(solution.status, "solved", `${level.id}/${seed}`);
      assert.equal(solution.actions.length, expectedShortest[index]);
      const final = walk(initial, solution.actions);
      assert.equal(final.phase, "won");
      assert.deepEqual(final.position, getLevel(level.id, seed).depot);
      assert.equal(
        final.delivered.length,
        getLevel(level.id, seed).parcels.length,
      );
      assert(
        final.events
          .filter((event) => event.type === "delivery")
          .every((event) => event.valid),
      );
    }
  });
});
test("walls do not spend moves, mutate input or write trace actions", () => {
  const initial = createGame("first-mile", 0),
    snapshot = structuredClone(initial);
  const result = move(initial, "up");
  assert.equal(result.changed, false);
  assert.deepEqual(initial, snapshot);
  assert.equal(result.state, initial);
});
test("capacity one prevents collecting second parcel while carrying first", () => {
  const state = walk(createGame("one-pocket", 0), [
    "right",
    "right",
    "down",
    "down",
  ]);
  assert.equal(state.carry, "a");
  assert.equal(
    state.events.filter((event) => event.type === "pickup").length,
    1,
  );
  assert.deepEqual(state.delivered, []);
});
test("wrong dock rejects parcel without falsely marking it delivered", () => {
  const state = walk(createGame("one-pocket", 1), [
    "left",
    "left",
    "left",
    "left",
  ]);
  assert.equal(state.carry, "a");
  assert.deepEqual(state.delivered, []);
  assert.equal(
    state.events.filter((event) => event.type === "delivery").length,
    0,
  );
});
test("switch opens bridge and re-entering switch closes it", () => {
  let state = walk(createGame("folded-bridge", 0), ["right", "right"]);
  assert.equal(state.gatesOpen, true);
  state = walk(state, ["right", "left"]);
  assert.equal(state.gatesOpen, false);
  const blocked = move(state, "right");
  assert.equal(blocked.changed, false);
  assert.equal(blocked.state.moves, 4);
});
test("all delivered is insufficient until courier returns to depot", () => {
  const initial = createGame("first-mile", 0),
    solution = plan(initial);
  const beforeHome = walk(initial, solution.actions.slice(0, -1));
  assert.equal(beforeHome.delivered.length, 1);
  assert.equal(beforeHome.phase, "active");
  assert.equal(move(beforeHome, solution.actions.at(-1)).state.phase, "won");
});
test("budget creates a loss; terminal state cannot be advanced", () => {
  const initial = createGame("first-mile", 0);
  const state = walk(
    initial,
    Array.from({ length: 18 }, (_, index) => (index % 2 ? "left" : "right")),
  );
  assert.equal(state.phase, "lost");
  assert.equal(move(state, "right").changed, false);
  assert.equal(plan(state).status, "unreachable");
  assert.equal(undo(state).phase, "active");
});
test("undo restores inventory, position, gates and events by strict replay", () => {
  const initial = createGame("folded-bridge", 0),
    before = walk(initial, ["right"]);
  const after = walk(before, ["right"]);
  assert.equal(after.gatesOpen, true);
  assert.deepEqual(undo(after), before);
  assert.deepEqual(undo(initial), initial);
});
test("winning is terminal but can be undone into a valid active state", () => {
  const initial = createGame(),
    won = walk(initial, plan(initial).actions);
  assert.equal(move(won, "up").changed, false);
  assert.equal(plan(won).actions.length, 0);
  assert.equal(undo(won).phase, "active");
});
test("replay ignores claimed outcome and recomputes all state from actions", () => {
  const initial = createGame("one-pocket", 4294967295),
    won = walk(initial, plan(initial).actions);
  const data = exportReplay(won);
  data.result = { phase: "lost", moves: -50, delivered: [] };
  assert.deepEqual(replay(JSON.parse(JSON.stringify(data))), won);
  assert.deepEqual(replay(exportReplay(initial)), initial);
});
test("replay rejects bad actions, over-budget continuation, levels and huge histories", () => {
  const valid = exportReplay(createGame("first-mile", 0));
  assert.throws(() => replay({ ...valid, actions: ["teleport"] }));
  assert.throws(() => replay({ ...valid, actions: ["up"] }));
  assert.throws(() => replay({ ...valid, actions: Array(2001).fill("right") }));
  assert.throws(() =>
    replay({
      ...valid,
      actions: Array.from({ length: 20 }, (_, i) => (i % 2 ? "left" : "right")),
    }),
  );
  assert.throws(() => replay({ ...valid, levelId: "../unknown" }));
  assert.throws(() => replay({ ...valid, version: 999 }));
  assert.throws(() => replay(null));
});
test("seeds are bounded integers and select only documented mirrored variants", () => {
  for (const seed of [0, 1, 2, 3, 4, 20261105, 4294967295]) {
    assert.equal(normalizeSeed(seed), seed);
    assert.equal(getLevel("first-mile", seed).variant, seed % 4);
  }
  assert.deepEqual(
    getLevel("first-mile", 0).map,
    getLevel("first-mile", 4).map,
  );
  for (const seed of [-1, 4294967296, 1.3, "", "1e3", "NaN", null, Infinity])
    assert.throws(() => normalizeSeed(seed));
});
test("planner is deterministic, read-only and reports capped search honestly", () => {
  const initial = createGame("last-collection", 123),
    snapshot = structuredClone(initial);
  assert.deepEqual(plan(initial), plan(initial));
  assert.deepEqual(initial, snapshot);
  assert.equal(plan(initial, { maxNodes: 1 }).status, "limit");
  assert(plan(initial).actions.every((action) => ACTIONS.includes(action)));
});
test("planner respects remaining budget and replans from partially played state", () => {
  const initial = createGame("first-mile", 0),
    after = walk(initial, ["right", "right"]);
  assert.equal(walk(after, plan(after).actions).phase, "won");
  const delayed = walk(
    initial,
    Array.from({ length: 8 }, (_, i) => (i % 2 ? "left" : "right")),
  );
  assert.equal(plan(delayed).status, "unreachable");
});
test("defect search produces a real reproducible divergence for all variants", () => {
  for (let seed = 0; seed < 4; seed++) {
    const defect = findDefect(seed);
    assert.equal(defect.detected, true);
    assert.equal(defect.fixture, "injected-wrong-dock-v1");
    const data = { ...defect.initial, actions: defect.actions };
    const strict = replay(data),
      mutant = replay(data, { mutant: true });
    assert.equal(strict.carry, "a");
    assert.deepEqual(strict.delivered, []);
    assert.equal(mutant.carry, null);
    assert.deepEqual(mutant.delivered, ["a"]);
    assert(
      mutant.events.some((event) => event.type === "delivery" && !event.valid),
    );
    for (let n = 0; n < defect.actions.length; n++) {
      const prefix = { ...data, actions: data.actions.slice(0, n) };
      assert.deepEqual(replay(prefix), replay(prefix, { mutant: true }));
    }
    assert.deepEqual(findDefect(seed), defect);
  }
});
