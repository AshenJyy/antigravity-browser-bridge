# 开发说明

[返回文档目录](README.md) · [安装使用](INSTALL.zh-CN.md)

## 源码目录

| 路径 | 职责 |
| --- | --- |
| `core/` | 本地桥接服务、客户端、设置与统一工具定义 |
| `adapters/` | DSH 原生插件、会话管理和 Antigravity MCP 适配器 |
| `extension/` | Microsoft Edge MV3 扩展、弹窗和页面操作代码 |
| `scripts/` | 构建、打包、安装、配对修复和命令行入口 |
| `skills/browser-bridge/` | 随插件提供的 Agent 操作说明 |
| `docs/` | 安装、开发、协议和旧版入口文档 |
| `tests/` | 已有开发测试源码 |
| `server/` | 旧 Python 入口的 Node 转发器，见 [旧版说明](LEGACY.md) |

根目录的 `package.json` 与 `cordis.patch.yml` 声明 DSH 插件；`plugin.json` 与 `mcp_config.json` 声明 Antigravity App 插件。根目录的三个 Windows 启动脚本保留原路径，供已有使用方式继续引用。

## 本地生成文件

以下目录和文件由 `.gitignore` 排除，不作为源码提交：

- `node_modules/`：本地开发依赖。
- `runtime/`：构建后的独立 JavaScript 运行文件及第三方许可。
- `work/`：临时工作文件和默认发布包输出目录。
- `.tgz`、`.zip`、日志、Python 缓存及 Windows 快捷方式。

`runtime/` 不进 Git，但会进入发布包。配对令牌属于用户运行状态，Windows 默认保存在 `%USERPROFILE%\.browser-bridge`，不属于仓库。

## 构建与打包

开发需要 Node.js 22+、pnpm；现有打包脚本还需要 Python 3。Windows 可使用 DSH 自带的 Node.js。

```powershell
pnpm install --frozen-lockfile
node scripts/build.mjs
py scripts/package_release.py --output work/releases
```

构建输出 `runtime/mcp.mjs`、`runtime/service.mjs`、`runtime/cli.mjs` 和第三方许可文件。打包输出：

| 文件 | 用途 |
| --- | --- |
| `dsh-browser-bridge-<版本>.tgz` | DSH 官方 npm bundle 格式，包含源码入口、运行文件、扩展和文档 |
| `browser-bridge-antigravity-<版本>.zip` | Antigravity App 插件，包含独立运行文件、扩展和安装脚本 |

这些构建与打包命令不会启动宿主或调用模型，也不会自动运行 `tests/`。当前 v2.0.2 发布未运行自动化测试、逐版本验证或双宿主端到端验收。

## 版本约定

插件版本在 `package.json`、`core/settings.mjs` 和 `extension/manifest.json` 中保持一致。发布时同步更新下载链接、安装说明、协议示例和 [更新记录](../CHANGELOG.md)，重新构建后生成新的发布包。

DSH 宿主约束 `engines.dsh` 和 `@deepseek-ai/dsh-mcp-client` 的 peer 范围统一为 `>=0.2.1-rc.3 <=0.2.1`。开发依赖仍固定在 rc.3，`pnpm-lock.yaml` 记录确定的开发依赖版本。

正式安装使用 Releases 中的构建产物。直接下载源码后，需要先安装开发依赖并构建，才能使用 Antigravity 安装脚本。
