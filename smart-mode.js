(() => {
  if (globalThis.__schemeForceContentLoaded) return;
  globalThis.__schemeForceContentLoaded = true;
  let pageScriptReady = false;
  let currentMode = "off";
  let currentTune = null;
  let panelRoot = null;
  let panelElements = null;

  const defaultTune = {
    background: "#0b0d0e",
    brightness: 1,
    contrast: 1.05,
    saturation: 0.3,
    mediaBrightness: 1,
    vectorBrightness: 1.15,
    preserveMedia: true,
    preserveVectors: true,
    tunerOpen: true,
    x: 18,
    y: 90
  };
  const presets = [
    { color: "#0b0d0e", label: "Carbon", tune: { background: "#0b0d0e", brightness: 1, contrast: 1.05, saturation: 0.3, mediaBrightness: 1, vectorBrightness: 1.15 } },
    { color: "#111827", label: "Slate", tune: { background: "#111827", brightness: 0.96, contrast: 1.08, saturation: 0.45, mediaBrightness: 1.04, vectorBrightness: 1.2 } },
    { color: "#17130f", label: "Warm", tune: { background: "#17130f", brightness: 0.98, contrast: 1, saturation: 0.7, mediaBrightness: 1.08, vectorBrightness: 1.16 } },
    { color: "#050816", label: "Ink", tune: { background: "#050816", brightness: 0.9, contrast: 1.15, saturation: 0.2, mediaBrightness: 0.96, vectorBrightness: 1.28 } }
  ];

  function send(mode, siteTune) {
    window.postMessage({ source: "scheme-force", mode, siteTune }, "*");
  }

  function schemeFromMode(mode) {
    if (mode === "light" || mode === "dark") return mode;
    const match = /^(smart|native)-(light|dark)$/.exec(mode || "");
    return match ? match[2] : "off";
  }

  function isDisabledHere(disabledSites) {
    return Array.isArray(disabledSites) && disabledSites.includes(location.origin);
  }

  function isTopFrame() {
    return window.top === window;
  }

  function isTunableSite() {
    return ["docs.google.com", "drive.google.com", "getpinch.com.au", "web.getpinch.com.au"].includes(location.hostname);
  }

  function defaultTuneForPage() {
    const isSheets = location.hostname === "docs.google.com" && location.pathname.includes("/spreadsheets/");
    return isSheets ? defaultTune : { ...defaultTune, contrast: 1, saturation: 1 };
  }

  function tuneFor(settings) {
    const saved = settings?.[location.origin] || {};
    return { ...defaultTuneForPage(), ...saved };
  }

  function hasExtensionContext() {
    return Boolean(globalThis.chrome?.runtime?.id && chrome.storage?.local);
  }

  function isContextInvalidatedError(error) {
    return String(error?.message || error || "").includes("Extension context invalidated");
  }

  function readStorage(keys) {
    return new Promise((resolve) => {
      if (!hasExtensionContext()) {
        resolve(null);
        return;
      }

      try {
        chrome.storage.local.get(keys, (value) => {
          try {
            resolve(chrome.runtime.lastError ? null : value);
          } catch {
            resolve(null);
          }
        });
      } catch {
        resolve(null);
      }
    });
  }

  function writeStorage(value) {
    return new Promise((resolve) => {
      if (!hasExtensionContext()) {
        resolve(false);
        return;
      }

      try {
        chrome.storage.local.set(value, () => {
          try {
            resolve(!chrome.runtime.lastError);
          } catch {
            resolve(false);
          }
        });
      } catch {
        resolve(false);
      }
    });
  }

  window.addEventListener("unhandledrejection", (event) => {
    if (!isContextInvalidatedError(event.reason)) return;
    event.preventDefault();
  });

  function loadPageScript(done) {
    if (pageScriptReady) {
      done();
      return;
    }

    const script = document.createElement("script");
    script.id = "scheme-force-smart-mode";
    try {
      script.src = chrome.runtime.getURL("page-smart-mode.js");
    } catch {
      return;
    }
    script.onload = () => {
      pageScriptReady = true;
      script.remove();
      done();
    };
    (document.documentElement || document.head).appendChild(script);
  }

  function apply(mode, disabledSites = [], siteTuneSettings = {}) {
    const scheme = isDisabledHere(disabledSites) ? "off" : schemeFromMode(mode);
    currentMode = scheme;
    currentTune = tuneFor(siteTuneSettings);
    loadPageScript(() => send(scheme, currentTune));
    renderPanel();
  }

  function applyFromStorage() {
    readStorage(["mode", "disabledSites", "siteTuneSettings"]).then((stored) => {
      if (!stored) return;
      const { mode, disabledSites, siteTuneSettings } = stored;
      apply(mode, disabledSites, siteTuneSettings);
    });
  }

  function previewTune(nextTune) {
    currentTune = { ...currentTune, ...nextTune };
    loadPageScript(() => send(currentMode, currentTune));
    renderPanel();
  }

  async function persistTune(nextTune = {}) {
    currentTune = { ...currentTune, ...nextTune };
    const { siteTuneSettings = {} } = (await readStorage("siteTuneSettings")) || {};
    const saved = await writeStorage({
      siteTuneSettings: {
        ...siteTuneSettings,
        [location.origin]: currentTune
      }
    });
    if (!saved) return false;
    loadPageScript(() => send(currentMode, currentTune));
    renderPanel();
    return true;
  }

  async function persistWindowState(nextState) {
    currentTune = { ...currentTune, ...nextState };
    const { siteTuneSettings = {} } = (await readStorage("siteTuneSettings")) || {};
    const saved = await writeStorage({
      siteTuneSettings: {
        ...siteTuneSettings,
        [location.origin]: {
          ...(siteTuneSettings[location.origin] || {}),
          ...nextState
        }
      }
    });
    if (!saved) return;
    renderPanel();
  }

  function closePanel() {
    currentTune = { ...currentTune, tunerOpen: false };
    if (panelRoot) panelRoot.remove();
    panelRoot = null;
    panelElements = null;
    persistWindowState({ tunerOpen: false });
  }

  function handleClose(event) {
    event.preventDefault();
    event.stopPropagation();
    closePanel();
  }

  function openPanel() {
    if (!isTopFrame() || !isTunableSite() || currentMode !== "dark") return;
    if (panelRoot && !panelRoot.hidden) return;
    currentTune = { ...defaultTuneForPage(), ...currentTune, tunerOpen: true };
    renderPanel();
    persistWindowState({ tunerOpen: true });
  }

  function setStatus(text) {
    if (!panelElements?.status) return;
    panelElements.status.textContent = text;
    clearTimeout(panelElements.statusTimer);
    if (text === "Unsaved changes" || text === "Save failed") return;
    panelElements.statusTimer = setTimeout(() => {
      if (panelElements?.status) panelElements.status.textContent = "Saved for this site";
    }, 900);
  }

  function bindSlider(input, key) {
    input.addEventListener("input", () => {
      panelElements.values[key].textContent = input.value;
      previewTune({ [key]: Number(input.value) });
      setStatus("Unsaved changes");
    });
  }

  function createPanel() {
    const host = document.createElement("div");
    host.id = "theme-sync-site-tuner";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        :host([hidden]) { display: none !important; }
        .panel {
          position: fixed;
          z-index: 2147483647;
          width: 236px;
          border-radius: 12px;
          border: 1px solid var(--ts-border);
          background: var(--ts-bg);
          color: var(--ts-fg);
          box-shadow: 0 18px 44px rgba(0, 0, 0, 0.34);
          font: 12px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          overflow: hidden;
        }
        .panel.dark {
          --ts-bg: #11171b;
          --ts-soft: #1c272e;
          --ts-head: #1f3d52;
          --ts-fg: #edf3f7;
          --ts-muted: #b9c7cf;
          --ts-accent: #9cd5ff;
          --ts-border: #455863;
          --ts-track: #32424c;
          --ts-value-bg: #23313a;
          --ts-button-bg: #2e4f64;
          --ts-button-fg: #f2f8ff;
        }
        .panel.light {
          --ts-bg: #f7f8f0;
          --ts-soft: #f1f2ea;
          --ts-head: #355872;
          --ts-fg: #1b2226;
          --ts-muted: #4c5761;
          --ts-accent: #315f7d;
          --ts-border: #c6cad0;
          --ts-track: #dfe2de;
          --ts-value-bg: #e9ebe0;
          --ts-button-bg: #e4f2ff;
          --ts-button-fg: #1c3f57;
        }
        .head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 8px 8px 8px 12px;
          background: var(--ts-head);
          color: #f7f8f0;
          cursor: grab;
          user-select: none;
        }
        .head-text {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          min-width: 0;
          flex: 1;
        }
        .title { font-weight: 700; font-size: 13px; }
        .status { color: rgba(247, 248, 240, 0.78); font-size: 11px; }
        .xp-close {
          width: 22px;
          height: 22px;
          border: 1px solid #7a1f1f;
          border-radius: 3px;
          background: linear-gradient(135deg, #ffb0a2 0%, #e64b35 45%, #9b160f 100%);
          color: #fff;
          box-shadow: inset 1px 1px 0 rgba(255, 255, 255, 0.75), inset -1px -1px 0 rgba(80, 0, 0, 0.38);
          cursor: pointer;
          font: 700 14px/18px Tahoma, Verdana, sans-serif;
          text-align: center;
          padding: 0;
          flex: 0 0 auto;
          text-shadow: 0 1px 0 rgba(0, 0, 0, 0.4);
        }
        .xp-close:hover {
          background: linear-gradient(135deg, #ffd1c8 0%, #f05b42 45%, #b51d13 100%);
        }
        .body { display: grid; gap: 12px; padding: 13px; }
        .preset-label {
          color: var(--ts-muted);
          font-weight: 700;
          margin-bottom: -4px;
        }
        .swatches { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
        .swatch {
          width: 100%;
          aspect-ratio: 1;
          border: 2px solid var(--ts-border);
          border-radius: 10px;
          cursor: pointer;
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
        }
        .swatch.active {
          border-color: var(--ts-accent);
          box-shadow: 0 0 0 2px color-mix(in srgb, var(--ts-accent) 28%, transparent);
        }
        label { display: grid; gap: 6px; color: var(--ts-muted); }
        .checks {
          display: grid;
          gap: 8px;
          padding-top: 2px;
        }
        .check {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          color: var(--ts-fg);
          font-weight: 650;
        }
        .check input {
          width: 16px;
          height: 16px;
          margin: 0;
          accent-color: var(--ts-accent);
          flex: 0 0 auto;
        }
        .row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          color: var(--ts-fg);
          font-weight: 650;
        }
        .row [data-value] {
          min-width: 34px;
          padding: 1px 6px;
          border-radius: 999px;
          background: var(--ts-value-bg);
          color: var(--ts-fg);
          text-align: right;
          font-variant-numeric: tabular-nums;
        }
        input[type="range"] {
          width: 100%;
          height: 16px;
          accent-color: var(--ts-accent);
          cursor: pointer;
        }
        input[type="range"]::-webkit-slider-runnable-track {
          height: 4px;
          border-radius: 999px;
          background: var(--ts-track);
        }
        input[type="range"]::-webkit-slider-thumb {
          margin-top: -5px;
        }
        .actions {
          display: flex;
          justify-content: flex-end;
          padding-top: 2px;
        }
        .save {
          min-width: 72px;
          border: 1px solid var(--ts-border);
          border-radius: 8px;
          background: var(--ts-button-bg);
          color: var(--ts-button-fg);
          cursor: pointer;
          font: 700 12px/1.2 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          padding: 7px 12px;
        }
        .save:hover {
          filter: brightness(1.08);
        }
      </style>
      <section class="panel dark" aria-label="Theme Sync site tuner">
        <div class="head">
          <span class="head-text">
            <span class="title">Site tuner</span>
            <span class="status">Saved for this site</span>
          </span>
          <button class="xp-close" type="button" title="Close site tuner" aria-label="Close site tuner">X</button>
        </div>
        <div class="body">
          <div class="preset-label">Presets</div>
          <div class="swatches"></div>
          <label>
            <span class="row"><span>Brightness</span><span data-value="brightness"></span></span>
            <input data-slider="brightness" type="range" min="0.65" max="1.35" step="0.01">
          </label>
          <label>
            <span class="row"><span>Contrast</span><span data-value="contrast"></span></span>
            <input data-slider="contrast" type="range" min="0.75" max="1.45" step="0.01">
          </label>
          <label>
            <span class="row"><span>Saturation</span><span data-value="saturation"></span></span>
            <input data-slider="saturation" type="range" min="0" max="1.4" step="0.01">
          </label>
          <div class="checks">
            <label class="check">
              <span>Preserve images</span>
              <input data-check="preserveMedia" type="checkbox">
            </label>
            <label class="check">
              <span>Preserve icons/vectors</span>
              <input data-check="preserveVectors" type="checkbox">
            </label>
          </div>
          <label>
            <span class="row"><span>Media brightness</span><span data-value="mediaBrightness"></span></span>
            <input data-slider="mediaBrightness" type="range" min="0.65" max="1.35" step="0.01">
          </label>
          <label>
            <span class="row"><span>Icon brightness</span><span data-value="vectorBrightness"></span></span>
            <input data-slider="vectorBrightness" type="range" min="0.65" max="1.6" step="0.01">
          </label>
          <div class="actions">
            <button class="save" type="button">Save</button>
          </div>
        </div>
      </section>
    `;
    (document.documentElement || document.body).appendChild(host);

    const panel = root.querySelector(".panel");
    const head = root.querySelector(".head");
    const close = root.querySelector(".xp-close");
    const save = root.querySelector(".save");
    const swatches = root.querySelector(".swatches");
    const values = {
      brightness: root.querySelector('[data-value="brightness"]'),
      contrast: root.querySelector('[data-value="contrast"]'),
      saturation: root.querySelector('[data-value="saturation"]'),
      mediaBrightness: root.querySelector('[data-value="mediaBrightness"]'),
      vectorBrightness: root.querySelector('[data-value="vectorBrightness"]')
    };
    const sliders = {
      brightness: root.querySelector('[data-slider="brightness"]'),
      contrast: root.querySelector('[data-slider="contrast"]'),
      saturation: root.querySelector('[data-slider="saturation"]'),
      mediaBrightness: root.querySelector('[data-slider="mediaBrightness"]'),
      vectorBrightness: root.querySelector('[data-slider="vectorBrightness"]')
    };
    const checks = {
      preserveMedia: root.querySelector('[data-check="preserveMedia"]'),
      preserveVectors: root.querySelector('[data-check="preserveVectors"]')
    };

    presets.forEach(({ color, label, tune }) => {
      const button = document.createElement("button");
      button.className = "swatch";
      button.type = "button";
      button.title = `${label} preset`;
      button.dataset.color = color;
      button.style.background = color;
      button.addEventListener("click", () => {
        previewTune(tune);
        setStatus("Unsaved changes");
      });
      swatches.appendChild(button);
    });

    Object.entries(sliders).forEach(([key, input]) => bindSlider(input, key));
    Object.entries(checks).forEach(([key, input]) => {
      input.addEventListener("change", () => {
        previewTune({ [key]: input.checked });
        setStatus("Unsaved changes");
      });
    });
    save.addEventListener("click", async () => {
      setStatus((await persistTune()) ? "Saved for this site" : "Save failed");
    });
    root.addEventListener(
      "pointerdown",
      (event) => {
        if (!event.composedPath().includes(close)) return;
        handleClose(event);
      },
      true
    );
    close.onpointerdown = handleClose;
    close.onmousedown = handleClose;
    close.onclick = handleClose;

    let startX = 0;
    let startY = 0;
    let panelX = 0;
    let panelY = 0;
    head.addEventListener("pointerdown", (event) => {
      startX = event.clientX;
      startY = event.clientY;
      panelX = currentTune.x;
      panelY = currentTune.y;
      head.setPointerCapture(event.pointerId);
    });
    head.addEventListener("pointermove", (event) => {
      if (!head.hasPointerCapture(event.pointerId)) return;
      const x = Math.max(8, panelX + event.clientX - startX);
      const y = Math.max(8, panelY + event.clientY - startY);
      currentTune = { ...currentTune, x, y };
      renderPanel();
    });
    head.addEventListener("pointerup", (event) => {
      if (!head.hasPointerCapture(event.pointerId)) return;
      head.releasePointerCapture(event.pointerId);
      persistWindowState({ x: currentTune.x, y: currentTune.y });
    });

    panelRoot = host;
    panelElements = { panel, swatches, values, sliders, checks, status: root.querySelector(".status"), statusTimer: 0 };
  }

  function renderPanel() {
    if (!isTopFrame() || !isTunableSite() || currentMode !== "dark" || currentTune?.tunerOpen === false) {
      if (panelRoot) panelRoot.hidden = true;
      return;
    }
    if (!panelRoot) createPanel();

    const panelWidth = panelElements.panel.offsetWidth || 236;
    const panelHeight = panelElements.panel.offsetHeight || 320;
    const x = Math.min(window.innerWidth - panelWidth - 12, Math.max(8, currentTune.x));
    const y = Math.min(window.innerHeight - panelHeight - 12, Math.max(8, currentTune.y));
    panelRoot.hidden = false;
    panelElements.panel.classList.toggle("dark", currentMode === "dark");
    panelElements.panel.classList.toggle("light", currentMode !== "dark");
    panelElements.panel.style.left = `${x}px`;
    panelElements.panel.style.top = `${y}px`;

    Object.entries(panelElements.sliders).forEach(([key, input]) => {
      input.value = currentTune[key];
      panelElements.values[key].textContent = String(currentTune[key]);
    });
    Object.entries(panelElements.checks).forEach(([key, input]) => {
      input.checked = Boolean(currentTune[key]);
    });
    panelElements.swatches.querySelectorAll(".swatch").forEach((button) => {
      button.classList.toggle("active", button.dataset.color === currentTune.background);
    });
  }

  applyFromStorage();

  if (hasExtensionContext()) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || (!changes.mode && !changes.disabledSites && !changes.siteTuneSettings)) return;
      applyFromStorage();
    });

    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === "APPLY_MODE") applyFromStorage();
      if (message?.type === "OPEN_TUNER") openPanel();
    });
  }
})();
