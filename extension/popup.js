// Popup Script for Antigravity Browser Bridge

let currentTab = null;
let isAttached = false;

document.addEventListener("DOMContentLoaded", async () => {
  const statusBadge = document.getElementById("statusBadge");
  const statusText = document.getElementById("statusText");
  const currentTabTitle = document.getElementById("currentTabTitle");
  const currentTabUrl = document.getElementById("currentTabUrl");
  const currentTabId = document.getElementById("currentTabId");
  const debugStatus = document.getElementById("debugStatus");
  const toggleDebugBtn = document.getElementById("toggleDebugBtn");
  const reconnectBtn = document.getElementById("reconnectBtn");
  const attachedCount = document.getElementById("attachedCount");

  async function updateUI() {
    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tab;

    if (tab) {
      currentTabTitle.textContent = tab.title || "无标题";
      currentTabUrl.textContent = tab.url || "-";
      currentTabId.textContent = tab.id;
    }

    // Get background service worker state
    chrome.runtime.sendMessage({ type: "get_status" }, (response) => {
      if (chrome.runtime.lastError || !response) {
        statusBadge.className = "status-badge status-disconnected";
        statusText.textContent = "未启动";
        return;
      }

      if (response.connected) {
        statusBadge.className = "status-badge status-connected";
        statusText.textContent = "已连接";
      } else {
        statusBadge.className = "status-badge status-disconnected";
        statusText.textContent = "未连接";
      }

      attachedCount.textContent = response.attachedCount || 0;

      const browserBadge = document.getElementById("browserBadge");
      if (browserBadge && response.browser) {
        browserBadge.textContent = response.browser.name.includes("Edge") ? "Microsoft Edge" : "Google Chrome";
      }

      if (tab) {
        isAttached = response.attachedTabs && response.attachedTabs.includes(tab.id);
        if (isAttached) {
          debugStatus.textContent = "已接入 (CDP Active)";
          debugStatus.style.color = "#10b981";
          toggleDebugBtn.textContent = "解除接入";
          toggleDebugBtn.className = "btn-danger";
        } else {
          debugStatus.textContent = "未接入";
          debugStatus.style.color = "#94a3b8";
          toggleDebugBtn.textContent = "接入当前页";
          toggleDebugBtn.className = "btn-primary";
        }
      }
    });
  }

  toggleDebugBtn.addEventListener("click", async () => {
    if (!currentTab) return;
    try {
      if (isAttached) {
        await chrome.debugger.detach({ tabId: currentTab.id });
      } else {
        await chrome.debugger.attach({ tabId: currentTab.id }, "1.3");
      }
    } catch (err) {
      console.error(err);
      alert("操作失败: " + (err.message || err));
    }
    setTimeout(updateUI, 200);
  });

  reconnectBtn.addEventListener("click", () => {
    reconnectBtn.textContent = "正在重连...";
    chrome.runtime.sendMessage({ type: "reconnect" }, () => {
      setTimeout(() => {
        reconnectBtn.textContent = "重连服务";
        updateUI();
      }, 500);
    });
  });

  updateUI();
});
