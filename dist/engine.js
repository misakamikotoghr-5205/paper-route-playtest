/** Original deterministic puzzle engine. No network, DOM, clock or randomness. */
export const VERSION = 1;
export const ACTIONS = Object.freeze(["up", "right", "down", "left"]);
const VECTORS = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] };
export const LEVELS = Object.freeze([
  {
    id: "first-mile",
    title: "01 · 第一封信",
    theme: "取件 → 同色投递 → 返回邮局",
    description:
      "一件包裹，一条完整回路。走进小写字母取件，送到对应的大写收件点。",
    budget: 18,
    map: ["#######", "#S..a.#", "#.#.#.#", "#...A.#", "#######"],
  },
  {
    id: "one-pocket",
    title: "02 · 只有一个口袋",
    theme: "背包容量为 1，安排取送顺序",
    description:
      "a 送往 A，b 送往 B。背包满时会经过取件点，但不会自动取走另一件。错误收件点不会收货。",
    budget: 38,
    map: [
      "#######",
      "#S.a.B#",
      "#.#.#.#",
      "#..b..#",
      "#.#.#.#",
      "#A....#",
      "#######",
    ],
  },
  {
    id: "folded-bridge",
    title: "03 · 折纸桥",
    theme: "经过开关，改变桥的通行状态",
    description:
      "走入圆形开关会切换所有折纸桥。桥关闭时无法进入，已经站在桥上时仍可离开。",
    budget: 24,
    map: ["#########", "#S.tg.aA#", "###.#####", "#.......#", "#########"],
  },
  {
    id: "last-collection",
    title: "04 · 末班收件",
    theme: "容量、桥与绕路一起规划",
    description:
      "两个包裹共用一个口袋。开关既能打开捷径，也会再次关闭它；保留回程所需的步数。",
    budget: 48,
    map: [
      "#########",
      "#S.a#g.B#",
      "#.#.#.#.#",
      "#..tg.b.#",
      "#.#.#.#.#",
      "#A......#",
      "#########",
    ],
  },
]);

export function normalizeSeed(value) {
  if (!/^\d{1,10}$/.test(String(value)))
    throw new Error("种子须为 0–4294967295 的整数。");
  const seed = Number(value);
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 4294967295)
    throw new Error("种子超出范围。");
  return seed;
}

export function getLevel(id, seed = 1) {
  const source = LEVELS.find((level) => level.id === id);
  if (!source) throw new Error("未知关卡。");
  seed = normalizeSeed(seed);
  // Seed chooses one of four mirrored variants; geometry remains authored and solvable.
  let map = source.map.map((row) => [...row]);
  if (seed & 1) map = map.map((row) => row.reverse());
  if (seed & 2) map.reverse();
  const parcels = [],
    gates = [],
    switches = [];
  let depot;
  map.forEach((row, y) =>
    row.forEach((tile, x) => {
      if (tile === "S") depot = { x, y };
      if (tile === "g") gates.push({ x, y });
      if (tile === "t") switches.push({ x, y });
      if (/^[ab]$/.test(tile))
        parcels.push({ id: tile, pickup: { x, y }, drop: null });
    }),
  );
  for (const parcel of parcels) {
    map.forEach((row, y) =>
      row.forEach((tile, x) => {
        if (tile === parcel.id.toUpperCase()) parcel.drop = { x, y };
      }),
    );
  }
  parcels.sort((a, b) => a.id.localeCompare(b.id));
  return {
    ...source,
    seed,
    map,
    width: map[0].length,
    height: map.length,
    parcels,
    depot,
    gates,
    switches,
    variant: seed % 4,
  };
}

export function createGame(levelId = LEVELS[0].id, seed = 1) {
  const level = getLevel(levelId, seed);
  return {
    version: VERSION,
    levelId,
    seed: level.seed,
    position: { ...level.depot },
    carry: null,
    delivered: [],
    gatesOpen: false,
    moves: 0,
    actions: [],
    events: [],
    phase: "active",
  };
}

export function move(state, action, { mutant = false } = {}) {
  if (!ACTIONS.includes(action)) throw new Error("未知动作。");
  if (state.phase !== "active")
    return { state, changed: false, reason: "本局已结束，请重置或撤销。" };
  const level = getLevel(state.levelId, state.seed);
  const [dx, dy] = VECTORS[action];
  const position = { x: state.position.x + dx, y: state.position.y + dy };
  const tile = level.map[position.y]?.[position.x] ?? "#";
  if (tile === "#")
    return { state, changed: false, reason: "这里是纸张边界或建筑。" };
  if (tile === "g" && !state.gatesOpen)
    return { state, changed: false, reason: "折纸桥关闭，先经过开关。" };
  const next = {
    ...state,
    position,
    delivered: [...state.delivered],
    actions: [...state.actions, action],
    events: [...state.events],
    moves: state.moves + 1,
  };
  const record = (type, parcel = null, valid = true) =>
    next.events.push({
      turn: next.moves,
      type,
      parcel,
      at: { ...position },
      valid,
    });
  if (tile === "t") {
    next.gatesOpen = !next.gatesOpen;
    record(next.gatesOpen ? "bridge-open" : "bridge-closed");
  }
  const pickup = level.parcels.find(
    (p) => p.pickup.x === position.x && p.pickup.y === position.y,
  );
  if (pickup && !next.carry && !next.delivered.includes(pickup.id)) {
    next.carry = pickup.id;
    record("pickup", pickup.id);
  }
  const dock = level.parcels.find(
    (p) => p.drop.x === position.x && p.drop.y === position.y,
  );
  if (dock && next.carry && (dock.id === next.carry || mutant)) {
    const parcel = next.carry;
    next.delivered.push(parcel);
    next.delivered.sort();
    next.carry = null;
    record("delivery", parcel, dock.id === parcel);
  }
  const home = position.x === level.depot.x && position.y === level.depot.y;
  if (next.delivered.length === level.parcels.length && home)
    next.phase = "won";
  else if (next.moves >= level.budget) next.phase = "lost";
  return {
    state: next,
    changed: true,
    reason:
      next.phase === "won"
        ? "全部送达，并已返回邮局！"
        : next.phase === "lost"
          ? "今天的步数用完了。可以撤销后重新规划。"
          : "已前进一步。",
  };
}

