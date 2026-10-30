# 安装 Browser Bridge 2.0

本版用于 **DeepSeek Harness Desktop 和 Antigravity App**。DSH 宿主与 `@deepseek-ai/dsh-mcp-client` peer 依赖均声明 `>=0.2.1-rc.3 <=0.2.1`，允许 rc.3 及后续 `0.2.1-rc.*` 和 `0.2.1` 正式版，无需逐个登记版本；不包含 `0.2.2` 及其他版本。两端独立调用浏览器工具，通过同一扩展操作日常 Edge 的标签页和登录状态。v2.0.2 已实现并打包，按要求未运行测试、逐版本验证或双宿主端到端验收。

## 1. 安装 DSH 插件

从 [v2.0.2 发布页](https://github.com/AshenJyy/browser-bridge/releases/tag/v2.0.2) 下载 `dsh-browser-bridge-2.0.2.tgz`，在 DSH Desktop 的插件管理界面中添加本地包，然后重启相关工作配置/服务。该包使用官方 npm bundle 格式：`package.json` 的 `dsh.bundle.patch`、`cordis.patch.yml`、原生工具入口和 `engines.dsh` 版本约束。安装包通过 GitHub Releases 分发，尚未发布到 npm。

DSH 当前对话直接获得 `browser_*` 工具；截图通过 DSH 官方附件接口作为图像返回。所选模型本身需要支持图像。无需安装或调用其他应用的子代理。DSH 会从其运行时提供 `@deepseek-ai/dsh-mcp-client` 等 peer 依赖。

## 2. 安装 Antigravity App 插件

解压 `browser-bridge-antigravity-2.0.2.zip`。在解压出的 `browser-bridge` 目录中执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Install-Antigravity.ps1
```

脚本找到 Node.js 22+（优先 DSH 自带运行时，其次 PATH），将插件放入 App 官方全局目录 `%USERPROFILE%\.gemini\config\plugins\browser-bridge`，写入 Node 路径、端口与共享状态目录。已有插件目录会先备份到插件扫描目录之外。安装完成后重启 Antigravity App。

可指定 Node 与共享配置；若更改端口或状态目录，请同时在 DSH 的 Browser Bridge 插件配置中设置相同的 `port` 和 `dataDir`：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Install-Antigravity.ps1 -NodePath 'D:\tools\node.exe' -DataDirectory 'D:\BrowserBridgeState' -Port 9224
```

若 App 的插件自动发现受版本或配置限制，可在 App 的 MCP 设置中添加本地服务：command 使用 Node 可执行文件的绝对路径，args 使用安装目录下 `runtime\mcp.mjs` 的绝对路径；不要把 `${PLUGIN_ROOT}` 原样写入普通全局 MCP 配置，该变量仅在插件上下文展开。避免同一宿主同时启用重复 MCP 服务。

## 3. 在日常 Edge 中加载扩展并配对

1. 关闭旧版 Browser Bridge 的后台服务，停用旧扩展，以免占用 9224 端口。
2. 打开 `edge://extensions`，启用开发者模式，选择“加载解压缩的扩展”，选中安装目录或解压目录的 `extension` 文件夹。升级同一路径的现有扩展时点击“重新加载”。
3. 在插件目录执行：

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\BrowserBridge.ps1 pair
   ```

4. 将输出的 token 和连接端口填入 Edge 扩展弹窗并连接。配对 token 只在本机使用，勿发到聊天或网页。

两端默认共用 `%USERPROFILE%\.browser-bridge` 的服务状态和 token，以及 `127.0.0.1:9224`。此目录避开 Windows 打包应用的 AppData 路径重定向。首次工具调用会隐藏启动后台服务，不需要常驻终端。多个 Edge 配置各自加载扩展、使用同一 token；实例 ID 会独立保存。

从 2.0.0 升级时，先升级 DSH 插件并重跑 App 安装器，再执行下面的配对修复。新默认目录没有令牌时会迁移当前环境可见的 `%LOCALAPPDATA%\BrowserBridge\token`，旧文件保留；新令牌已存在时不会覆盖。若过去不同环境生成过不同令牌，以新统一目录为准，将其在扩展中更新一次即可。

正常只需配对一次。重启电脑、Edge 或宿主后会使用已保存的令牌重连；清除扩展数据、更换浏览器配置或更换服务端令牌后才需要重新配对。

如果令牌文件缺失后出现 `BRIDGE_PORT_IN_USE` 或 `BRIDGE_AUTH_MISMATCH`，运行一次配对修复：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Repair-Pairing.ps1
```

它保留现有令牌，只停止入口路径明确属于本项目、App 安装目录或 DSH desktop 配置中本插件的旧桥接进程，再启动新版并显示令牌。遇到无关进程占用端口时会报错并退出。此操作会中断现有 Browser Bridge 会话；更新后重启 DSH 和 Antigravity App。自定义状态目录或端口时，先设置相同的 `BROWSER_BRIDGE_DATA_DIR` 和 `BROWSER_BRIDGE_PORT` 环境变量再执行配对命令。

## 使用

让 Agent 查看标签页，选择返回的标签句柄后明确接管，或直接打开新标签页。例如：“在 Edge 中打开这个网址，读取页面并截图。”已有标签页不会因列举而被接管。每次操作都指定完整句柄；其他会话持有的标签页不能被抢占。

DSH 按 Agent/Session 分开归属，Antigravity 按 MCP 进程分开归属；不同 App 聊天是否创建独立 MCP 进程由宿主决定，本包不假定每个聊天一定对应独立进程。退出时可调用 `browser_session_close` 解除归属、保留页面。

命令行也可使用：

```powershell
.\scripts\BrowserBridge.ps1 status
.\scripts\BrowserBridge.ps1 tabs
.\scripts\BrowserBridge.ps1 open https://example.com --session task-a
.\scripts\BrowserBridge.ps1 snapshot '<返回的完整tab句柄>' --session task-a
.\scripts\BrowserBridge.ps1 screenshot '<返回的完整tab句柄>' --session task-a -o page.png
.\scripts\BrowserBridge.ps1 session-close --session task-a
```

## 范围与限制

- 读网页、快照、真实标签截图、点击/悬停/输入/键盘/滚动/下拉选择、导航、等待、文件输入上传、发起下载和 JavaScript 对话框均已实现，v2.0.2 尚未运行功能测试。
- Edge 内部页、扩展商店保护页及浏览器原生 UI 受 Chromium 限制；本工具不是整个 Windows 桌面的操控工具。
- 扩展要求 Edge 125+。快照一次读取一个 frame，返回 frame 列表后可明确选择；支持开放 Shadow DOM，封闭 Shadow DOM 不在当前范围。无法可靠换算坐标的变换 iframe 会返回错误。
- 高级 evaluate 若直接触发同步 JavaScript 对话框，可能阻塞求值；此类场景优先正常点击后调用 dialog。
- 文件上传作用于网页 file input；下载工具管理由此工具发起的下载，默认保存在 Edge 下载目录。普通网页点击触发的下载不自动归入下载列表。
- 接管时可能看到 Edge 原生调试提示条。DevTools、其他调试扩展或手动解除接管可能影响当前连接，需重新明确接管。
- 断线或超时不会自动重放点击、提交等动作；检查页面状态后再决定下一步。释放会话保持页面，关闭页面须明确调用 close。
- DOM/截图会作为工具结果交给所用宿主与模型；“本地桥接”仅表示没有额外云端中继，不表示宿主绝不会将结果发送到模型服务。
- v1 的数字 tabId、无鉴权 HTTP 路由及 9223 WebSocket 不再使用。Python 文件仅保留迁移启动入口，CLI 参数以新版 `--help` 为准。

## 来源

- [DSH rc.3 官方插件格式](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.3/docs/user/develop/basic/publish.md)
- [Antigravity App 插件安装](https://antigravity.google/docs/plugins)
- [Antigravity MCP](https://antigravity.google/docs/mcp)
- [Edge 扩展旁加载](https://learn.microsoft.com/en-us/microsoft-edge/extensions/getting-started/extension-sideloading)
