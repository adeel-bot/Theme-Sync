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

function render(mode) {
  const selected = mode === "light" || mode === "dark" ? `smart-${mode}` : mode;
  document.body.dataset.theme = selected.endsWith("-dark") ? "dark" : "light";
  segments.forEach((seg) => {
    seg.setAttribute("aria-checked", String(seg.dataset.mode === selected));
  });
  const copy = COPY[selected] || COPY.off;
  statusLine.textContent = copy.line;
  statusDetail.textContent = copy.detail;
  footnote.textContent = copy.note;
  footnote.classList.toggle("warn", Boolean(copy.note));
}

async function init() {
  const { mode } = await chrome.runtime.sendMessage({ type: "GET_MODE" });
  render(mode || "off");
}

segments.forEach((seg) => {
  seg.addEventListener("click", async () => {
    const mode = seg.dataset.mode;
    render(mode);
    await chrome.runtime.sendMessage({ type: "SET_MODE", mode });
  });
});

init();
