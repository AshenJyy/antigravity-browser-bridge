# Browser Bridge

让 **DeepSeek Harness Desktop v0.2.1-rc.3 和 Antigravity App**直接操作日常使用、已经登录的 Microsoft Edge。DSH 使用原生插件注册工具，Antigravity App 使用 MCP 插件；两端共用本地桥接与 Edge 扩展。基于原 Antigravity Browser Bridge 重构，保留 Apache-2.0 许可和原项目来源。

**v2.0.1 发布状态：已实现并打包，按要求未运行测试或双宿主端到端验收。**

## 安装

下载 [v2.0.1 发布包](https://github.com/AshenJyy/antigravity-browser-bridge/releases/tag/v2.0.1)，完整步骤见 [中文安装说明](docs/INSTALL.zh-CN.md)。

- DSH：下载 [dsh-browser-bridge-2.0.1.tgz](https://github.com/AshenJyy/antigravity-browser-bridge/releases/download/v2.0.1/dsh-browser-bridge-2.0.1.tgz)，在插件管理中添加本地包，使用官方 `dsh.bundle.patch` / Cordis 插件格式。当前 DSH 对话直接调用 `browser_*` 工具。
- Antigravity App：下载并解压 [browser-bridge-antigravity-2.0.1.zip](https://github.com/AshenJyy/antigravity-browser-bridge/releases/download/v2.0.1/browser-bridge-antigravity-2.0.1.zip)，运行 `scripts/Install-Antigravity.ps1`，重启 App。安装器配置 App 官方全局插件目录和本地 MCP 服务。
- Edge：在 `edge://extensions` 加载 `extension/`，运行 `scripts/BrowserBridge.ps1 pair`，在扩展弹窗填写本地配对 token。

发布 ZIP 自带打包后的 JavaScript 运行文件，无需额外安装 Python 或 npm 依赖。需要 Node.js 22+；Windows 脚本可使用 DSH 自带 Node 运行时。源码开发使用 Node.js 与 npm/pnpm。

## 能力

27 个统一 `browser_*` 工具覆盖标签页管理、正文与结构化快照、指定标签截图、DOM/坐标点击、悬停、输入、按键、滚动、下拉选择、导航、等待、上传、下载与对话框。DSH 通过官方多模态附件适配返回截图；Antigravity 通过标准 MCP image block 返回。

- 复用真实 Edge 的登录状态，以扩展持久实例 ID 区分多个配置。
- 标签句柄包含实例身份，操作前须新建或明确接管；无活动页隐式回退。
- DSH 按 Agent/Session、Antigravity 按 MCP 进程隔离；共享 MCP 进程的聊天不自动获得独立身份。
- 按任务显示标签组，关闭/释放均有明确动作；释放不会关闭用户页面。
- 本地 token 配对、HTTP/WS 来源检查、串行执行、断线重连及不重放副作用的错误处理。

浏览器内部页、原生系统窗口、封闭组件等受浏览器接口限制。截图需要宿主模型支持图像。工具结果会交给宿主模型，不能宣称“网页内容绝不离开本机”。详细范围及未验收项见安装说明。

## 架构

```mermaid
flowchart LR
  D[DSH native tools] --> B[Shared Node bridge]
  A[Antigravity App] --> M[MCP stdio adapter]
  M --> B
  C[CLI] --> B
  B <-->|Authenticated WebSocket| E[Edge MV3 extension]
  E --> T[Real browser tabs]
```

默认监听 `127.0.0.1:9224`，按需后台启动。Windows 状态与 token 默认放在 `%USERPROFILE%\.browser-bridge`，避开桌面应用的 AppData 路径重定向；升级时会保留并迁移有效的旧默认令牌。`BROWSER_BRIDGE_PORT`、`BROWSER_BRIDGE_DATA_DIR` 可配置，DSH 原生插件也提供 `port`、`dataDir` 配置项。两端须使用相同设置，正常只需配对一次。

协议见 [PROTOCOL.md](docs/PROTOCOL.md)，Agent 操作说明见 [SKILL.md](skills/browser-bridge/SKILL.md)。v1 HTTP 路由和数字标签 ID 已退役；旧 Python 入口只转发至 Node，新 CLI 参数见 `--help`。

## 构建

```powershell
pnpm install --frozen-lockfile
node scripts/build.mjs
py scripts/package_release.py --output work/releases
```

构建生成独立 runtime；打包生成 npm-compatible DSH `.tgz` 和 Antigravity `.zip`，不安装、不启动宿主、不调用模型。仓库包含开发测试文件，但本次发布未执行测试。

## English

Browser Bridge gives DSH Desktop 0.2.1-rc.3 and Antigravity App direct access to the user's real Edge profile. DSH calls native plugin tools; Antigravity App uses stdio MCP. Both connect to the same authenticated local bridge and MV3 extension. Select or claim explicit tab handles; no command silently acts on the active page. Screenshots are actual image tool results. Windows hosts share `%USERPROFILE%\.browser-bridge` state. Version 2.0.1 has not undergone automated tests or end-to-end host acceptance. Download the packages from the [v2.0.1 release](https://github.com/AshenJyy/antigravity-browser-bridge/releases/tag/v2.0.1).

Original project: [AshenJyy/antigravity-browser-bridge](https://github.com/AshenJyy/antigravity-browser-bridge). License: [Apache-2.0](LICENSE).
