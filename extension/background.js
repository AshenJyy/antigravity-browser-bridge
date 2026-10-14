// Antigravity Browser Bridge - Background Service Worker

const WS_URL = "ws://127.0.0.1:9223";
let socket = null;
let isConnected = false;
let reconnectTimer = null;
const attachedTabs = new Set();

console.log("[Antigravity Bridge] Service Worker initializing...");

// Keep-alive alarm to prevent MV3 background worker from sleeping unexpectedly
chrome.alarms.create("keepAlive", { periodInMinutes: 0.25 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "keepAlive") {
    if (!isConnected) {
      connectWebSocket();
    } else if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "ping", timestamp: Date.now() }));
    }
  }
});

function getBrowserInfo() {
  const ua = navigator.userAgent;
  if (ua.includes("Edg/")) {
    const m = ua.match(/Edg\/([\d.]+)/);
    return { name: "Microsoft Edge", version: m ? m[1] : "" };
  }
  if (ua.includes("Chrome/")) {
    const m = ua.match(/Chrome\/([\d.]+)/);
    return { name: "Google Chrome", version: m ? m[1] : "" };
  }
  return { name: "Chromium Browser", version: "" };
}

function connectWebSocket() {
  if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) {
    return;
  }

  try {
    socket = new WebSocket(WS_URL);

    socket.onopen = () => {
      console.log("[Antigravity Bridge] Connected to local server:", WS_URL);
      isConnected = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      chrome.action.setBadgeText({ text: "ON" });
      chrome.action.setBadgeBackgroundColor({ color: "#10B981" }); // green
      const bInfo = getBrowserInfo();
      socket.send(JSON.stringify({
        type: "client_hello",
        client: bInfo.name,
        browserVersion: bInfo.version,
        version: "1.1.0"
      }));
    };

    socket.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "pong") return;
        if (msg.type === "request") {
          const response = await handleCommand(msg);
          socket.send(JSON.stringify({
            type: "response",
            id: msg.id,
            ...response
          }));
        }
      } catch (err) {
        console.error("[Antigravity Bridge] Message processing error:", err);
      }
    };

    socket.onclose = () => {
      console.warn("[Antigravity Bridge] WebSocket disconnected. Retrying in 3s...");
      isConnected = false;
      chrome.action.setBadgeText({ text: "OFF" });
      chrome.action.setBadgeBackgroundColor({ color: "#EF4444" }); // red
      scheduleReconnect();
    };

    socket.onerror = (err) => {
      console.error("[Antigravity Bridge] WebSocket error:", err);
      try { socket.close(); } catch (_) {}
    };
  } catch (err) {
    console.error("[Antigravity Bridge] Connection failed:", err);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (!reconnectTimer) {
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectWebSocket();
    }, 3000);
  }
}

// Forward CDP events to the local bridge
chrome.debugger.onEvent.addListener((source, method, params) => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: "cdp_event",
      tabId: source.tabId,
      method,
      params
    }));
  }
});

chrome.debugger.onDetach.addListener((source, reason) => {
  console.log(`[Antigravity Bridge] Debugger detached from tab ${source.tabId}:`, reason);
  attachedTabs.delete(source.tabId);
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: "tab_detached",
      tabId: source.tabId,
      reason
    }));
  }
});

// Helper: Ensure debugger is attached to tab
async function ensureDebuggerAttached(tabId) {
  if (attachedTabs.has(tabId)) return true;
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    attachedTabs.add(tabId);
    return true;
  } catch (err) {
    const errMsg = (err.message || "").toLowerCase();
    if (errMsg.includes("already attached")) {
      attachedTabs.add(tabId);
      return true;
    }
    throw err;
  }
}

// Helper: Clean up any previously injected overlay DOM/styles
async function cleanupGeminiOverlay(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        document.getElementById("__gemini_badge")?.remove();
        document.getElementById("__gemini_virtual_pointer")?.remove();
        document.getElementById("__gemini_overlay_styles")?.remove();
        document.querySelectorAll(".__gemini_ripple").forEach(r => r.remove());
        if (document.title.startsWith("✨ [Gemini] ")) {
          document.title = document.title.replace(/^✨\s*\[Gemini\]\s*/, "");
        }
      }
    });
  } catch (_) {}
}

