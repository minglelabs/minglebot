const chipEl = document.getElementById("step-chip");
const titleEl = document.getElementById("step-title");
const descriptionEl = document.getElementById("step-description");
const bodyEl = document.getElementById("step-body");
const feedbackEl = document.getElementById("feedback");
const backButtonEl = document.getElementById("back-button");
const forwardButtonEl = document.getElementById("forward-button");

const state = {
  step: "provider",
  history: [],
  future: [],
  providers: {},
  selectedProvider: null,
  dataRoot: "-",
  lastRun: null,
  importResult: null,
  lastRuns: []
};

function formatDate(iso) {
  if (!iso) return "none";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const payload = await res.json();
  if (!res.ok) {
    throw new Error(payload.error || JSON.stringify(payload));
  }
  return payload;
}

function setFeedback(message, tone = "") {
  if (!message) {
    feedbackEl.hidden = true;
    feedbackEl.textContent = "";
    feedbackEl.className = "feedback";
    return;
  }

  feedbackEl.hidden = false;
  feedbackEl.textContent = message;
  feedbackEl.className = tone ? `feedback ${tone}` : "feedback";
}

function goto(step, options = {}) {
  const { replace = false, fromHistory = false, fromForward = false } = options;
  if (!replace && state.step !== step) {
    if (fromHistory) {
      // user pressed Back; current step is already pushed to future stack
    } else if (fromForward) {
      // user pressed Forward; current step is already pushed to history stack
    } else {
      state.history.push(state.step);
      state.future = [];
    }
  }
  state.step = step;
  render();
}

function goBack() {
  const prevStep = state.history.pop();
  if (!prevStep) return;
  if (state.step !== prevStep) {
    state.future.push(state.step);
  }
  goto(prevStep, { fromHistory: true });
}

function goForward() {
  const nextStep = state.future.pop();
  if (!nextStep) return;
  if (state.step !== nextStep) {
    state.history.push(state.step);
  }
  goto(nextStep, { fromForward: true });
}

function renderProvider() {
  chipEl.textContent = "Step 1";
  titleEl.textContent = "Choose data source";
  descriptionEl.textContent = "";

  const cards = Object.entries(state.providers)
    .map(
      ([key, provider]) => `
      <button class="provider-btn" data-provider="${key}">
        <span class="provider-name">${provider.label}</span>
        <span class="provider-status">${provider.status}</span>
      </button>
    `
    )
    .join("");

  bodyEl.innerHTML = `
    <div class="provider-grid">${cards}</div>
  `;

  bodyEl.querySelectorAll("[data-provider]").forEach((node) => {
    node.addEventListener("click", () => {
      state.selectedProvider = node.getAttribute("data-provider");
      goto("guide");
    });
  });
}

function renderGuide() {
  const provider = state.providers[state.selectedProvider];
  chipEl.textContent = "Step 2";
  titleEl.textContent = `${provider.label} export`;
  descriptionEl.textContent = "";

  bodyEl.innerHTML = `
    <div class="controls">
      <button class="btn-primary" data-action="open">Open Export Page</button>
    </div>
  `;

  bodyEl.querySelector('[data-action="open"]').addEventListener("click", () => {
    window.open(provider.exportUrl, "_blank", "noopener,noreferrer");
    goto("upload");
  });
}

