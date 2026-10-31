# 旧版启动入口

[返回文档目录](README.md) · [当前安装方式](INSTALL.zh-CN.md)

当前版本由 DSH 或 Antigravity App 在调用工具时按需启动本地桥接服务。通常无需手动启动，也无需开机自启。

以下文件保留原路径，供旧的命令、快捷方式和使用习惯继续引用：

| 文件 | 用途 |
| --- | --- |
| [`start_server.bat`](https://github.com/AshenJyy/browser-bridge/blob/main/start_server.bat) | 在可见终端中调用 `scripts/BrowserBridge.ps1 status`，启动或检查服务，并保留窗口显示输出 |
| [`start_silent.vbs`](https://github.com/AshenJyy/browser-bridge/blob/main/start_silent.vbs) | 隐藏窗口调用同一个 `status` 入口，用于手动静默启动服务 |
| [`开机自动启动服务.bat`](https://github.com/AshenJyy/browser-bridge/blob/main/开机自动启动服务.bat) | 在 Windows 启动目录创建指向 `start_silent.vbs` 的快捷方式，是可选功能 |
| [`server/server.py`](https://github.com/AshenJyy/browser-bridge/blob/main/server/server.py) | 将旧 Python 服务入口转发到 Node.js 服务 |
| [`server/cli.py`](https://github.com/AshenJyy/browser-bridge/blob/main/server/cli.py) | 将旧 Python 命令入口转发到 Node.js CLI |
| [`server/requirements.txt`](https://github.com/AshenJyy/browser-bridge/blob/main/server/requirements.txt) | 说明 Python 文件仅用于迁移，不再安装旧版 Python 服务依赖 |

## 开机自启的含义

仓库里存在脚本，并不代表已经启用开机自启。运行自启脚本后，Windows 启动目录会出现 `AntigravityBrowserBridge.lnk`；登录 Windows 时，由它调用静默启动脚本。

需要关闭这项自启时，可以在 Windows 中打开 `shell:startup`，删除这个快捷方式。单独删除仓库里的自启安装脚本不会取消已经创建的快捷方式。

这些启动入口启动的是桥接服务，本身不会打开 Edge。正常使用时，Edge 中仍需加载扩展并完成配对。

## v1 到 v2

Python 入口是转发器，不再运行 v1 服务。v1 的 HTTP 路由、数字标签 ID 和 9223 WebSocket 已退役。当前命令参数以 `scripts/BrowserBridge.ps1 --help` 为准，协议见 [PROTOCOL.md](PROTOCOL.md)。
