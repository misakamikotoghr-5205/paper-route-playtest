# ModelScope 创空间 Static 部署准备

核验 2026-11-05。ModelScope 官方维护的 [Studio部署说明](https://github.com/modelscope/modelscope-skills/blob/main/skills/ms-studio-deploy/SKILL.md) 在 SDK 表中列出 `static`：入口为已构建的 `index.html`，平台不执行构建。该源也说明 Docker 的 7860 端口和实名前置条件；本项目不需要 Docker、Gradio、GPU或模型密钥。

1. 在本地执行 `npm run verify`，检查 `dist/index.html` 与其相对路径资源。
2. 本人登录魔搭，创建新的创空间并选择 Static。依平台当前表单确认许可证、名称及可见性。
3. 上传 `dist/` **里面**的六个文件，空间根目录直接出现 `index.html`、`app.js`、`engine.js`、`styles.css`、`LICENSE`、`README.md`。
4. 先检查加载、四关、键盘/触屏、导入导出、缺陷实验，然后按赛事要求保证作品公开且可正常体验。
5. 将真实公开链接填写到赛事提交页面。赛事报名构想帖、手记、视频及审核另行完成。

这里仅准备静态文件，没有调用官方部署 API，没有创建空间或验证平台账户权限。当前浏览器对下载、本地存储或第三方 iframe 存储的限制会影响保存体验；存储失败时游戏继续，导出可留存。平台最新部署要求以官方页面与本人账户显示为准。

本机预览：`npm run dev` 默认5173；已有发布产物也可 `python3 -m http.server 5173 --directory dist --bind 127.0.0.1`。模块需通过 HTTP 加载；不是直接双击离线HTML的交付形式。
