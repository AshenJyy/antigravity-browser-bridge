# 更新记录

## 未发布

- 整理中英文首页、下载入口和文档导航。
- 补充源码目录、构建流程、版本约定和旧版启动入口说明。
- 将英文首页和更新记录纳入后续发布包与 App 安装器的文档清单。
- 保留现有脚本路径和浏览器控制逻辑。

## [2.0.2](https://github.com/AshenJyy/browser-bridge/releases/tag/v2.0.2)

- DSH 宿主与 `@deepseek-ai/dsh-mcp-client` peer 依赖范围改为 `>=0.2.1-rc.3 <=0.2.1`，允许后续 `0.2.1-rc.*` 和 `0.2.1` 正式版，无需逐个登记。
- 开发依赖继续固定在 rc.3。
- 更新安装说明与 DSH、Antigravity 发布包。

## [2.0.1](https://github.com/AshenJyy/browser-bridge/releases/tag/v2.0.1)

- DSH 通过原生插件调用工具，Antigravity App 通过独立 MCP 插件调用，不再依赖 agy 子代理。
- Windows 默认状态目录统一为 `%USERPROFILE%\.browser-bridge`，避开 AppData 路径重定向造成的令牌分歧。
- 增加旧令牌迁移和配对修复入口，明确报告凭据不一致与端口占用。
- 完善 Antigravity App 安装脚本与预打包运行文件。

## [2.0.0](https://github.com/AshenJyy/browser-bridge/releases/tag/v2.0.0)

- 从 Antigravity Browser Bridge 重构为 DSH、Antigravity 共用的 Node.js 桥接服务。
- 统一 `browser_*` 工具、Edge MV3 扩展、会话身份和标签归属。
- 提供页面读取、截图、网页操作、文件与对话框工具。
- 引入令牌认证、任务队列、超时与断线处理。

上述 2.0.x 发布已构建和打包，未运行自动化测试或双宿主端到端验收；2.0.2 的扩展版本范围也未逐版本验证。
