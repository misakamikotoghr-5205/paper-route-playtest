import { cp, mkdir, rm, writeFile } from "node:fs/promises";
const root = new URL("../", import.meta.url);
const dist = new URL("dist/", root);
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const file of [
  "index.html",
  "styles.css",
  "app.js",
  "engine.js",
  "LICENSE",
])
  await cp(new URL(file, root), new URL(file, dist));
await writeFile(
  new URL("README.md", dist),
  "# 纸路邮局 / Paper Route\n\n纯静态原创解谜游戏。请选择 ModelScope Static 类型，将本目录内容放在空间根目录。\n\n规则试玩员使用广度优先搜索，不调用语言模型。AI 辅助开发使用 Codex；未使用或声称使用 Qoder。尚未在 ModelScope 创建空间、报名、发布公开帖或提交赛事。\n",
);
console.log("Built dist/: 6 static files. No runtime network dependencies.");
