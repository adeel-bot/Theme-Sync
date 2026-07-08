(() => {
  const BRIDGE_KEY = "__SCHEME_FORCE_BRIDGE__";
  const EVENT_SOURCE = "scheme-force-extension";
  const PAGE_SOURCE = "scheme-force-page";

  if (window[BRIDGE_KEY]) return;
  window[BRIDGE_KEY] = true;

  function validMode(mode) {
    return mode === "off" || mode === "light" || mode === "dark";
  }

  function postMode(mode) {
    if (!validMode(mode)) mode = "off";
    window.postMessage({
      source: EVENT_SOURCE,
      type: "SCHEME_FORCE_SET_MODE",
      mode
    }, "*");
  }

  function isStylesheetUrlOnPage(url) {
    try {
      const normalized = new URL(url, location.href).href;
      return Array.from(document.querySelectorAll("link[rel~='stylesheet'][href]")).some((link) => link.href === normalized);
    } catch {
      return false;
    }
  }

  async function loadAndPostCurrentMode() {
    try {
      const { mode = "off" } = await chrome.storage.local.get("mode");
      postMode(mode);
    } catch {
      postMode("off");
    }
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes.mode) return;
    postMode(changes.mode.newValue || "off");
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "APPLY_MODE") {
      postMode(message.mode || "off");
    }
  });

  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;
    const data = event.data || {};
    if (data.source !== PAGE_SOURCE || data.type !== "SCHEME_FORCE_FETCH_CSS") return;
    if (!data.url || !/^https?:\/\//i.test(data.url)) return;
    if (!isStylesheetUrlOnPage(data.url)) return;

    try {
      const response = await chrome.runtime.sendMessage({
        type: "FETCH_CSS",
        url: data.url,
        mode: data.mode,
        requestId: data.requestId
      });

      if (!response?.ok || typeof response.cssText !== "string") return;

      window.postMessage({
        source: EVENT_SOURCE,
        type: "SCHEME_FORCE_CSS_RESPONSE",
        url: data.url,
        mode: data.mode,
        requestId: data.requestId,
        cssText: response.cssText
      }, "*");
    } catch {
      // Ignore fetch failures. The page will still get color-scheme, JS patching,
      // and any same-origin stylesheet overrides we can read directly.
    }
  });

  loadAndPostCurrentMode();
})();
