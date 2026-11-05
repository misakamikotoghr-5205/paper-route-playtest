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
} from "./engine.js";

const $ = (id) => document.getElementById(id);
const NAMES = { up: "↑ 上", right: "→ 右", down: "↓ 下", left: "← 左" };
const SAVE_KEY = "paper-route-replay-v1";
const ARROW_KEYS = {
  ArrowUp: "up",
  ArrowRight: "right",
  ArrowDown: "down",
  ArrowLeft: "left",
  w: "up",
  d: "right",
  s: "down",
  a: "left",
};
let state = createGame(LEVELS[0].id, 20261105);
let timer = null;
let defect = null;
let defectIndex = 0;
let storageAvailable = true;

for (const level of LEVELS) {
  const option = document.createElement("option");
  option.value = level.id;
  option.textContent = level.title;
  $("level").append(option);
}

function status(message) {
  $("status").textContent = message;
}

function loadSave() {
  let raw;
  try {
    raw = localStorage.getItem(SAVE_KEY);
  } catch {
    storageAvailable = false;
    return;
  }
  if (!raw) return;
  try {
    const value = JSON.parse(raw);
    if (value.format !== "paper-route-replay") throw new Error("存档格式无效");
    state = replay(value);
    status("已从动作记录恢复上一局。");
  } catch {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      storageAvailable = false;
    }
    status("旧存档损坏，已开启新一局。你仍可导出重放。");
  }
}

function save() {
  if (storageAvailable) {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(exportReplay(state)));
    } catch {
      storageAvailable = false;
    }
  }
  $("save-status").textContent = storageAvailable
    ? "已自动保存到当前浏览器。"
    : "浏览器存储不可用，本局可继续；请导出重放留存。";
}

function stopAutoplay(message = "") {
  if (timer !== null) clearInterval(timer);
  timer = null;
  $("stop").hidden = true;
  $("autoplay").hidden = false;
  if (message) $("planner-status").textContent = message;
}

function describeTile(tile, x, y, game, level) {
  const labels = {
    "#": "建筑",
    ".": "道路",
    S: "邮局",
    t: "桥开关",
    g: game.gatesOpen ? "打开的桥" : "关闭的桥",
  };
  let description =
    labels[tile] ?? (/^[ab]$/.test(tile) ? `取件点 ${tile}` : `收件点 ${tile}`);
  if (game.position.x === x && game.position.y === y)
    description += "，派送员当前位置";
  const parcel = level.parcels.find((p) => p.drop.x === x && p.drop.y === y);
  if (parcel && game.delivered.includes(parcel.id)) description += "，已送达";
  return `第 ${y + 1} 行，第 ${x + 1} 列：${description}`;
}

function makeBoard(game, { miniature = false } = {}) {
  const level = getLevel(game.levelId, game.seed);
  const fragment = document.createDocumentFragment();
  level.map.forEach((row, y) =>
    row.forEach((tile, x) => {
      const cell = document.createElement(miniature ? "span" : "button");
      cell.className = "cell";
      cell.classList.toggle("wall", tile === "#");
      cell.classList.toggle("depot", tile === "S");
      cell.classList.toggle("parcel", /^[ab]$/.test(tile));
      cell.classList.toggle("dock", /^[AB]$/.test(tile));
      cell.classList.toggle("toggle", tile === "t");
      cell.classList.toggle("bridge", tile === "g");
      cell.classList.toggle("closed", tile === "g" && !game.gatesOpen);
      const pickup = level.parcels.find(
        (p) => p.pickup.x === x && p.pickup.y === y,
      );
      const dock = level.parcels.find((p) => p.drop.x === x && p.drop.y === y);
      if (
        pickup &&
        (game.carry === pickup.id || game.delivered.includes(pickup.id))
      )
        cell.classList.add("collected");
      if (dock && game.delivered.includes(dock.id))
        cell.classList.add("delivered");
      const label = document.createElement("span");
      label.textContent =
        { "#": "", ".": "", S: "〒", t: "⏻", g: game.gatesOpen ? "═" : "×" }[
          tile
        ] ?? tile;
      const occupied = game.position.x === x && game.position.y === y;
      if (occupied) label.className = "tile-label";
      cell.append(label);
      if (occupied) {
        const walker = document.createElement("span");
        walker.className = "walker";
        walker.setAttribute("aria-hidden", "true");
        cell.append(walker);
      }
      cell.setAttribute("aria-label", describeTile(tile, x, y, game, level));
      if (!miniature) {
        cell.dataset.x = x;
        cell.dataset.y = y;
        // The whole board is one keyboard stop; arrow keys perform movement.
        cell.tabIndex = -1;
        cell.type = "button";
      }
      fragment.append(cell);
    }),
  );
  return { fragment, width: level.width };
}

