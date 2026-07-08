(() => {
  if (globalThis.__schemeForceContentLoaded) return;
  globalThis.__schemeForceContentLoaded = true;
  let pageScriptReady = false;

  function send(mode) {
    window.postMessage({ source: "scheme-force", mode }, "*");
  }

  function schemeFromMode(mode) {
    if (mode === "light" || mode === "dark") return mode;
    const match = /^(smart|native)-(light|dark)$/.exec(mode || "");
    return match ? match[2] : "off";
  }

  function loadPageScript(done) {
    if (pageScriptReady) {
      done();
      return;
    }

    const script = document.createElement("script");
    script.id = "scheme-force-smart-mode";
    script.src = chrome.runtime.getURL("page-smart-mode.js");
    script.onload = () => {
      pageScriptReady = true;
      script.remove();
      done();
    };
    (document.documentElement || document.head).appendChild(script);
  }

  function apply(mode) {
    loadPageScript(() => send(schemeFromMode(mode)));
  }

  chrome.storage.local.get("mode", ({ mode }) => apply(mode));

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.mode) apply(changes.mode.newValue);
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "APPLY_MODE") apply(message.mode);
  });
})();
