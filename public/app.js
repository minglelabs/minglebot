const chipEl = document.getElementById("step-chip");
const titleEl = document.getElementById("step-title");
const descriptionEl = document.getElementById("step-description");
const bodyEl = document.getElementById("step-body");
const feedbackEl = document.getElementById("feedback");

const state = {
  step: "provider",
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

function goto(step) {
  state.step = step;
  render();
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
  descriptionEl.textContent = "Open the export page, download your package, then continue.";

  bodyEl.innerHTML = `
    <div class="controls">
      <a class="btn-primary btn-link" href="${provider.exportUrl}" target="_blank" rel="noreferrer">Open Export Page</a>
    </div>
    <p class="minor">After download finishes, move to the upload step.</p>
    <div class="controls">
      <button class="btn-primary" data-action="next">I downloaded it</button>
      <button class="btn-ghost" data-action="back">Back</button>
    </div>
  `;

  bodyEl.querySelector('[data-action="next"]').addEventListener("click", () => goto("upload"));
  bodyEl.querySelector('[data-action="back"]').addEventListener("click", () => goto("provider"));
}

function renderUpload() {
  const provider = state.providers[state.selectedProvider];
  chipEl.textContent = "Step 3";
  titleEl.textContent = "Upload package";
  descriptionEl.textContent = `${provider.label} package only. Then run import.`;

  bodyEl.innerHTML = `
    <form id="upload-form">
      <input id="package" name="package" type="file" required />
      <label class="toggle">
        <input id="retain" name="retainPackage" type="checkbox" />
        Keep downloaded package
      </label>
      <div class="controls">
        <button class="btn-primary" type="submit">Run Import</button>
        <button class="btn-ghost" type="button" data-action="back">Back</button>
      </div>
    </form>
  `;

  const form = document.getElementById("upload-form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const fileInput = form.querySelector("#package");
    if (!fileInput.files || !fileInput.files[0]) {
      setFeedback("Choose a package file first.", "err");
      return;
    }

    goto("running");
    setFeedback("Import running...", "");

    const formData = new FormData();
    formData.set("provider", state.selectedProvider);
    formData.set("package", fileInput.files[0]);
    const retainChecked = form.querySelector("#retain").checked;
    if (retainChecked) formData.set("retainPackage", "true");

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
      goto("result");
    } catch (error) {
      setFeedback(`Import failed: ${error.message}`, "err");
      goto("upload");
    }
  });

  form.querySelector('[data-action="back"]').addEventListener("click", () => goto("guide"));
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
  descriptionEl.textContent = "Your local dataset was updated with dedupe/upsert.";

  const m = result.counters.messages;
  const runRows = state.lastRuns
    .slice(0, 3)
    .map((row) => `<li>${row.provider} • ${row.status} • ${formatDate(row.started_at)}</li>`)
    .join("");

  bodyEl.innerHTML = `
    <div class="metrics">
      <article class="metric"><div class="k">New</div><div class="v">${m.new}</div></article>
      <article class="metric"><div class="k">Updated</div><div class="v">${m.updated}</div></article>
      <article class="metric"><div class="k">Unchanged</div><div class="v">${m.unchanged}</div></article>
      <article class="metric"><div class="k">Failed</div><div class="v">${m.failed}</div></article>
    </div>
    <div class="controls">
      <button class="btn-primary" data-action="again">Import Another</button>
      <button class="btn-ghost" data-action="copy">Copy Commands</button>
    </div>
    <details>
      <summary>Show small details</summary>
      <p class="minor">Data root: ${state.dataRoot}</p>
      <ul class="minor">${runRows || "<li>No run history yet</li>"}</ul>
      <pre id="commands-block">rg -n "project|invoice|meeting" "${state.dataRoot}/canonical/messages.ndjson"
jq -c 'select(.provider=="${result.provider}")' "${state.dataRoot}/canonical/messages.ndjson" | head
find "${state.dataRoot}/canonical" -type f</pre>
    </details>
  `;

  bodyEl.querySelector('[data-action="again"]').addEventListener("click", () => {
    setFeedback("", "");
    goto("provider");
  });

  bodyEl.querySelector('[data-action="copy"]').addEventListener("click", async () => {
    const cmd = bodyEl.querySelector("#commands-block").textContent;
    try {
      await navigator.clipboard.writeText(cmd);
      setFeedback("Commands copied.", "ok");
    } catch {
      setFeedback("Could not copy automatically. Open details and copy manually.", "err");
    }
  });
}

function render() {
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
