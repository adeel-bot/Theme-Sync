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
    hintTimer: 0
  };
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
    tryPreferenceAPI();
    applyThemeHints();
    rewriteStyles();
    notifyMediaLists();
  });
})();
