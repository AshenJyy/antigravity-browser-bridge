# Browser Bridge

Control your existing, signed-in **Microsoft Edge** tabs from **DeepSeek Harness Desktop** and **Antigravity App**.

DSH registers native browser tools; Antigravity App connects through MCP. Both use the same local bridge and Edge extension for page reading, screenshots, browser actions, and tab management.

[中文](README.md) · **English** · [Download v2.0.2](https://github.com/AshenJyy/browser-bridge/releases/tag/v2.0.2) · [Documentation](docs/README.md) · [Changelog](CHANGELOG.md)

## Download and install

| Host | Package | Installation |
| --- | --- | --- |
| DSH Desktop | [dsh-browser-bridge-2.0.2.tgz](https://github.com/AshenJyy/browser-bridge/releases/download/v2.0.2/dsh-browser-bridge-2.0.2.tgz) | Add the local package in DSH plugin management, then restart the relevant profile or service |
| Antigravity App | [browser-bridge-antigravity-2.0.2.zip](https://github.com/AshenJyy/browser-bridge/releases/download/v2.0.2/browser-bridge-antigravity-2.0.2.zip) | Extract, run `scripts/Install-Antigravity.ps1`, and restart the app |
| Microsoft Edge | `browser-bridge/extension/` from the ZIP, or [`extension/`](extension/) from this repository | Enable developer mode at `edge://extensions` and load the unpacked extension |

DSH-only users can extract the Edge extension from the ZIP without installing the Antigravity App plugin. After installing the host plugin and extension, run this command from the extracted `browser-bridge` directory:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\BrowserBridge.ps1 pair
```

Enter the returned token and port in the extension popup. Pairing normally persists across restarts, and tool calls start the bridge on demand. See the [full installation guide in Chinese](docs/INSTALL.zh-CN.md) for configuration and pairing recovery.

## Requirements

- **DSH:** `>=0.2.1-rc.3 <=0.2.1`. This admits rc.3, subsequent `0.2.1-rc.*` releases, and stable `0.2.1` without listing each version.
- **Node.js:** 22+. Windows scripts prefer the runtime bundled with DSH.
- **Edge:** 125+, with the extension loaded in the browser profile you want to control.
- **Antigravity:** the App with plugin support.

The release ZIP includes bundled JavaScript runtime files. Using it does not require Python or installing npm dependencies. DSH uses native tools directly, without agy or an external subagent.

**Release status:** v2.0.2 has been built and packaged. Automated tests, cross-version verification, and end-to-end host acceptance have not been run.

## Browser tools

The 27 `browser_*` tools cover page text, structured snapshots, screenshots, clicks, hovering, typing, keys, scrolling, selection, navigation, waits, uploads, downloads, dialogs, and explicit tab ownership. Screenshot results are images and require a model with image support.

Every operation targets an explicit tab handle. DSH separates ownership by Agent/Session; Antigravity separates it by MCP process. Chats sharing one MCP process do not automatically receive separate identities. Browser internal pages and native system windows are outside the supported scope.

The bridge listens on `127.0.0.1:9224` by default. Windows state and the pairing token live in `%USERPROFILE%\.browser-bridge`. Page contents and screenshots are passed to the selected host and model.

## Repository guide

- [Development guide](docs/DEVELOPMENT.md): source layout, build commands, and release packaging; in Chinese.
- [Protocol](docs/PROTOCOL.md): HTTP, WebSocket, and session details; in English.
- [Legacy entry points](docs/LEGACY.md): Python wrappers and optional Windows launchers; in Chinese.
- [Issues](https://github.com/AshenJyy/browser-bridge/issues): bug reports and feature requests.

Browser Bridge evolved from Antigravity Browser Bridge. It is a community plugin, licensed under [Apache-2.0](LICENSE).