// Helper: Native Edge/Chrome Tab Group ("Gemini" / Purple)
async function addTabToGeminiGroup(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab) return null;
    const windowId = tab.windowId;

    const groups = await chrome.tabGroups.query({ windowId });
    const existingGroup = groups.find(g => g.title === "Gemini");

    let groupId;
    if (existingGroup) {
      groupId = await chrome.tabs.group({ tabIds: [tabId], groupId: existingGroup.id });
    } else {
      groupId = await chrome.tabs.group({ tabIds: [tabId] });
      await chrome.tabGroups.update(groupId, {
        title: "Gemini",
        color: "purple",
        collapsed: false
      });
    }
    await setTabGeminiLogo(tabId);
    return groupId;
  } catch (err) {
    console.warn("[Antigravity Bridge] Could not group tab:", err);
    return null;
  }
}

// Official Google Gemini gradient star vector icon
const GEMINI_SVG_DATA = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><defs><linearGradient id='g' x1='0%25' y1='0%25' x2='100%25' y2='100%25'><stop offset='0%25' stop-color='%234285F4'/><stop offset='35%25' stop-color='%239B72CB'/><stop offset='70%25' stop-color='%23D96570'/><stop offset='100%25' stop-color='%23FFA439'/></linearGradient></defs><path d='M16 1 C16 9.28 9.28 16 1 16 C9.28 16 16 22.72 16 31 C16 22.72 22.72 16 31 16 C22.72 16 16 9.28 16 1 Z' fill='url(%23g)'/></svg>";

// Set crisp official Gemini Logo as Favicon
async function setTabGeminiLogo(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: (svgUrl) => {
        document.querySelectorAll("link[rel*='icon']").forEach(l => l.remove());
        const link = document.createElement("link");
        link.rel = "icon";
        link.type = "image/svg+xml";
        link.href = svgUrl;
        document.head.appendChild(link);
        document.title = document.title.replace(/^[✨🖱️↖️👆✦\\[\\]\\s]+/, "");
      },
      args: [GEMINI_SVG_DATA]
    });
  } catch (_) {}
}

// Auto-maintain Gemini Logo on grouped tabs
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.groupId && tab.groupId !== -1) {
    try {
      const group = await chrome.tabGroups.get(tab.groupId);
      if (group && group.title === "Gemini") {
        setTabGeminiLogo(tabId);
      }
    } catch (_) {}
  }
});

