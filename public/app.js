const providerCardsEl = document.getElementById("provider-cards");
const dataRootEl = document.getElementById("data-root");
const lastRunEl = document.getElementById("last-run");
const runsTableEl = document.getElementById("runs-table");
const importForm = document.getElementById("import-form");
const importStatusEl = document.getElementById("import-status");
const resultCardEl = document.getElementById("result-card");
const resultSummaryEl = document.getElementById("result-summary");
const commandSnippetsEl = document.getElementById("command-snippets");

function fmt(value) {
  if (!value) return "-";
  return value;
}

function formatDate(iso) {
  if (!iso) return "-";
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

function renderProviderCards(providers) {
  providerCardsEl.innerHTML = "";
  Object.entries(providers).forEach(([key, provider]) => {
    const card = document.createElement("article");
    card.className = "provider";
    const statusClass = provider.status === "ready" ? "ready" : "partial";
    card.innerHTML = `
      <h3>${provider.label}<span class="badge ${statusClass}">${provider.status}</span></h3>
      <a class="btn" href="${provider.exportUrl}" target="_blank" rel="noreferrer">Open export page</a>
      <p style="margin:8px 0 0;color:#9ca3af;font-size:13px">Provider key: ${key}</p>
    `;
    providerCardsEl.appendChild(card);
  });
}

function renderRuns(runs) {
  runsTableEl.innerHTML = "";
  for (const run of runs.slice(0, 20)) {
    const tr = document.createElement("tr");
    const sum = run.summary || { messages: { new: 0, updated: 0, unchanged: 0 } };
    tr.innerHTML = `
      <td>${fmt(run.job_id)}</td>
      <td>${fmt(run.provider)}</td>
      <td>${fmt(run.status)}</td>
      <td>${formatDate(run.started_at)}</td>
      <td>${fmt(sum.messages.new)}</td>
      <td>${fmt(sum.messages.updated)}</td>
      <td>${fmt(sum.messages.unchanged)}</td>
    `;
    runsTableEl.appendChild(tr);
  }
}

function renderResult(result, dataRoot) {
  resultCardEl.hidden = false;

  const counters = result.counters;
  const metrics = [
    ["Status", result.status],
    ["Provider", result.provider],
    ["New messages", counters.messages.new],
    ["Updated messages", counters.messages.updated],
    ["Unchanged messages", counters.messages.unchanged],
    ["Failed messages", counters.messages.failed]
  ];

  resultSummaryEl.innerHTML = "";
  for (const [name, value] of metrics) {
    const block = document.createElement("div");
    block.className = "metric";
    block.innerHTML = `<div class="name">${name}</div><div class="value">${value}</div>`;
    resultSummaryEl.appendChild(block);
  }

  commandSnippetsEl.textContent = [
    `rg -n "project|invoice|meeting" "${dataRoot}/canonical/messages.ndjson"`,
    `jq -c 'select(.provider=="${result.provider}")' "${dataRoot}/canonical/messages.ndjson" | head`,
    `find "${dataRoot}/canonical" -type f`
  ].join("\n");
}

async function refresh() {
  const [status, providers, runs] = await Promise.all([
    fetchJson("/api/status"),
    fetchJson("/api/providers"),
    fetchJson("/api/runs")
  ]);

  dataRootEl.textContent = `Data Root: ${status.dataRoot}`;
  lastRunEl.textContent = `Last Run: ${status.lastRun ? formatDate(status.lastRun.started_at) : "none"}`;
  renderProviderCards(providers);
  renderRuns(runs);

  return status.dataRoot;
}

importForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  importStatusEl.className = "status";
  importStatusEl.textContent = "Import running...";

  const formData = new FormData(importForm);
  try {
    const result = await fetchJson("/api/import", {
      method: "POST",
      body: formData
    });
    const dataRoot = (await fetchJson("/api/status")).dataRoot;
    renderResult(result, dataRoot);
    importStatusEl.className = "status ok";
    importStatusEl.textContent = `Import complete: ${result.jobId}`;
    await refresh();
  } catch (error) {
    importStatusEl.className = "status err";
    importStatusEl.textContent = `Import failed: ${error.message}`;
  }
});

refresh().catch((error) => {
  importStatusEl.className = "status err";
  importStatusEl.textContent = `Failed to load app state: ${error.message}`;
});