function renderUpload() {
  const providerKey = state.selectedProvider;
  chipEl.textContent = "Step 3";
  titleEl.textContent = `upload ${providerKey} zip package`;
  descriptionEl.textContent = "";

  bodyEl.innerHTML = `
    <form id="upload-form" class="upload-form">
      <input id="package" name="package" type="file" accept=".zip" hidden />
      <button id="drop-zone" class="drop-zone" type="button">
        <span id="drop-icon" class="drop-icon" hidden aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M6 2h8l4 4v16H6z"></path>
            <path d="M14 2v4h4"></path>
            <path d="M9 11h6M9 14h6M9 17h6"></path>
          </svg>
        </span>
        <span id="drop-title" class="drop-title">Drop ZIP Here</span>
        <span id="drop-file" class="drop-file">or click to choose file</span>
      </button>
      <div class="file-actions">
        <button id="replace-file" class="btn-ghost" type="button">Choose Another</button>
        <button id="clear-file" class="btn-ghost" type="button" disabled>Clear</button>
      </div>
      <div class="controls">
        <button class="btn-primary" type="submit">실행</button>
      </div>
    </form>
  `;

  const form = document.getElementById("upload-form");
  const fileInput = form.querySelector("#package");
  const dropZone = form.querySelector("#drop-zone");
  const dropIconEl = form.querySelector("#drop-icon");
  const dropTitleEl = form.querySelector("#drop-title");
  const dropFileEl = form.querySelector("#drop-file");
  const replaceFileEl = form.querySelector("#replace-file");
  const clearFileEl = form.querySelector("#clear-file");
  let selectedFile = null;

  function resetSelectedFile() {
    selectedFile = null;
    dropZone.classList.remove("has-file", "dragover");
    dropTitleEl.hidden = false;
    dropIconEl.hidden = true;
    dropFileEl.textContent = "or click to choose file";
    fileInput.value = "";
    clearFileEl.disabled = true;
    setFeedback("", "");
  }

  function setSelectedFile(file) {
    selectedFile = file;
    dropZone.classList.add("has-file");
    dropTitleEl.hidden = true;
    dropIconEl.hidden = false;
    dropFileEl.textContent = file.name;
    clearFileEl.disabled = false;
    setFeedback("", "");
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
    } catch {
      // keep selected file in state even if FileList assignment is blocked
    }
  }

  function openFilePicker() {
    fileInput.value = "";
    fileInput.click();
  }

  dropZone.addEventListener("click", openFilePicker);
  replaceFileEl.addEventListener("click", openFilePicker);
  clearFileEl.addEventListener("click", resetSelectedFile);
  fileInput.addEventListener("change", () => {
    const file = fileInput.files && fileInput.files[0];
    if (file) setSelectedFile(file);
  });

  dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropZone.classList.add("dragover");
  });

  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("dragover");
  });

  dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragover");
    const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) setSelectedFile(file);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const file = selectedFile || (fileInput.files && fileInput.files[0]);
    if (!file) {
      setFeedback("Choose a package file first.", "err");
      return;
    }

    goto("running");
    setFeedback("Import running...", "");

    const formData = new FormData();
    formData.set("provider", state.selectedProvider);
    formData.set("package", file);

    try {
      const result = await fetchJson("/api/import", {
        method: "POST",
        body: formData
      });
      state.importResult = result;
      const status = await fetchJson("/api/status");
      const runs = await fetchJson("/api/runs");
      state.dataRoot = status.dataRoot;
      state.lastRun = status.lastRun;
      state.lastRuns = runs;
      setFeedback(`Import complete: ${result.jobId}`, "ok");
      goto("result", { replace: true });
    } catch (error) {
      setFeedback(`Import failed: ${error.message}`, "err");
      goto("upload", { replace: true });
    }
  });
}

function renderRunning() {
  chipEl.textContent = "Step 4";
  titleEl.textContent = "Processing";
  descriptionEl.textContent = "Validating, extracting, deduping, and writing canonical data.";
  bodyEl.innerHTML = `
    <div class="loader" aria-hidden="true"></div>
    <p class="minor">Do not close this tab until result appears.</p>
  `;
}

function renderResult() {
  const result = state.importResult;
  chipEl.textContent = "Done";
  titleEl.textContent = "Import finished";
  descriptionEl.textContent = "";

  const m = result.counters.messages;
  const cmdText = `rg -n "project|invoice|meeting" "${state.dataRoot}/canonical/messages.ndjson"
jq -c 'select(.provider=="${result.provider}")' "${state.dataRoot}/canonical/messages.ndjson" | head
find "${state.dataRoot}/canonical" -type f`;

  bodyEl.innerHTML = `
    <div class="metrics">
      <article class="metric"><div class="k">New</div><div class="v">${m.new}</div></article>
      <article class="metric"><div class="k">Updated</div><div class="v">${m.updated}</div></article>
      <article class="metric"><div class="k">Unchanged</div><div class="v">${m.unchanged}</div></article>
      <article class="metric"><div class="k">Failed</div><div class="v">${m.failed}</div></article>
    </div>
    <div class="controls">
      <button class="btn-primary" data-action="open-folder">Open in Finder</button>
      <button class="btn-ghost" data-action="copy">Copy Commands</button>
    </div>
  `;

  bodyEl.querySelector('[data-action="open-folder"]').addEventListener("click", async () => {
    try {
      await fetchJson("/api/open-import-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: result.jobId })
      });
      setFeedback("Finder opened.", "ok");
    } catch (error) {
      setFeedback(`Could not open folder: ${error.message}`, "err");
    }
  });

  bodyEl.querySelector('[data-action="copy"]').addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(cmdText);
      setFeedback("Commands copied.", "ok");
    } catch {
      setFeedback("Could not copy automatically.", "err");
    }
  });
}

function render() {
  const running = state.step === "running";
  backButtonEl.disabled = running || state.history.length === 0;
  forwardButtonEl.disabled = running || state.future.length === 0;

  switch (state.step) {
    case "provider":
      renderProvider();
      break;
    case "guide":
      renderGuide();
      break;
    case "upload":
      renderUpload();
      break;
    case "running":
      renderRunning();
      break;
    case "result":
      renderResult();
      break;
    default:
      renderProvider();
      break;
  }
}

async function init() {
  const [status, providers, runs] = await Promise.all([
    fetchJson("/api/status"),
    fetchJson("/api/providers"),
    fetchJson("/api/runs")
  ]);

  state.providers = providers;
  state.dataRoot = status.dataRoot;
  state.lastRun = status.lastRun;
  state.lastRuns = runs;
  render();
}

init().catch((error) => {
  setFeedback(`Failed to load initial state: ${error.message}`, "err");
});

backButtonEl.addEventListener("click", () => {
  if (state.step === "running") return;
  goBack();
});

forwardButtonEl.addEventListener("click", () => {
  if (state.step === "running") return;
  goForward();
});