function render() {
  const level = getLevel(state.levelId, state.seed);
  $("level").value = state.levelId;
  $("seed").value = state.seed;
  $("level-heading").textContent = level.title;
  $("level-theme").textContent = level.theme;
  $("briefing").textContent = level.description;
  $("variant").textContent = `VARIANT 0${level.variant + 1}`;
  $("moves").replaceChildren(document.createTextNode(`${state.moves} `));
  const budget = document.createElement("small");
  budget.textContent = `/ ${level.budget}`;
  $("moves").append(budget);
  $("cargo").textContent = state.carry ? `包裹 ${state.carry}` : "空";
  $("delivered").textContent =
    `${state.delivered.length} / ${level.parcels.length}`;
  const board = makeBoard(state);
  $("board").style.setProperty("--cols", board.width);
  $("board").replaceChildren(board.fragment);
  $("bridge-state").textContent = level.gates.length
    ? `折纸桥 ${state.gatesOpen ? "已打开" : "已关闭"}`
    : "本关没有折纸桥";
  $("undo").disabled = state.actions.length === 0;
  $("hint").disabled = state.phase !== "active";
  $("autoplay").disabled = state.phase !== "active";
  for (const button of document.querySelectorAll("[data-move]"))
    button.disabled = state.phase !== "active";
  $("result").hidden = state.phase === "active";
  $("result").classList.toggle("failure", state.phase === "lost");
  $("result").textContent =
    state.phase === "won"
      ? `派送完成！${state.moves} 步送达全部包裹，并返回了邮局。导出这条路线，或继续下一关。`
      : "步数用完了。没有包裹会丢失；撤销一步，或重置后试试另一种顺序。";
  $("next-level").hidden =
    state.phase !== "won" || LEVELS.at(-1).id === state.levelId;
  const log = document.createDocumentFragment();
  state.actions.forEach((action, index) => {
    const item = document.createElement("li");
    item.textContent = `${index + 1}. ${NAMES[action]}`;
    item.title = state.events
      .filter((event) => event.turn === index + 1)
      .map((event) => `${event.type}${event.parcel ? ` ${event.parcel}` : ""}`)
      .join(" · ");
    log.append(item);
  });
  if (!state.actions.length) {
    const item = document.createElement("li");
    item.className = "empty";
    item.textContent = "尚未移动。非法动作不会消耗步数，也不会写入重放。";
    log.append(item);
  }
  $("action-log").replaceChildren(log);
  save();
}

function takeAction(action, { automatic = false } = {}) {
  if (!automatic) stopAutoplay("已暂停，交还给你。");
  const result = move(state, action);
  if (result.changed) {
    state = result.state;
    render();
  }
  status(result.reason);
  if (state.phase !== "active") {
    stopAutoplay(
      state.phase === "won"
        ? "规则试玩完成。所有动作都已记录，可导出复现。"
        : "步数已用完，规则试玩停止。",
    );
    $("result").focus({ preventScroll: true });
  }
}

