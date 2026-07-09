(() => {
  if (window.__schemeForcePageLoaded) return;
  window.__schemeForcePageLoaded = true;

  const state = {
    mode: "off",
    matchMedia: window.matchMedia.bind(window),
    mediaLists: new Set(),
    originalMedia: new WeakMap(),
    originalHints: new WeakMap(),
    touchedHints: new Set(),
    applyingHints: false,
    hintTimer: 0,
    siteTune: null
  };
  const googleWorkspaceStyleId = "theme-sync-google-workspace";
  const colorQuery = /\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)/i;
  const hintAttrs = [
    "data-mode",
    "data-theme",
    "data-color-mode",
    "data-color-scheme",
    "data-theme-mode",
    "data-bs-theme",
    "data-mui-color-scheme",
    "data-md-color-scheme",
    "data-scheme",
    "data-ui-theme",
    "data-app-theme",
    "data-site-theme",
    "color-mode",
    "color-scheme",
    "theme",
    "theme-mode"
  ];
  const themeValuePairs = [
    ["dark", "light"],
    ["dark-mode", "light-mode"],
    ["mode-dark", "mode-light"],
    ["theme-dark", "theme-light"],
    ["dark-theme", "light-theme"],
    ["darkmode", "lightmode"],
    ["is-dark", "is-light"],
    ["has-dark", "has-light"],
    ["scheme-dark", "scheme-light"],
    ["color-scheme-dark", "color-scheme-light"]
  ];
  const themeValueMap = new Map(
    themeValuePairs.flatMap(([dark, light]) => [
      [dark, { dark, light }],
      [light, { dark, light }]
    ])
  );
  const hintSelector = [
    ...hintAttrs.map((attr) => `[${attr}]`),
    ...themeValuePairs.flatMap(([dark, light]) => [`.${dark}`, `.${light}`])
  ].join(",");
  const defaultSiteTune = {
    background: "#0b0d0e",
    brightness: 1,
    contrast: 1.05,
    saturation: 0.3,
    mediaBrightness: 1,
    vectorBrightness: 1.15,
    preserveMedia: true,
    preserveVectors: true
  };

  function clamp(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return min;
    return Math.min(max, Math.max(min, number));
  }

  function normalizeSiteTune(value) {
    const tune = value && typeof value === "object" ? value : {};
    return {
      background: /^#[0-9a-f]{6}$/i.test(tune.background) ? tune.background : defaultSiteTune.background,
      brightness: clamp(tune.brightness ?? defaultSiteTune.brightness, 0.65, 1.35),
      contrast: clamp(tune.contrast ?? defaultSiteTune.contrast, 0.75, 1.45),
      saturation: clamp(tune.saturation ?? defaultSiteTune.saturation, 0, 1.4),
      mediaBrightness: clamp(tune.mediaBrightness ?? defaultSiteTune.mediaBrightness, 0.65, 1.35),
      vectorBrightness: clamp(tune.vectorBrightness ?? defaultSiteTune.vectorBrightness, 0.65, 1.6),
      preserveMedia: tune.preserveMedia !== false,
      preserveVectors: tune.preserveVectors !== false
    };
  }

  function queryMatch(query) {
    if (state.mode === "off" || !colorQuery.test(query)) return state.matchMedia(query).matches;
    return state.matchMedia(rewriteMedia(query)).matches;
  }

  window.matchMedia = (query) => {
    const text = String(query);
    const native = state.matchMedia(text);
    if (!colorQuery.test(text)) return native;

    const listeners = new Set();
    const item = { text, native, listeners, onchange: null, last: queryMatch(text) };
    state.mediaLists.add(item);

    return new Proxy(native, {
      get(target, prop) {
        if (prop === "matches") return queryMatch(text);
        if (prop === "addListener") return (listener) => listeners.add(listener);
        if (prop === "removeListener") return (listener) => listeners.delete(listener);
        if (prop === "addEventListener") {
          return (type, listener) => {
            if (type === "change") listeners.add(listener);
            else target.addEventListener(type, listener);
          };
        }
        if (prop === "removeEventListener") {
          return (type, listener) => {
            if (type === "change") listeners.delete(listener);
            else target.removeEventListener(type, listener);
          };
        }
        if (prop === "onchange") return item.onchange;
        const value = target[prop];
        return typeof value === "function" ? value.bind(target) : value;
      },
      set(target, prop, value) {
        if (prop === "onchange") {
          item.onchange = value;
          return true;
        }
        target[prop] = value;
        return true;
      }
    });
  };

  function rewriteQuery(query) {
    const match = query.match(colorQuery);
    if (!match) return query;
    if (match[1].toLowerCase() !== state.mode) return "not all";

    const cleaned = query
      .replace(/\s+and\s+\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)/gi, "")
      .replace(/\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)\s+and\s+/gi, "")
      .replace(/\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)/gi, "all")
      .replace(/\ball\s+and\s+/gi, "")
      .replace(/\s+and\s+all\b/gi, "")
      .trim();

    return cleaned || "all";
  }

  function rewriteMedia(mediaText) {
    return mediaText
      .split(",")
      .map((query) => rewriteQuery(query.trim()))
      .join(", ");
  }

  function walkRules(rules) {
    Array.from(rules).forEach((rule) => {
      if (rule.media && colorQuery.test(rule.media.mediaText)) {
        if (!state.originalMedia.has(rule)) state.originalMedia.set(rule, rule.media.mediaText);
        rule.media.mediaText =
          state.mode === "off" ? state.originalMedia.get(rule) : rewriteMedia(state.originalMedia.get(rule));
      }
      if (rule.cssRules) {
        try {
          walkRules(rule.cssRules);
        } catch {
          // Cross-origin stylesheets cannot be read here.
        }
      }
    });
  }

  function rewriteStyles() {
    Array.from(document.styleSheets).forEach((sheet) => {
      try {
        walkRules(sheet.cssRules);
      } catch {
        // Cross-origin stylesheets cannot be read here.
      }
    });
  }

  function themeHintTargets() {
    const targets = new Set([document.documentElement, document.body].filter(Boolean));
    document.querySelectorAll(hintSelector).forEach((node) => targets.add(node));
    return targets;
  }

  function rememberHint(node) {
    if (state.originalHints.has(node)) return state.originalHints.get(node);
    const snapshot = {
      className: node.getAttribute("class"),
      attrs: Object.fromEntries(hintAttrs.map((attr) => [attr, node.getAttribute(attr)]))
    };
    state.originalHints.set(node, snapshot);
    state.touchedHints.add(node);
    return snapshot;
  }

  function replacementFor(value) {
    const pair = themeValueMap.get(String(value || "").toLowerCase());
    return pair ? pair[state.mode] : null;
  }

  function restoreThemeHints() {
    state.applyingHints = true;
    try {
      state.touchedHints.forEach((node) => {
        const snapshot = state.originalHints.get(node);
        if (!snapshot || !node.isConnected) return;

        if (snapshot.className === null) node.removeAttribute("class");
        else node.setAttribute("class", snapshot.className);

        hintAttrs.forEach((attr) => {
          const value = snapshot.attrs[attr];
          if (value === null) node.removeAttribute(attr);
          else node.setAttribute(attr, value);
        });
      });
      state.originalHints = new WeakMap();
      state.touchedHints.clear();
    } finally {
      state.applyingHints = false;
    }
  }

  function applyThemeHints() {
    if (state.mode === "off") {
      restoreThemeHints();
      return;
    }

    state.applyingHints = true;
    try {
      themeHintTargets().forEach((node) => {
        let changed = false;

        hintAttrs.forEach((attr) => {
          if (!node.hasAttribute(attr)) return;
          const replacement = replacementFor(node.getAttribute(attr));
          if (replacement) {
            rememberHint(node);
            node.setAttribute(attr, replacement);
            changed = true;
          }
        });

        themeValuePairs.forEach(([dark, light]) => {
          const from = state.mode === "dark" ? light : dark;
          const to = state.mode === "dark" ? dark : light;
          if (!node.classList.contains(from)) return;
          rememberHint(node);
          node.classList.replace(from, to);
          changed = true;
        });

        // ponytail: only touch existing light/dark hints; brand values like data-theme="claude" are left alone.
        if (!changed) return;
      });
    } finally {
      state.applyingHints = false;
    }
  }

  function scheduleThemeHints() {
    if (state.mode === "off" || state.applyingHints) return;
    clearTimeout(state.hintTimer);
    state.hintTimer = setTimeout(() => applyThemeHints(), 50);
  }

  function applyGoogleWorkspaceFallback() {
    const host = location.hostname;
    const isWorkspace = host === "docs.google.com" || host === "drive.google.com";
    const isPinch = host === "getpinch.com.au" || host === "web.getpinch.com.au";
    const isSheets = host === "docs.google.com" && location.pathname.includes("/spreadsheets/");
    const tune = normalizeSiteTune(state.siteTune || (isSheets ? defaultSiteTune : { saturation: 1, contrast: 1, brightness: 1 }));
    const pageFilter = `invert(1) hue-rotate(180deg) saturate(${tune.saturation}) brightness(${tune.brightness}) contrast(${tune.contrast})`;
    const mediaFilter = tune.preserveMedia ? `${pageFilter} brightness(${tune.mediaBrightness})` : `brightness(${tune.mediaBrightness})`;
    const vectorFilter = tune.preserveVectors ? `${pageFilter} brightness(${tune.vectorBrightness})` : `brightness(${tune.vectorBrightness})`;
    const canvasFilter = isSheets ? "none" : mediaFilter;
    const pinchCss = isPinch
      ? `
      html,
      body {
        overflow-x: clip !important;
      }

      body,
      body * {
        color: #111 !important;
      }

      body,
      main,
      section,
      article,
      aside,
      header,
      footer,
      nav,
      .container,
      .content,
      .main-content,
      .page-content,
      .card,
      .panel,
      .well,
      .modal-content,
      .table,
      table,
      thead,
      tbody,
      tr,
      td,
      th,
      input,
      select,
      textarea {
        background-color: #fff !important;
      }
      `
      : "";
    let style = document.getElementById(googleWorkspaceStyleId);

    if ((!isWorkspace && !isPinch) || state.mode !== "dark") {
      if (style) style.remove();
      return;
    }

    if (!style) {
      style = document.createElement("style");
      style.id = googleWorkspaceStyleId;
      document.documentElement.appendChild(style);
    }

    style.textContent = `
      html {
        background: ${tune.background} !important;
      }

      body {
        background: ${tune.background} !important;
        filter: ${pageFilter} !important;
      }

      img,
      video,
      image,
      [style*="background-image"] {
        filter: ${mediaFilter} !important;
      }

      svg {
        filter: ${vectorFilter} !important;
      }

      canvas {
        filter: ${canvasFilter} !important;
      }

      * {
        text-shadow: none !important;
      }

      ${pinchCss}
    `;
  }

  function notifyMediaLists() {
    state.mediaLists.forEach((item) => {
      const matches = queryMatch(item.text);
      if (matches === item.last) return;
      item.last = matches;
      const event = { matches, media: item.native.media };
      if (typeof item.onchange === "function") item.onchange.call(item.native, event);
      item.listeners.forEach((listener) => {
        if (typeof listener === "function") listener.call(item.native, event);
        else listener?.handleEvent?.(event);
      });
    });
  }

  async function tryPreferenceAPI() {
    const pref = navigator.preferences?.colorScheme;
    if (!pref) return;
    try {
      if (state.mode === "off") pref.clearOverride();
      else await pref.requestOverride(state.mode);
    } catch {
      // Experimental API: absence or denial just means Smart Mode continues.
    }
  }

  const observer = new MutationObserver(() => {
    rewriteStyles();
    scheduleThemeHints();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", ...hintAttrs] });

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== "scheme-force") return;
    state.mode = event.data.mode === "light" || event.data.mode === "dark" ? event.data.mode : "off";
    state.siteTune = normalizeSiteTune(event.data.siteTune);
    tryPreferenceAPI();
    applyThemeHints();
    applyGoogleWorkspaceFallback();
    rewriteStyles();
    notifyMediaLists();
  });
})();
