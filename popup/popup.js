const COPY = {
  off: {
    line: "Not overriding anything.",
    detail: "Sites use whatever color scheme they'd normally pick - your OS setting, or their own default.",
    note: ""
  },
  "smart-light": {
    line: "Smart Light is on.",
    detail: "Sites will prefer light mode without needing their own theme switch.",
    note: ""
  },
  "smart-dark": {
    line: "Smart Dark is on.",
    detail: "Sites will prefer dark mode without needing their own theme switch.",
    note: ""
  },
  "native-light": {
    line: "Native Light is on.",
    detail: "Most accurate override. Chrome may show its debugging warning.",
    note: "If that warning is canceled, Theme Sync falls back to Smart Light."
  },
  "native-dark": {
    line: "Native Dark is on.",
    detail: "Most accurate override. Chrome may show its debugging warning.",
    note: "If that warning is canceled, Theme Sync falls back to Smart Dark."
  },
  light: {
    line: "Smart Light is on.",
    detail: "Sites will prefer light mode without needing their own theme switch.",
    note: ""
  },
  dark: {
    line: "Smart Dark is on.",
    detail: "Sites will prefer dark mode without needing their own theme switch.",
    note: ""
  }
};

const segments = Array.from(document.querySelectorAll(".segment"));
const statusLine = document.getElementById("statusLine");
const statusDetail = document.getElementById("statusDetail");
const footnote = document.getElementById("footnote");
const siteToggle = document.getElementById("siteToggle");
const disableSite = document.getElementById("disableSite");
const siteLabel = document.getElementById("siteLabel");
const openTuner = document.getElementById("openTuner");
const openTunerTitle = document.getElementById("openTunerTitle");
const openTunerDetail = document.getElementById("openTunerDetail");

let currentMode = "off";
let currentSiteState = {};

function render(mode, state = {}) {
  currentMode = mode || "off";
  currentSiteState = { ...currentSiteState, ...state };
  const selected = mode === "light" || mode === "dark" ? `smart-${mode}` : mode;
  document.body.dataset.theme = selected.endsWith("-dark") ? "dark" : "light";
  segments.forEach((seg) => {
    seg.setAttribute("aria-checked", String(seg.dataset.mode === selected));
  });
  const copy = currentSiteState.siteDisabled ? {
    line: "Off for this site.",
    detail: "Theme Sync will remember this site and leave it alone.",
    note: ""
  } : COPY[selected] || COPY.off;
  statusLine.textContent = copy.line;
  statusDetail.textContent = copy.detail;
  footnote.textContent = copy.note;
  footnote.classList.toggle("warn", Boolean(copy.note));

  siteToggle.hidden = !currentSiteState.canToggleSite;
  disableSite.checked = Boolean(currentSiteState.siteDisabled);
  siteLabel.textContent = currentSiteState.siteLabel ? currentSiteState.siteLabel : "";

  const canOpenTuner = currentSiteState.canTuneSite && selected.endsWith("-dark") && !currentSiteState.siteDisabled;
  openTuner.hidden = !canOpenTuner;
  const tunerOpen = currentSiteState.tunerOpen !== false;
  openTunerTitle.textContent = tunerOpen ? "Site tuner is open" : "Open site tuner";
  openTunerDetail.textContent = tunerOpen ? "Close it from the tuner window" : "Draggable controls for this site";
}

async function init() {
  const state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
  if (state.siteOrigin) {
    const { siteTuneSettings = {} } = await chrome.storage.local.get("siteTuneSettings");
    state.tunerOpen = siteTuneSettings[state.siteOrigin]?.tunerOpen !== false;
  }
  render(state.mode || "off", state);
}

segments.forEach((seg) => {
  seg.addEventListener("click", async () => {
    const mode = seg.dataset.mode;
    render(mode);
    await chrome.runtime.sendMessage({ type: "SET_MODE", mode });
  });
});

disableSite.addEventListener("change", async () => {
  const response = await chrome.runtime.sendMessage({
    type: "SET_SITE_DISABLED",
    disabled: disableSite.checked
  });
  render(currentMode, {
    canToggleSite: true,
    siteDisabled: disableSite.checked,
    siteLabel: response?.origin ? new URL(response.origin).hostname : siteLabel.textContent
  });
});

async function sendToActiveTab(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  await chrome.tabs.sendMessage(tab.id, message).catch(() => {});
}

openTuner.addEventListener("click", async () => {
  const selected = currentMode === "light" || currentMode === "dark" ? `smart-${currentMode}` : currentMode;
  if (!currentSiteState.siteOrigin || !selected.endsWith("-dark")) return;
  await sendToActiveTab({ type: "OPEN_TUNER" });
  render(currentMode, { tunerOpen: true });
});

init();