function newGame(levelId, seed) {
  const next = createGame(levelId, seed);
  stopAutoplay("新一局已准备好。规划器会从当前状态重新搜索。");
  state = next;
  render();
  status("新派送单已准备好。送齐包裹后记得回到邮局。");
}

$("board").addEventListener("click", (event) => {
  const cell = event.target.closest("[data-x]");
  if (!cell) return;
  const dx = Number(cell.dataset.x) - state.position.x;
  const dy = Number(cell.dataset.y) - state.position.y;
  const action =
    dx === 0 && dy === -1
      ? "up"
      : dx === 1 && dy === 0
        ? "right"
        : dx === 0 && dy === 1
          ? "down"
          : dx === -1 && dy === 0
            ? "left"
            : null;
  if (action) takeAction(action);
  else status("请点派送员相邻的格子，或使用方向键。");
  $("board").focus({ preventScroll: true });
});
for (const button of document.querySelectorAll("[data-move]"))
  button.addEventListener("click", () => takeAction(button.dataset.move));
document.addEventListener("keydown", (event) => {
  if ($("help").open || event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target;
  if (
    target.closest("input,select,textarea,a,dialog") ||
    (target.closest("button") && !target.closest("#board"))
  )
    return;
  const action = ARROW_KEYS[event.key] ?? ARROW_KEYS[event.key.toLowerCase()];
  if (!action) return;
  event.preventDefault();
  takeAction(action);
});
$("level").addEventListener("change", () =>
  newGame($("level").value, state.seed),
);
$("apply-seed").addEventListener("click", () => {
  try {
    newGame(state.levelId, normalizeSeed($("seed").value));
  } catch (error) {
    status(error.message);
    $("seed").focus();
  }
});
$("seed").addEventListener("keydown", (event) => {
  if (event.key === "Enter") $("apply-seed").click();
});
$("reset").addEventListener("click", () => newGame(state.levelId, state.seed));
$("undo").addEventListener("click", () => {
  stopAutoplay("已撤销，原来的自动路线已停止。");
  state = undo(state);
  render();
  status("已撤销一步。之后的重放会记录当前路线分支。");
});
$("next-level").addEventListener("click", () => {
  const index = LEVELS.findIndex((level) => level.id === state.levelId);
  if (index + 1 < LEVELS.length) newGame(LEVELS[index + 1].id, state.seed);
});
$("hint").addEventListener("click", () => {
  stopAutoplay();
  const result = plan(state);
  status(
    result.status === "solved"
      ? `下一步试试 ${NAMES[result.actions[0]]}。当前最短剩余路线为 ${result.actions.length} 步。`
      : result.status === "limit"
        ? "搜索达到上限，未能确认路线。可撤销或重置。"
        : "剩余步数不足以完成。试试撤销一步，或从头调整取送顺序。",
  );
  $("planner-status").textContent =
    `广度优先搜索检查了 ${result.visited} 个状态。提示没有执行任何动作。`;
});
$("autoplay").addEventListener("click", () => {
  stopAutoplay();
  const result = plan(state);
  if (result.status !== "solved") {
    status("当前状态没有在剩余步数内找到解。可撤销或重置后再试。");
    return;
  }
  const pending = [...result.actions];
  $("planner-status").textContent =
    `检查了 ${result.visited} 个状态，找到 ${pending.length} 步最短路线。可随时暂停、手动操作或撤销。`;
  $("autoplay").hidden = true;
  $("stop").hidden = false;
  timer = setInterval(() => {
    if (!pending.length || state.phase !== "active") {
      stopAutoplay("规则试玩完成。");
      return;
    }
    takeAction(pending.shift(), { automatic: true });
  }, 350);
});
$("stop").addEventListener("click", () =>
  stopAutoplay("已暂停，路线记录仍然保留。再次点击规划将从当前状态重新搜索。"),
);
document.addEventListener("visibilitychange", () => {
  if (document.hidden && timer !== null)
    stopAutoplay("页面进入后台，已暂停试玩。");
});

function download(data, filename) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("export").addEventListener("click", () =>
  download(
    exportReplay(state),
    `paper-route-${state.levelId}-${state.seed}.json`,
  ),
);
$("import").addEventListener("click", () => {
  stopAutoplay();
  $("replay-file").click();
});
$("replay-file").addEventListener("change", async () => {
  const file = $("replay-file").files[0];
  $("replay-file").value = "";
  if (!file) return;
  try {
    if (file.size > 100000) throw new Error("重放文件请小于 100 KB。");
    const value = JSON.parse(await file.text());
    if (value.format !== "paper-route-replay")
      throw new Error("请选择纸路邮局的重放 JSON，不是缺陷报告。");
    const next = replay(value);
    stopAutoplay("已载入重放。成绩由严格规则重新计算。");
    state = next;
    render();
    status(`已验证并重放 ${state.moves} 步。文件中的成绩字段未被信任。`);
  } catch (error) {
    status(`导入失败：${error.message} 当前游戏已保留。`);
  }
});

function renderDefect() {
  const actions = defect.actions.slice(0, defectIndex);
  const strict = replay({ ...defect.initial, actions });
  const mutant = replay({ ...defect.initial, actions }, { mutant: true });
  const boards = document.createDocumentFragment();
  for (const [label, game] of [
    ["严格版本 · 正式规则", strict],
    ["演示变异体 · 门牌校验缺失", mutant],
  ]) {
    const panel = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = label;
    const board = document.createElement("div");
    board.className = "mini-board";
    const content = makeBoard(game, { miniature: true });
    board.style.setProperty("--cols", content.width);
    board.append(content.fragment);
    const caption = document.createElement("p");
    caption.textContent = `口袋 ${game.carry ?? "空"} / 已送达 ${game.delivered.join(", ") || "无"}`;
    panel.append(title, board, caption);
    boards.append(panel);
  }
  $("defect-boards").replaceChildren(boards);
  $("defect-step").textContent = `${defectIndex} / ${defect.actions.length} 步`;
  $("defect-back").disabled = defectIndex === 0;
  $("defect-forward").disabled = defectIndex === defect.actions.length;
  $("defect-detail").textContent =
    defectIndex === defect.actions.length
      ? `第 ${defectIndex} 步发生分歧：严格版拒绝把 ${defect.violation.parcel} 交给错误门牌，演示变异体却把它记为送达。规则搜索检查了 ${defect.visited} 个状态。`
      : `种子 ${defect.seed}，初态与动作完全相同。逐步前进，在投递发生时检查不变量。`;
  $("defect-actions").textContent = defect.actions
    .map(
      (action, index) =>
        `${index < defectIndex ? "✓" : "·"} ${index + 1}. ${NAMES[action]}`,
    )
    .join("   ");
}
$("find-defect").addEventListener("click", () => {
  stopAutoplay("已暂停试玩，正式游戏状态保留。");
  defect = findDefect(state.seed);
  if (!defect.detected) {
    status("演示缺陷搜索未能找到反例。");
    return;
  }
  defectIndex = 0;
  $("defect-empty").hidden = true;
  $("defect-view").hidden = false;
  renderDefect();
});
$("defect-back").addEventListener("click", () => {
  if (defectIndex > 0) {
    defectIndex--;
    renderDefect();
  }
});
$("defect-forward").addEventListener("click", () => {
  if (defectIndex < defect.actions.length) {
    defectIndex++;
    renderDefect();
  }
});
$("defect-export").addEventListener("click", () => {
  if (defect)
    download(defect, `paper-route-injected-defect-${defect.seed}.json`);
});
$("help-open").addEventListener("click", () => {
  stopAutoplay("阅读帮助时已暂停试玩。");
  $("help").showModal();
});
$("help-close").addEventListener("click", () => $("help").close());
loadSave();
render();
