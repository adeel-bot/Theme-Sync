// background.js
// Modes: "off" | "smart-light" | "smart-dark" | "native-light" | "native-dark"

const DEBUG_PROTOCOL_VERSION = "1.3";
const STYLE_ORIGIN = "USER";
const attachedTabs = new Set();
const detachingTabs = new Set();
let mode = "off";

function isInjectableTab(tab) {
  if (!tab || !tab.id || tab.id === chrome.tabs.TAB_ID_NONE) return false;
  const url = tab.url || tab.pendingUrl || "";
  return /^https?:\/\//.test(url) || url === "" || url === "about:blank";
}

function parseMode(value) {
  if (value === "light" || value === "dark") return { type: "smart", scheme: value };
  const match = /^(smart|native)-(light|dark)$/.exec(value || "");
  return match ? { type: match[1], scheme: match[2] } : { type: "off", scheme: "off" };
}

function cssFor(schemeValue) {
  return `:root { color-scheme: ${schemeValue} !important; }`;
}

async function loadMode() {
  const stored = await chrome.storage.local.get("mode");
  mode = stored.mode || "off";
  return mode;
}

async function removeSchemeCss(tabId) {
  await Promise.all(
    ["light", "dark"].map((scheme) =>
      chrome.scripting
        .removeCSS({
          target: { tabId, allFrames: true },
          css: cssFor(scheme),
          origin: STYLE_ORIGIN
        })
        .catch(() => {})
    )
  );
}

async function setSchemeCss(tabId, schemeValue) {
  try {
    await removeSchemeCss(tabId);
    await chrome.scripting.insertCSS({
      target: { tabId, allFrames: true },
      css: cssFor(schemeValue),
      origin: STYLE_ORIGIN
    });
  } catch (err) {
    // Tab may have closed mid-call, or be a protected page.
  }
}

async function sendSmartMode(tabId, schemeValue) {
  await chrome.scripting
    .executeScript({ target: { tabId, allFrames: true }, files: ["smart-mode.js"] })
    .catch(() => {});
  await chrome.tabs.sendMessage(tabId, { type: "APPLY_MODE", mode: schemeValue }).catch(() => {});
}

async function attachAndSet(tabId, schemeValue) {
  try {
    if (!attachedTabs.has(tabId)) {
      await chrome.debugger.attach({ tabId }, DEBUG_PROTOCOL_VERSION);
      attachedTabs.add(tabId);
    }
    await chrome.debugger.sendCommand({ tabId }, "Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: schemeValue }]
    });
  } catch {
    attachedTabs.delete(tabId);
  }
}

async function clearNativeOverride(tabId) {
  try {
    await chrome.debugger.sendCommand({ tabId }, "Emulation.setEmulatedMedia", {
      features: []
    });
  } catch {
    // Tab may not be attached anymore.
  }
}

async function detachTab(tabId) {
  detachingTabs.add(tabId);
  attachedTabs.delete(tabId);
  try {
    await clearNativeOverride(tabId);
    await chrome.debugger.detach({ tabId });
  } catch {
    // Already detached.
    detachingTabs.delete(tabId);
  }
}

async function applyToTab(tabId) {
  const active = parseMode(mode);

  if (active.type === "off") {
    await removeSchemeCss(tabId);
    await sendSmartMode(tabId, "off");
    await detachTab(tabId);
    return;
  }

  await setSchemeCss(tabId, active.scheme);
  await sendSmartMode(tabId, active.scheme);

  if (active.type === "native") {
    await attachAndSet(tabId, active.scheme);
  } else {
    await detachTab(tabId);
  }
}

async function applyToAllTabs() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.filter(isInjectableTab).map((tab) => applyToTab(tab.id)));

  if (parseMode(mode).type !== "native") {
    const targets = await chrome.debugger.getTargets().catch(() => []);
    await Promise.all(
      targets
        .filter((target) => target.attached && target.tabId)
        .map((target) => detachTab(target.tabId))
    );
  }
}

async function setMode(newMode) {
  mode = newMode;
  await chrome.storage.local.set({ mode });
  await applyToAllTabs();
}

chrome.runtime.onInstalled.addListener(async () => {
  await loadMode();
  await applyToAllTabs();
});

chrome.runtime.onStartup.addListener(async () => {
  await loadMode();
  await applyToAllTabs();
});

(async () => {
  await loadMode();
  await applyToAllTabs();
})();

chrome.tabs.onCreated.addListener((tab) => {
  if (parseMode(mode).type !== "off" && isInjectableTab(tab)) applyToTab(tab.id);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading" && parseMode(mode).type !== "off" && isInjectableTab(tab)) {
    applyToTab(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  attachedTabs.delete(tabId);
  detachingTabs.delete(tabId);
});

chrome.debugger.onDetach.addListener((source) => {
  if (!source.tabId) return;
  if (detachingTabs.has(source.tabId)) {
    detachingTabs.delete(source.tabId);
    return;
  }
  attachedTabs.delete(source.tabId);
  const active = parseMode(mode);
  if (active.type === "native") setMode(`smart-${active.scheme}`);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_MODE") {
    loadMode().then((m) => sendResponse({ mode: m }));
    return true;
  }
  if (message?.type === "SET_MODE") {
    setMode(message.mode).then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});