export function replay(data, options = {}) {
  if (
    !data ||
    typeof data !== "object" ||
    data.version !== VERSION ||
    !Array.isArray(data.actions) ||
    data.actions.length > 2000
  )
    throw new Error("重放文件格式或版本不正确。");
  let state = createGame(data.levelId, data.seed);
  for (const action of data.actions) {
    const result = move(state, action, options);
    if (!result.changed)
      throw new Error(`重放第 ${state.moves + 1} 步不合法：${result.reason}`);
    state = result.state;
  }
  return state;
}

export function undo(state) {
  return replay({
    version: VERSION,
    levelId: state.levelId,
    seed: state.seed,
    actions: state.actions.slice(0, -1),
  });
}

export function exportReplay(state) {
  return {
    format: "paper-route-replay",
    version: VERSION,
    levelId: state.levelId,
    seed: state.seed,
    variant: getLevel(state.levelId, state.seed).variant,
    actions: [...state.actions],
    result: {
      phase: state.phase,
      moves: state.moves,
      delivered: [...state.delivered],
    },
  };
}

function key(state) {
  return [
    state.position.x,
    state.position.y,
    state.carry ?? "-",
    state.delivered.join(""),
    Number(state.gatesOpen),
  ].join(":");
}

/** Breadth-first search: shortest valid remaining route, not a language model. */
export function plan(state, { maxNodes = 30000 } = {}) {
  if (state.phase === "won")
    return {
      status: "solved",
      actions: [],
      visited: 0,
      algorithm: "breadth-first search",
    };
  if (state.phase === "lost")
    return {
      status: "unreachable",
      actions: [],
      visited: 0,
      algorithm: "breadth-first search",
    };
  const queue = [{ state, path: [] }],
    seen = new Set([key(state)]);
  let cursor = 0;
  while (cursor < queue.length && cursor < maxNodes) {
    const current = queue[cursor++];
    for (const action of ACTIONS) {
      const result = move(current.state, action);
      if (!result.changed) continue;
      const path = [...current.path, action];
      if (result.state.phase === "won")
        return {
          status: "solved",
          actions: path,
          visited: cursor,
          algorithm: "breadth-first search",
        };
      if (result.state.phase === "lost") continue;
      const nextKey = key(result.state);
      if (!seen.has(nextKey)) {
        seen.add(nextKey);
        queue.push({ state: result.state, path });
      }
    }
  }
  return {
    status:
      cursor >= maxNodes && cursor < queue.length ? "limit" : "unreachable",
    actions: [],
    visited: cursor,
    algorithm: "breadth-first search",
  };
}

/** Find a real state divergence in a deliberately injected demo mutant. */
export function findDefect(seed = 1) {
  const initial = createGame("one-pocket", seed);
  const queue = [{ strict: initial, mutant: initial, actions: [] }];
  const seen = new Set([key(initial)]);
  let cursor = 0;
  while (cursor < queue.length && cursor < 15000) {
    const current = queue[cursor++];
    for (const action of ACTIONS) {
      const strict = move(current.strict, action),
        mutant = move(current.mutant, action, { mutant: true });
      if (!strict.changed || !mutant.changed) continue;
      const actions = [...current.actions, action];
      const violation = mutant.state.events.find(
        (event) => event.type === "delivery" && !event.valid,
      );
      if (violation)
        return {
          format: "paper-route-defect",
          version: VERSION,
          fixture: "injected-wrong-dock-v1",
          levelId: initial.levelId,
          seed: initial.seed,
          detected: true,
          visited: cursor,
          invariant: "包裹只允许投递至同字母收件点",
          actions,
          initial: exportReplay(initial),
          expected: {
            carry: strict.state.carry,
            delivered: strict.state.delivered,
            moves: strict.state.moves,
          },
          actual: {
            carry: mutant.state.carry,
            delivered: mutant.state.delivered,
            moves: mutant.state.moves,
          },
          violation,
          explanation:
            "演示变异体故意移除了收件点字母校验。严格版本保留包裹，演示变异体把它错误标记为送达。不是线上产品真实缺陷的声明。",
        };
      if (strict.state.phase !== "active") continue;
      const nextKey = key(strict.state);
      if (!seen.has(nextKey)) {
        seen.add(nextKey);
        queue.push({ strict: strict.state, mutant: mutant.state, actions });
      }
    }
  }
  return { detected: false, visited: cursor, seed: initial.seed };
}
