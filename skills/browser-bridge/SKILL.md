---
name: browser-bridge
description: >-
  Inspect, control, navigate, and automate tasks in the user's real Microsoft Edge or Google Chrome browser.
  Use this skill whenever the user asks to open a webpage, view active browser tabs, click elements,
  fill out web forms, take webpage screenshots, run CDP (Chrome DevTools Protocol) commands, or automate browser workflows.
---

# Browser Bridge Automation Runbook

The Antigravity Browser Bridge connects Antigravity directly to the user's running browser (Edge / Chrome) via a background WebSocket daemon and a lightweight extension.

- **HTTP API Endpoint**: `http://127.0.0.1:9224`
- **WebSocket Endpoint**: `ws://127.0.0.1:9223`
- **CLI Utility**: `py server/cli.py <command>`

---

## Self-Healing Daemon

The CLI tool `cli.py` has automatic self-healing built-in. If the server daemon is not active, running any `cli.py` command will automatically launch the daemon in the background (`pythonw server.py`) without requiring manual setup.

---

## Common Operations & Recipes

### 1. Check Connection Status & List Tabs
```powershell
# Check if browser extension and bridge are online
py server/cli.py status

# List all open tabs
py server/cli.py tabs
```

### 2. Open / Navigate to a Web Page
```powershell
# Opens a new tab (automatically grouped into [Gemini] purple tab group)
py server/cli.py open "https://github.com"

# Or navigate an existing tab:
py server/cli.py open "https://news.ycombinator.com" --tab <tabId>
```

### 3. Interactive Webpage Navigation (Snapshot & Click / Type)
```powershell
# 1. Take interactive snapshot of interactive elements (#1, #2, etc.)
py server/cli.py snapshot <tabId>

# 2. Click an element by index or text
py server/cli.py click <tabId> "#1"
py server/cli.py click <tabId> "Sign in"

# 3. Type into an input field
py server/cli.py type <tabId> "#search-input" "deep learning"
```

### 4. Page Content Extraction & Screenshots
```powershell
# Extract plain text content from page
py server/cli.py text <tabId>

# Take screenshot of page
py server/cli.py screenshot <tabId> -o "page_shot.png"
```

### 5. Execute Arbitrary JavaScript in Page Context
```powershell
py server/cli.py eval <tabId> "document.title"
py server/cli.py eval <tabId> "window.scrollY"
```

### 6. Raw CDP (Chrome DevTools Protocol) Commands
```powershell
py server/cli.py cdp <tabId> Page.captureScreenshot '{"format":"png"}'
py server/cli.py cdp <tabId> DOM.getDocument '{"depth":1}'
```

### 7. Close Tabs or Disband Gemini Group
```powershell
# Close a specific tab (the [Gemini] group closes automatically when all agent tabs close)
py server/cli.py close --tab <tabId>

# Explicitly disband the [Gemini] group and ungroup tabs
py server/cli.py ungroup
```
