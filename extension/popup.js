// Popup Script for Antigravity Browser Bridge (v1.4.0)
// Supports automatic browser language detection (zh/en) and manual toggle

const I18N = {
  zh: {
    toggleLangLabel: "English",
    statusConnected: "已连接",
    statusDisconnected: "未连接",
    statusOffline: "未启动",
    statusReconnecting: "正在重连...",
    activeTabCard: "当前标签页",
    loading: "加载中...",
    noTitle: "无标题",
    tabIdLabel: "Tab ID:",
    debugStatusLabel: "调试状态:",
    debugAttached: "已接入 (CDP Active)",
    debugDetached: "未接入",
    btnAttach: "接入当前页",
    btnDetach: "解除接入",
    btnReconnect: "重连服务",
    bridgeServiceCard: "桥接服务",
    localAddressLabel: "本地地址:",
    attachedCountLabel: "已接入标签页:",
    tips: "提示：保持本地 Python Bridge 运行。Antigravity 可直接向你当前选中的浏览器标签页发送点击、求值和输入指令。",
    opFailed: "操作失败: "
  },
  en: {
    toggleLangLabel: "中文",
    statusConnected: "Connected",
    statusDisconnected: "Disconnected",
    statusOffline: "Offline",
    statusReconnecting: "Reconnecting...",
    activeTabCard: "Active Tab",
    loading: "Loading...",
    noTitle: "Untitled",
    tabIdLabel: "Tab ID:",
    debugStatusLabel: "CDP Status:",
    debugAttached: "Attached (CDP Active)",
    debugDetached: "Detached",
    btnAttach: "Attach Tab",
    btnDetach: "Detach Tab",
    btnReconnect: "Reconnect",
    bridgeServiceCard: "Bridge Daemon",
    localAddressLabel: "Local Address:",
    attachedCountLabel: "Attached Tabs:",
    tips: "Tip: Keep the local Python bridge daemon running. Antigravity can inspect layout, click elements, and input text in active tabs upon request.",
    opFailed: "Operation failed: "
  }
};

let currentLang = "zh";
let currentTab = null;
let isAttached = false;
let lastStatusResponse = null;

function detectDefaultLanguage() {
  const uiLang = (chrome.i18n && chrome.i18n.getUILanguage ? chrome.i18n.getUILanguage() : navigator.language || "en").toLowerCase();
  return uiLang.startsWith("zh") ? "zh" : "en";
}

function applyI18n(lang) {
  currentLang = lang;
  const t = I18N[lang] || I18N.en;

  // Static elements with data-i18n
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    if (t[key]) {
      el.textContent = t[key];
    }
  });

  const langBtn = document.getElementById("langToggleBtn");
  if (langBtn) {
    langBtn.textContent = t.toggleLangLabel;
  }

  // Refresh dynamic states if available
  if (lastStatusResponse) {
    renderStatus(lastStatusResponse);
  }
}

function renderStatus(response) {
  const t = I18N[currentLang] || I18N.en;
  const statusBadge = document.getElementById("statusBadge");
  const statusText = document.getElementById("statusText");
  const attachedCount = document.getElementById("attachedCount");
  const debugStatus = document.getElementById("debugStatus");
  const toggleDebugBtn = document.getElementById("toggleDebugBtn");

  if (!response) {
    statusBadge.className = "status-badge status-disconnected";
    statusText.textContent = t.statusOffline;
    return;
  }

  if (response.connected) {
    statusBadge.className = "status-badge status-connected";
    statusText.textContent = t.statusConnected;
  } else {
    statusBadge.className = "status-badge status-disconnected";
    statusText.textContent = t.statusDisconnected;
  }

  attachedCount.textContent = response.attachedCount || 0;

  const browserBadge = document.getElementById("browserBadge");
  if (browserBadge && response.browser) {
    browserBadge.textContent = response.browser.name.includes("Edge") ? "Microsoft Edge" : "Google Chrome";
  }

  if (currentTab) {
    isAttached = response.attachedTabs && response.attachedTabs.includes(currentTab.id);
    if (isAttached) {
      debugStatus.textContent = t.debugAttached;
      debugStatus.style.color = "#10b981";
      toggleDebugBtn.textContent = t.btnDetach;
      toggleDebugBtn.className = "btn-danger";
    } else {
      debugStatus.textContent = t.debugDetached;
      debugStatus.style.color = "#94a3b8";
      toggleDebugBtn.textContent = t.btnAttach;
      toggleDebugBtn.className = "btn-primary";
    }
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const currentTabTitle = document.getElementById("currentTabTitle");
  const currentTabUrl = document.getElementById("currentTabUrl");
  const currentTabId = document.getElementById("currentTabId");
  const toggleDebugBtn = document.getElementById("toggleDebugBtn");
  const reconnectBtn = document.getElementById("reconnectBtn");
  const langToggleBtn = document.getElementById("langToggleBtn");

  // Load language preference
  chrome.storage.local.get("preferred_lang", (res) => {
    const savedLang = res && res.preferred_lang ? res.preferred_lang : detectDefaultLanguage();
    applyI18n(savedLang);
  });

  if (langToggleBtn) {
    langToggleBtn.addEventListener("click", () => {
      const nextLang = currentLang === "zh" ? "en" : "zh";
      chrome.storage.local.set({ preferred_lang: nextLang });
      applyI18n(nextLang);
    });
  }

  async function updateUI() {
    const t = I18N[currentLang] || I18N.en;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tab;

    if (tab) {
      currentTabTitle.textContent = tab.title || t.noTitle;
      currentTabUrl.textContent = tab.url || "-";
      currentTabId.textContent = tab.id;
    }

    chrome.runtime.sendMessage({ type: "get_status" }, (response) => {
      if (chrome.runtime.lastError || !response) {
        lastStatusResponse = null;
        renderStatus(null);
        return;
      }
      lastStatusResponse = response;
      renderStatus(response);
    });
  }

  toggleDebugBtn.addEventListener("click", async () => {
    if (!currentTab) return;
    const t = I18N[currentLang] || I18N.en;
    try {
      if (isAttached) {
        await chrome.debugger.detach({ tabId: currentTab.id });
      } else {
        await chrome.debugger.attach({ tabId: currentTab.id }, "1.3");
      }
    } catch (err) {
      console.error(err);
      alert(t.opFailed + (err.message || err));
    }
    setTimeout(updateUI, 200);
  });

  reconnectBtn.addEventListener("click", () => {
    const t = I18N[currentLang] || I18N.en;
    reconnectBtn.textContent = t.statusReconnecting;
    chrome.runtime.sendMessage({ type: "reconnect" }, () => {
      setTimeout(() => {
        reconnectBtn.textContent = t.btnReconnect;
        updateUI();
      }, 500);
    });
  });

  updateUI();
});