// Command dispatcher
async function handleCommand(msg) {
  const { action, tabId } = msg;

  try {
    switch (action) {
      case "group":
      case "tag": {
        if (!tabId) return { success: false, error: "tabId required" };
        await cleanupGeminiOverlay(tabId);
        const gId = await addTabToGeminiGroup(tabId);
        await tagTabTitleWithPointer(tabId);
        return { success: true, message: `Tab added to Gemini group (${gId}) with 🖱️ pointer` };
      }

      case "list_tabs": {
        const tabs = await chrome.tabs.query({});
        return {
          success: true,
          data: tabs.map(t => ({
            id: t.id,
            windowId: t.windowId,
            title: t.title,
            url: t.url,
            active: t.active,
            attached: attachedTabs.has(t.id)
          }))
        };
      }

      case "get_active_tab": {
        const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (!activeTab) return { success: false, error: "No active tab found" };
        return {
          success: true,
          data: {
            id: activeTab.id,
            title: activeTab.title,
            url: activeTab.url,
            attached: attachedTabs.has(activeTab.id)
          }
        };
      }

      case "attach": {
        if (!tabId) return { success: false, error: "tabId is required" };
        await ensureDebuggerAttached(tabId);
        await cleanupGeminiOverlay(tabId);
        await addTabToGeminiGroup(tabId);
        return { success: true, message: `Attached to tab ${tabId}` };
      }

      case "detach": {
        if (!tabId) return { success: false, error: "tabId is required" };
        if (attachedTabs.has(tabId)) {
          await chrome.debugger.detach({ tabId });
          attachedTabs.delete(tabId);
        }
        return { success: true, message: `Detached from tab ${tabId}` };
      }

      case "navigate": {
        if (!tabId || !msg.url) return { success: false, error: "tabId and url required" };
        const updated = await chrome.tabs.update(tabId, { url: msg.url });
        await addTabToGeminiGroup(tabId);
        return { success: true, data: { id: updated.id, url: updated.url } };
      }

      case "create_tab": {
        const newTab = await chrome.tabs.create({ url: msg.url || "about:blank", active: msg.active !== false });
        await addTabToGeminiGroup(newTab.id);
        return { success: true, data: { id: newTab.id, url: newTab.url } };
      }

      case "close_tab": {
        if (!tabId) return { success: false, error: "tabId required" };
        await chrome.tabs.remove(tabId);
        attachedTabs.delete(tabId);
        return { success: true, message: `Closed tab ${tabId}` };
      }

      case "cdp": {
        if (!tabId || !msg.method) return { success: false, error: "tabId and method required" };
        await ensureDebuggerAttached(tabId);
        const result = await chrome.debugger.sendCommand({ tabId }, msg.method, msg.params || {});
        return { success: true, data: result };
      }

      case "eval": {
        if (!tabId || !msg.expression) return { success: false, error: "tabId and expression required" };
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId },
            world: "MAIN",
            func: (code) => {
              try {
                return { ok: true, val: window.eval(code) };
              } catch (e) {
                return { ok: false, err: e.message || String(e) };
              }
            },
            args: [msg.expression]
          });
          const res = results[0]?.result;
          if (res && res.ok === false) {
            return { success: false, error: res.err };
          }
          return { success: true, data: res ? res.val : null };
        } catch (scriptErr) {
          await ensureDebuggerAttached(tabId);
          const result = await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
            expression: msg.expression,
            returnByValue: true,
            awaitPromise: true,
            includeCommandLineAPI: true
          });
          if (result.exceptionDetails) {
            return { success: false, error: result.exceptionDetails.text, details: result.exceptionDetails };
          }
          return { success: true, data: result.result ? result.result.value : null };
        }
      }

      case "screenshot": {
        if (!tabId) return { success: false, error: "tabId required" };
        try {
          const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: msg.format || "png" });
          const base64 = dataUrl.replace(/^data:image\/[a-z]+;base64,/, "");
          return { success: true, data: base64 };
        } catch (_) {
          await ensureDebuggerAttached(tabId);
          const result = await chrome.debugger.sendCommand({ tabId }, "Page.captureScreenshot", {
            format: msg.format || "png",
            quality: msg.quality || 90
          });
          return { success: true, data: result.data };
        }
      }

      case "get_content": {
        if (!tabId) return { success: false, error: "tabId required" };
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
              return {
                title: document.title,
                url: window.location.href,
                text: document.body ? document.body.innerText.substring(0, 50000) : "",
                html: document.documentElement ? document.documentElement.outerHTML.substring(0, 100000) : ""
              };
            }
          });
          return { success: true, data: results[0]?.result };
        } catch (_) {
          await ensureDebuggerAttached(tabId);
          const script = `(() => {
            return {
              title: document.title,
              url: window.location.href,
              text: document.body ? document.body.innerText.substring(0, 50000) : "",
              html: document.documentElement ? document.documentElement.outerHTML.substring(0, 100000) : ""
            };
          })()`;
          const res = await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
            expression: script,
            returnByValue: true,
            awaitPromise: true
          });
          return { success: true, data: res.result ? res.result.value : null };
        }
      }

      case "snapshot": {
        if (!tabId) return { success: false, error: "tabId required" };
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId },
            world: "MAIN",
            func: () => {
              const selectors = [
                'button', 'a[href]', 'input', 'select', 'textarea',
                '[role="button"]', '[role="link"]', '[role="checkbox"]',
                '[role="tab"]', '[role="menuitem"]', '[contenteditable="true"]',
                '[data-testid*="btn"]', '[data-testid*="button"]'
              ].join(',');
              const all = Array.from(document.querySelectorAll(selectors));
              window.__agy_elements = window.__agy_elements || {};
              window.__agy_elements = {};

              const list = [];
              let idx = 1;
              for (const el of all) {
                const rect = el.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) continue;
                const style = window.getComputedStyle(el);
                if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue;

                let text = (el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
                if (text.length > 50) text = text.substring(0, 47) + '...';
                const aria = el.getAttribute('aria-label');
                const testid = el.getAttribute('data-testid');

                if (!text && !aria && !testid && !el.id) continue;

                window.__agy_elements[idx] = el;
                let desc = `[#${idx}] <${el.tagName.toLowerCase()}>`;
                if (text) desc += ` "${text}"`;
                if (aria && aria !== text) desc += ` (aria: "${aria}")`;
                if (testid && testid !== text) desc += ` [${testid}]`;
                list.push(desc);
                idx++;
                if (idx > 80) break;
              }

              return {
                url: window.location.href,
                title: document.title,
                count: list.length,
                elements: list.join('\n')
              };
            }
          });
          return { success: true, data: results[0]?.result };
        } catch (err) {
          return { success: false, error: err.message || String(err) };
        }
      }

      case "click": {
        if (!tabId || !msg.selector) return { success: false, error: "tabId and target required" };
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId },
            world: "MAIN",
            func: async (target) => {
              let el = null;
              // 1. Check index (#1, 1)
              const idMatch = String(target).match(/^#?(\d+)$/);
              if (idMatch && window.__agy_elements) {
                el = window.__agy_elements[parseInt(idMatch[1], 10)];
              }
              // 2. Direct querySelector
              if (!el) {
                try { el = document.querySelector(target); } catch (_) {}
              }
              // 3. Fuzzy search by text, aria, or testid
              if (!el) {
                const lower = String(target).toLowerCase();
                const candidates = Array.from(document.querySelectorAll('button, a, input, [role="button"], [data-testid]'));
                el = candidates.find(c => {
                  const text = (c.innerText || c.value || '').toLowerCase();
                  const aria = (c.getAttribute('aria-label') || '').toLowerCase();
                  const testid = (c.getAttribute('data-testid') || '').toLowerCase();
                  return text.includes(lower) || aria.includes(lower) || testid.includes(lower);
                });
              }

              if (!el) return { ok: false, error: `Target not found: "${target}"` };

              el.scrollIntoView({ behavior: 'instant', block: 'center' });
              el.focus();
              el.click();

              return {
                ok: true,
                tag: el.tagName.toLowerCase(),
                text: (el.innerText || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().substring(0, 50)
              };
            },
            args: [msg.selector]
          });
          const res = results[0]?.result;
          if (!res || !res.ok) {
            return { success: false, error: res?.error || `Element not found: ${msg.selector}` };
          }
          return { success: true, data: res };
        } catch (err) {
          return { success: false, error: err.message || String(err) };
        }
      }

      case "type": {
        if (!tabId || !msg.selector || msg.text === undefined) return { success: false, error: "tabId, target and text required" };
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId },
            world: "MAIN",
            func: (target, text, clear) => {
              let el = null;
              const idMatch = String(target).match(/^#?(\d+)$/);
              if (idMatch && window.__agy_elements) {
                el = window.__agy_elements[parseInt(idMatch[1], 10)];
              }
              if (!el) {
                try { el = document.querySelector(target); } catch (_) {}
              }
              if (!el) {
                const lower = String(target).toLowerCase();
                const inputs = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"]'));
                el = inputs.find(i => {
                  const ph = (i.getAttribute('placeholder') || '').toLowerCase();
                  const aria = (i.getAttribute('aria-label') || '').toLowerCase();
                  const name = (i.getAttribute('name') || '').toLowerCase();
                  return ph.includes(lower) || aria.includes(lower) || name.includes(lower);
                });
              }

              if (!el) return { ok: false, error: `Input target not found: "${target}"` };

              el.scrollIntoView({ behavior: 'instant', block: 'center' });
              el.focus();
              if (clear) el.value = '';
              el.value = (el.value || '') + text;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));

              return {
                ok: true,
                value: el.value
              };
            },
            args: [msg.selector, msg.text, msg.clear !== false]
          });
          const res = results[0]?.result;
          if (!res || !res.ok) {
            return { success: false, error: res?.error || `Input not found: ${msg.selector}` };
          }
          return { success: true, data: res };
        } catch (err) {
          return { success: false, error: err.message || String(err) };
        }
      }

      case "reload_ext": {
        setTimeout(() => chrome.runtime.reload(), 100);
        return { success: true, message: "Reloading extension..." };
      }

      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  } catch (err) {
    return { success: false, error: err.message || String(err) };
  }
}

// Handle messages from popup UI
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.type === "get_status") {
    sendResponse({
      connected: isConnected,
      wsUrl: WS_URL,
      browser: getBrowserInfo(),
      attachedCount: attachedTabs.size,
      attachedTabs: Array.from(attachedTabs)
    });
  } else if (req.type === "reconnect") {
    connectWebSocket();
    sendResponse({ success: true });
  }
  return true;
});

// Start connection on launch
connectWebSocket();
