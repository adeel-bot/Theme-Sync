(() => {
  const GLOBAL_KEY = "__SCHEME_FORCE_SMART__";
  const EVENT_SOURCE = "scheme-force-extension";
  const PAGE_SOURCE = "scheme-force-page";
  const ROOT_STYLE_ID = "scheme-force-root-style";
  const OVERRIDE_STYLE_ID = "scheme-force-media-style";

  const initialMode = window.__SCHEME_FORCE_INITIAL_MODE || "off";

  if (window[GLOBAL_KEY]) {
    window[GLOBAL_KEY].applyMode(initialMode);
    return;
  }

  const realMatchMedia = window.matchMedia ? window.matchMedia.bind(window) : null;
  const trackedMediaQueries = new Set();
  const externalCss = new Map();
  const requestedExternalUrls = new Set();
  let mode = "off";
  let rebuildTimer = null;
  let observer = null;

  const schemeExpression = /\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)/ig;

  function isSchemeMode(value) {
    return value === "dark" || value === "light" || value === "off";
  }

  function wantedMode() {
    return mode === "dark" || mode === "light" ? mode : null;
  }

  function oppositeOf(value) {
    return value === "dark" ? "light" : "dark";
  }

  function queryMentionsScheme(query) {
    return /prefers-color-scheme/i.test(String(query || ""));
  }

  function queryMatchesForcedMode(query) {
    const forced = wantedMode();
    if (!forced || !queryMentionsScheme(query)) {
      return realMatchMedia ? realMatchMedia(String(query)).matches : false;
    }

    // Remove/neutralize only the prefers-color-scheme part, then let the real
    // browser evaluate the remaining conditions such as width, orientation,
    // pointer, print/screen, etc.
    const transformed = transformMediaText(String(query), forced);
    if (!transformed) return false;
    if (transformed === "all") return true;
    if (transformed === "not all") return false;
    try {
      return realMatchMedia ? realMatchMedia(transformed).matches : false;
    } catch {
      return false;
    }
  }

  function makeMediaQueryEvent(mql, matches) {
    let event;
    try {
      event = new MediaQueryListEvent("change", { media: mql.media, matches });
    } catch {
      event = new Event("change");
      try {
        Object.defineProperty(event, "media", { value: mql.media });
        Object.defineProperty(event, "matches", { value: matches });
      } catch {
        // Older engines may not allow defining these properties. Listener calls below
        // still receive the best event object available.
      }
    }
    return event;
  }

  function notifyTrackedQueries() {
    for (const record of trackedMediaQueries) {
      const nextMatches = queryMatchesForcedMode(record.query);
      if (nextMatches === record.lastMatches) continue;

      record.lastMatches = nextMatches;
      const event = makeMediaQueryEvent(record.mql, nextMatches);

      if (typeof record.onchange === "function") {
        try { record.onchange.call(record.mql, event); } catch {}
      }

      for (const listener of record.listeners) {
        try {
          if (typeof listener === "function") listener.call(record.mql, event);
          else if (listener && typeof listener.handleEvent === "function") listener.handleEvent(event);
        } catch {}
      }

      for (const listener of record.legacyListeners) {
        try { listener.call(record.mql, record.mql); } catch {}
      }
    }
  }

  function patchMatchMedia() {
    if (!realMatchMedia || window.matchMedia.__schemeForcePatched) return;

    const patched = function patchedMatchMedia(query) {
      const mql = realMatchMedia(String(query));
      if (!queryMentionsScheme(query)) return mql;

      const record = {
        query: String(query),
        mql,
        listeners: new Set(),
        legacyListeners: new Set(),
        onchange: null,
        lastMatches: queryMatchesForcedMode(String(query))
      };

      try {
        Object.defineProperty(mql, "matches", {
          configurable: true,
          get: () => queryMatchesForcedMode(record.query)
        });
      } catch {
        // Some engines may reject overriding MediaQueryList properties. In that case
        // the CSS layer still does the heavy lifting.
      }

      try {
        Object.defineProperty(mql, "onchange", {
          configurable: true,
          get: () => record.onchange,
          set: (handler) => { record.onchange = handler; }
        });
      } catch {}

      const nativeAddEventListener = mql.addEventListener ? mql.addEventListener.bind(mql) : null;
      const nativeRemoveEventListener = mql.removeEventListener ? mql.removeEventListener.bind(mql) : null;
      const nativeAddListener = mql.addListener ? mql.addListener.bind(mql) : null;
      const nativeRemoveListener = mql.removeListener ? mql.removeListener.bind(mql) : null;

      mql.addEventListener = function addEventListener(type, listener, options) {
        if (type === "change" && listener) {
          record.listeners.add(listener);
          return;
        }
        if (nativeAddEventListener) nativeAddEventListener(type, listener, options);
      };

      mql.removeEventListener = function removeEventListener(type, listener, options) {
        if (type === "change" && listener) {
          record.listeners.delete(listener);
          return;
        }
        if (nativeRemoveEventListener) nativeRemoveEventListener(type, listener, options);
      };

      mql.addListener = function addListener(listener) {
        if (listener) record.legacyListeners.add(listener);
        else if (nativeAddListener) nativeAddListener(listener);
      };

      mql.removeListener = function removeListener(listener) {
        if (listener) record.legacyListeners.delete(listener);
        else if (nativeRemoveListener) nativeRemoveListener(listener);
      };

      trackedMediaQueries.add(record);
      return mql;
    };

    Object.defineProperty(patched, "__schemeForcePatched", { value: true });
    window.matchMedia = patched;
  }

  function ensureStyle(id) {
    let style = document.getElementById(id);
    if (!style) {
      style = document.createElement("style");
      style.id = id;
      style.setAttribute("data-scheme-force", "true");
      const parent = document.head || document.documentElement;
      parent.appendChild(style);
    }
    return style;
  }

  function applyRootColorScheme() {
    const forced = wantedMode();
    let style = document.getElementById(ROOT_STYLE_ID);

    if (!forced) {
      if (style) style.remove();
      return;
    }

    style = ensureStyle(ROOT_STYLE_ID);
    style.textContent = `:root, html { color-scheme: ${forced} !important; }`;
  }

  function splitTopLevelCommas(text) {
    const parts = [];
    let depth = 0;
    let start = 0;

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (char === "(") depth += 1;
      else if (char === ")") depth = Math.max(0, depth - 1);
      else if (char === "," && depth === 0) {
        parts.push(text.slice(start, i));
        start = i + 1;
      }
    }

    parts.push(text.slice(start));
    return parts;
  }

  function cleanMediaQuery(query) {
    let cleaned = query
      .replace(/\s+/g, " ")
      .replace(/\s+and\s+and\s+/ig, " and ")
      .replace(/^\s*and\s+/i, "")
      .replace(/\s+and\s*$/i, "")
      .replace(/\(\s*\)/g, "")
      .trim();

    cleaned = cleaned
      .replace(/^\s*and\s+/i, "")
      .replace(/\s+and\s*$/i, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!cleaned || cleaned === "only") return "all";
    if (cleaned === "not") return "not all";
    return cleaned;
  }

  function transformSingleMediaQuery(query, forced) {
    const opposite = oppositeOf(forced);
    const wantedRegex = new RegExp(`\\(\\s*prefers-color-scheme\\s*:\\s*${forced}\\s*\\)`, "ig");
    const oppositeRegex = new RegExp(`\\(\\s*prefers-color-scheme\\s*:\\s*${opposite}\\s*\\)`, "ig");

    const hasWanted = wantedRegex.test(query);
    const hasOpposite = oppositeRegex.test(query);
    wantedRegex.lastIndex = 0;
    oppositeRegex.lastIndex = 0;

    if (hasOpposite && !hasWanted) return null;
    if (!hasWanted && !hasOpposite) return query.trim() || "all";
    if (hasWanted && hasOpposite) return null;

    return cleanMediaQuery(query.replace(wantedRegex, " "));
  }

  function transformMediaText(mediaText, forcedArg = wantedMode()) {
    const forced = forcedArg || wantedMode();
    if (!forced) return null;
    if (!queryMentionsScheme(mediaText)) return mediaText;

    const transformed = splitTopLevelCommas(String(mediaText))
      .map((part) => transformSingleMediaQuery(part, forced))
      .filter(Boolean);

    if (!transformed.length) return null;
    return transformed.join(", ") || "all";
  }

  function cssRulesToText(rules) {
    const result = [];
    for (const rule of Array.from(rules || [])) {
      result.push(rule.cssText);
    }
    return result.join("\n");
  }

  function walkCssRules(rules, chunks) {
    for (const rule of Array.from(rules || [])) {
      if (typeof CSSMediaRule !== "undefined" && rule instanceof CSSMediaRule) {
        const originalMedia = rule.media.mediaText;
        if (queryMentionsScheme(originalMedia)) {
          const rewrittenMedia = transformMediaText(originalMedia);
          if (rewrittenMedia) {
            chunks.push(`@media ${rewrittenMedia} {\n${cssRulesToText(rule.cssRules)}\n}`);
          }
        }
        walkCssRules(rule.cssRules, chunks);
        continue;
      }

      if (rule.cssRules) {
        walkCssRules(rule.cssRules, chunks);
      }
    }
  }

  function getOwnerNode(sheet) {
    return sheet && (sheet.ownerNode || sheet.owningElement || null);
  }

  function isSchemeForceSheet(sheet) {
    const node = getOwnerNode(sheet);
    return node && node.nodeType === 1 && node.getAttribute("data-scheme-force") === "true";
  }

  function requestExternalStylesheet(sheet) {
    const node = getOwnerNode(sheet);
    if (!node || node.tagName !== "LINK" || !node.href) return;
    if (!/^https?:\/\//i.test(node.href)) return;

    const key = `${mode}:${node.href}`;
    if (requestedExternalUrls.has(key)) return;
    requestedExternalUrls.add(key);

    window.postMessage({
      source: PAGE_SOURCE,
      type: "SCHEME_FORCE_FETCH_CSS",
      url: node.href,
      mode,
      requestId: `${Date.now()}-${Math.random().toString(36).slice(2)}`
    }, "*");
  }

  function scanAccessibleStylesheets() {
    const chunks = [];
    const sheets = Array.from(document.styleSheets || []);

    for (const sheet of sheets) {
      if (isSchemeForceSheet(sheet)) continue;

      try {
        walkCssRules(sheet.cssRules, chunks);
      } catch {
        requestExternalStylesheet(sheet);
      }
    }

    return chunks;
  }

  function removeComments(text) {
    return text.replace(/\/\*[\s\S]*?\*\//g, "");
  }

  function findMatchingBrace(text, openIndex) {
    let depth = 0;
    let quote = null;
    let escaped = false;

    for (let i = openIndex; i < text.length; i += 1) {
      const char = text[i];

      if (quote) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === quote) quote = null;
        continue;
      }

      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }

      if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) return i;
      }
    }

    return -1;
  }

  function extractRewrittenMediaBlocks(cssText) {
    const css = removeComments(String(cssText || ""));
    const chunks = [];
    let index = 0;

    while (index < css.length) {
      const atMedia = css.indexOf("@media", index);
      if (atMedia === -1) break;

      const brace = css.indexOf("{", atMedia);
      if (brace === -1) break;

      const mediaText = css.slice(atMedia + 6, brace).trim();
      const close = findMatchingBrace(css, brace);
      if (close === -1) break;

      const body = css.slice(brace + 1, close);
      if (queryMentionsScheme(mediaText)) {
        const rewrittenMedia = transformMediaText(mediaText);
        if (rewrittenMedia) {
          chunks.push(`@media ${rewrittenMedia} {\n${body}\n}`);
        }
      }

      // Keep looking inside the block too, because nested CSS can appear in real builds.
      chunks.push(...extractRewrittenMediaBlocks(body));
      index = close + 1;
    }

    return chunks;
  }

  function applyMediaOverrides() {
    const forced = wantedMode();
    let style = document.getElementById(OVERRIDE_STYLE_ID);

    if (!forced) {
      if (style) style.remove();
      return;
    }

    const chunks = scanAccessibleStylesheets();
    for (const value of externalCss.values()) {
      if (value.mode === mode && value.css) chunks.push(value.css);
    }

    style = ensureStyle(OVERRIDE_STYLE_ID);
    style.textContent = chunks.join("\n\n");
  }

  function scheduleRebuild(delay = 80) {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
      applyRootColorScheme();
      applyMediaOverrides();
    }, delay);
  }

  function setupObserver() {
    if (observer || !document.documentElement) return;

    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of Array.from(mutation.addedNodes || [])) {
          if (node.nodeType !== 1) continue;
          const tag = node.tagName;
          if (tag === "STYLE" || tag === "LINK" || node.querySelector?.("style,link[rel~='stylesheet']")) {
            scheduleRebuild(120);
            return;
          }
        }
      }
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function patchHistoryNavigation() {
    const wrap = (name) => {
      const original = history[name];
      if (typeof original !== "function" || original.__schemeForceWrapped) return;

      const wrapped = function wrappedHistoryMethod(...args) {
        const result = original.apply(this, args);
        scheduleRebuild(160);
        return result;
      };

      Object.defineProperty(wrapped, "__schemeForceWrapped", { value: true });
      history[name] = wrapped;
    };

    try {
      wrap("pushState");
      wrap("replaceState");
      window.addEventListener("popstate", () => scheduleRebuild(160));
    } catch {}
  }

  async function tryNavigatorPreferences(nextMode) {
    const preference = navigator.preferences && navigator.preferences.colorScheme;
    if (!preference) return false;

    try {
      if (nextMode === "off") preference.clearOverride();
      else await preference.requestOverride(nextMode);
      return true;
    } catch {
      return false;
    }
  }

  async function applyMode(nextMode) {
    if (!isSchemeMode(nextMode)) nextMode = "off";
    mode = nextMode;

    await tryNavigatorPreferences(mode);
    applyRootColorScheme();
    notifyTrackedQueries();

    if (mode === "off") {
      externalCss.clear();
      applyMediaOverrides();
      return;
    }

    setupObserver();
    scheduleRebuild(0);
  }

  function handleWindowMessage(event) {
    if (event.source !== window) return;
    const data = event.data || {};

    if (data.source === EVENT_SOURCE && data.type === "SCHEME_FORCE_SET_MODE") {
      applyMode(data.mode);
      return;
    }

    if (data.source === EVENT_SOURCE && data.type === "SCHEME_FORCE_CSS_RESPONSE") {
      if (!data.url || data.mode !== mode || typeof data.cssText !== "string") return;
      const css = extractRewrittenMediaBlocks(data.cssText).join("\n\n");
      externalCss.set(data.url, { mode: data.mode, css });
      scheduleRebuild(0);
    }
  }

  patchMatchMedia();
  patchHistoryNavigation();
  window.addEventListener("message", handleWindowMessage);

  const api = {
    get mode() { return mode; },
    applyMode
  };

  window[GLOBAL_KEY] = api;
  applyMode(initialMode);
})();
