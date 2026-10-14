# 更新日志 / Changelog 📝

本文档记录 **Antigravity Browser Bridge** 的所有重大版本更新与改动。
本项目遵循 [Semantic Versioning (语义化版本)](https://semver.org/lang/zh-CN/) 规范。

---

## [v1.4.0] - 2026-10-14 🚀

### ✨ 新特性 / Added
- 🌐 **智能中英双语自适应 UI (Bilingual Adaptive i18n)**:
  - 自动侦测浏览器系统语言：中文环境下原生呈现简体中文，英文及其他语言环境下自动呈现英文。
  - 弹窗右上角新增一键手动切换语言按钮（`[English / 中文]`），用户选择自动在 `chrome.storage.local` 中持久化保存。
  - 按钮、连接状态、当前页面信息、说明文案全面支持多语言动态映射。
- 🔀 **多浏览器并发连接与智能路由 (Concurrent Multi-Browser Routing)**:
  - 重构 `server.py` WebSocket 守护进程，支持 **Microsoft Edge** 与 **Google Chrome** 扩展同时接入，不再互相顶替抢占。
  - 引入全局标签页与浏览器映射表（`tab_to_browser`），执行点击、求值、快照等指令时自动精准分发到对应浏览器。
  - `cli.py tabs` 输出自动增加浏览器前缀标识（`[Edge]` / `[Chrome]`），并默认将 Microsoft Edge 设为首选浏览器。
- ⚡ **原生 CDP 原生调试指令支持 (Raw CDP Integration)**:
  - CLI 工具新增 `py server/cli.py cdp <tabId> <Method> '<params_json>'` 指令，支持直接向目标标签页下发底层 Chrome DevTools Protocol 协议指令。

### 🔧 优化与改进 / Changed
- 📦 **动态版本联动机制**:
  - `extension/background.js` 改为动态读取 `chrome.runtime.getManifest().version`，彻底杜绝版本号不同步问题。
  - 升级 `manifest.json` 版本至 `1.4.0`。
- 📄 **商店与 PR 规范对齐**:
  - 微软 Edge 扩展商店（Edge Add-ons）详情页与审核指导书更新为双语对照说明。
  - 同步更新向 `agentic-awesome-skills` 提交的官方 Pull Request (#1911) 规范文档。

---

## [v1.3.0] - 2026-10-14 📦

### ✨ 新特性 / Added
- 🟣 **原生标签页智能分组 ([Gemini] Tab Grouping)**:
  - 任何由 AI 控制或新打开的页面，自动归入原生紫色 `[Gemini]` 标签页组，方便用户实时查看受控状态。
- 🛡️ **自愈式后台守护进程 (Self-Healing Daemon)**:
  - CLI 工具检测到本地服务未运行时，自动在后台静默拉起守护进程，无需人工手动干预。
- 📸 **轻量级交互快照机制 (Token-Efficient Snapshot)**:
  - 提供 `#1`, `#2` 编号元素快照算法，使大模型无需推测坐标即可精准模拟点击与输入。

### 🔒 安全与隐私 / Security
- 彻底清理项目中所有绝对个人路径、隐私邮箱与机器标识，全部转换为动态相对路径与环境变量。
- 强制所有网络通信严格绑定在本地环回地址 `127.0.0.1:9223` / `127.0.0.1:9224`，零遥测、零云端中转。
- 正式以 Apache-2.0 协议开源并发布第一个生产发布版本。

---

## [v1.0.0] - 2026-10-13 🐣

### ✨ 初始发布 / Initial Release
- 实现了基于 Chrome DevTools Protocol (`chrome.debugger`) 的轻量级本地浏览器自动化桥接扩展。
- 实现了 Python 本地 HTTP / WebSocket 服务与基础 CLI 控制工具。
