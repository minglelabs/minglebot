import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

type Step = "provider" | "guide" | "upload" | "running" | "result";
type Tone = "" | "ok" | "err";
type ProviderKey = "chatgpt" | "claude";

interface ProviderGuide {
  label: string;
  exportUrl: string;
}

interface RunRecord {
  provider: string;
  status: string;
  started_at: string;
}

interface StatusResponse {
  dataRoot: string;
  lastRun: RunRecord | null;
}

interface ImportCounter {
  new: number;
  updated: number;
  unchanged: number;
  failed: number;
}

interface ImportResult {
  jobId: string;
  provider: ProviderKey;
  status: "NORMALIZED" | "FAILED";
  startedAt: string;
  endedAt: string;
  rawRootPath: string;
  downloadArtifactRetained: boolean;
  counters: {
    conversations: ImportCounter;
    messages: ImportCounter;
    attachments: ImportCounter;
  };
  warnings: string[];
  errors: string[];
}

interface NavState {
  stack: Step[];
  index: number;
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const rawText = await response.text();

  let payload: unknown = {};
  if (rawText) {
    try {
      payload = JSON.parse(rawText);
    } catch {
      payload = { error: rawText };
    }
  }

  if (!response.ok) {
    const errorMessage =
      typeof payload === "object" && payload !== null && "error" in payload
        ? String((payload as { error?: unknown }).error || response.statusText)
        : response.statusText;
    throw new Error(errorMessage);
  }

  return payload as T;
}

function FileArchiveIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[88px] w-[88px] text-[#7a5422]"
      aria-hidden="true"
    >
      <path d="M16 22h2a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v3" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <circle cx="10" cy="20" r="2" />
      <path d="M10 7V6" />
      <path d="M10 12v-1" />
      <path d="M10 18v-2" />
    </svg>
  );
}

export default function App() {
  const [nav, setNav] = useState<NavState>({ stack: ["provider"], index: 0 });
  const step = nav.stack[nav.index] ?? "provider";

  const [providers, setProviders] = useState<Record<string, ProviderGuide>>({});
  const [selectedProvider, setSelectedProvider] = useState<ProviderKey | null>(null);
  const [dataRoot, setDataRoot] = useState("-");
  const [lastRun, setLastRun] = useState<RunRecord | null>(null);
  const [lastRuns, setLastRuns] = useState<RunRecord[]>([]);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const [feedback, setFeedbackState] = useState<{ message: string; tone: Tone }>({
    message: "",
    tone: ""
  });

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const setFeedback = useCallback((message: string, tone: Tone = "") => {
    setFeedbackState({ message, tone });
  }, []);

  const goto = useCallback((next: Step, options?: { replace?: boolean }) => {
    setNav((prev) => {
      const active = prev.stack[prev.index] ?? "provider";

      if (options?.replace) {
        if (active === next) return prev;
        const updated = [...prev.stack];
        updated[prev.index] = next;
        return { stack: updated, index: prev.index };
      }

      if (active === next) return prev;
      const trimmed = prev.stack.slice(0, prev.index + 1);
      trimmed.push(next);
      return { stack: trimmed, index: prev.index + 1 };
    });
  }, []);

  const goBack = useCallback(() => {
    setNav((prev) => (prev.index > 0 ? { stack: prev.stack, index: prev.index - 1 } : prev));
  }, []);

  const goForward = useCallback(() => {
    setNav((prev) =>
      prev.index < prev.stack.length - 1 ? { stack: prev.stack, index: prev.index + 1 } : prev
    );
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function init(): Promise<void> {
      try {
        const [status, providerMap, runs] = await Promise.all([
          fetchJson<StatusResponse>("/api/status"),
          fetchJson<Record<string, ProviderGuide>>("/api/providers"),
          fetchJson<RunRecord[]>("/api/runs")
        ]);

        if (cancelled) return;
        setProviders(providerMap);
        setDataRoot(status.dataRoot || "-");
        setLastRun(status.lastRun || null);
        setLastRuns(runs);
      } catch (error) {
        if (cancelled) return;
        setFeedback(
          `Failed to load app state: ${error instanceof Error ? error.message : String(error)}`,
          "err"
        );
      }
    }

    void init();

    return () => {
      cancelled = true;
    };
  }, [setFeedback]);

  useEffect(() => {
    if (selectedProvider && !providers[selectedProvider]) {
      setSelectedProvider(null);
    }
  }, [providers, selectedProvider]);

  useEffect(() => {
    if ((step === "guide" || step === "upload") && (!selectedProvider || !providers[selectedProvider])) {
      goto("provider", { replace: true });
    }
  }, [goto, providers, selectedProvider, step]);

  const selectFile = useCallback(
    (file: File | null) => {
      if (!file) return;
      setSelectedFile(file);
      setFeedback("");
    },
    [setFeedback]
  );

  const clearSelectedFile = useCallback(() => {
    setSelectedFile(null);
    setDragOver(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    setFeedback("");
  }, [setFeedback]);

  const openFilePicker = useCallback(() => {
    if (!fileInputRef.current) return;
    fileInputRef.current.value = "";
    fileInputRef.current.click();
  }, []);

  const handleImportSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!selectedFile) {
        setFeedback("Choose a package file first.", "err");
        return;
      }

      if (!selectedProvider) {
        setFeedback("Choose provider first.", "err");
        goto("provider", { replace: true });
        return;
      }

      goto("running");
      setFeedback("Import running...");

      const formData = new FormData();
      formData.set("provider", selectedProvider);
      formData.set("package", selectedFile);

      try {
        const result = await fetchJson<ImportResult>("/api/import", {
          method: "POST",
          body: formData
        });

        const [status, runs] = await Promise.all([
          fetchJson<StatusResponse>("/api/status"),
          fetchJson<RunRecord[]>("/api/runs")
        ]);

        setImportResult(result);
        setDataRoot(status.dataRoot || "-");
        setLastRun(status.lastRun || null);
        setLastRuns(runs);
        setFeedback(`Import complete: ${result.jobId}`, "ok");
        goto("result", { replace: true });
      } catch (error) {
        setFeedback(`Import failed: ${error instanceof Error ? error.message : String(error)}`, "err");
        goto("upload", { replace: true });
      }
    },
    [goto, selectedFile, selectedProvider, setFeedback]
  );

  const commandText = useMemo(() => {
    if (!importResult) return "";
    return `rg -n "project|invoice|meeting" "${dataRoot}/canonical/messages.ndjson"
jq -c 'select(.provider=="${importResult.provider}")' "${dataRoot}/canonical/messages.ndjson" | head
find "${dataRoot}/canonical" -type f`;
  }, [dataRoot, importResult]);

  const provider = selectedProvider ? providers[selectedProvider] : undefined;

  const isRunning = step === "running";
  const canGoBack = !isRunning && nav.index > 0;
  const canGoForward = !isRunning && nav.index < nav.stack.length - 1;

  let chip = "Step 1";
  let title = "Choose data source";
  let description = "";

  if (step === "guide") {
    chip = "Step 2";
    title = provider ? `${provider.label} export` : "Export";
  } else if (step === "upload") {
    chip = "Step 3";
    title = `upload ${selectedProvider || ""} zip package`;
  } else if (step === "running") {
    chip = "Step 4";
    title = "Processing";
    description = "Validating, extracting, deduping, and writing canonical data.";
  } else if (step === "result") {
    chip = "Done";
    title = "Import finished";
  }

  const primaryButtonClass =
    "inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-[#f97316] to-[#f59e0b] px-4 py-2.5 text-sm font-bold text-[#2f1e04]";
  const ghostButtonClass =
    "inline-flex items-center justify-center rounded-xl border border-[#f2d29a] bg-[#fff5dd] px-4 py-2.5 text-sm font-bold text-[#6a4d2e]";

  return (
    <main className="mx-auto max-w-[760px] px-4 pb-12 pt-8">
      <header className="mb-4 text-center">
        <div className="logo-font text-[40px] font-semibold tracking-[0.2px]">Minglebot</div>
      </header>

      <section className="rounded-[20px] border border-[#f1d9aa] bg-gradient-to-b from-[#fffef9] to-[#fff6df] px-5 py-6 shadow-[0_18px_34px_rgba(170,98,9,0.12),0_4px_10px_rgba(170,98,9,0.08)]">
        <div className="inline-block rounded-full border border-[#f7c977] bg-[#ffe3ad] px-2.5 py-1 text-xs font-bold text-[#7c4a10]">
          {chip}
        </div>
        <h1 className="mb-2 mt-3 text-[28px] leading-tight">{title}</h1>
        <p className="min-h-[22px] text-[15px] text-[#6b5a43]">{description}</p>

        <div className="mt-6 grid gap-4">
          {step === "provider" && (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2.5">
              {Object.entries(providers).map(([key, item]) => (
                <button
                  key={key}
                  type="button"
                  className="cursor-pointer rounded-[14px] border border-[#f1d9aa] bg-[#fffaf1] px-3 py-3 text-left text-[#2a2012] transition hover:-translate-y-px hover:border-[#f2bc61]"
                  onClick={() => {
                    setSelectedProvider(key as ProviderKey);
                    clearSelectedFile();
                    goto("guide");
                  }}
                >
                  <span className="block text-base font-bold">{item.label}</span>
                </button>
              ))}
            </div>
          )}

          {step === "guide" && provider && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={primaryButtonClass}
                onClick={() => {
                  window.open(provider.exportUrl, "_blank", "noopener,noreferrer");
                  goto("upload");
                }}
              >
                Open Export Page
              </button>
            </div>
          )}

          {step === "upload" && (
            <form className="grid justify-items-center gap-4" onSubmit={handleImportSubmit}>
              <input
                ref={fileInputRef}
                name="package"
                type="file"
                accept=".zip"
                className="hidden"
                onChange={(event) => selectFile(event.target.files?.[0] || null)}
              />

              <button
                type="button"
                className={`mx-auto grid aspect-square w-full max-w-[360px] place-content-center gap-2 rounded-[20px] border-2 px-5 py-5 text-center transition ${
                  selectedFile
                    ? "border-solid border-[#ecab52] bg-gradient-to-b from-[#fff0cd] to-[#ffe6b7]"
                    : "border-dashed border-[#d7ae6f] bg-gradient-to-b from-[#fff7e2] to-[#fff2d6]"
                } ${
                  dragOver ? "border-[#f97316] bg-gradient-to-b from-[#fff1cd] to-[#ffe8bd]" : ""
                } hover:-translate-y-px hover:border-[#ee9b35]`}
                onClick={openFilePicker}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragOver(false);
                  selectFile(event.dataTransfer.files?.[0] || null);
                }}
              >
                {selectedFile && <FileArchiveIcon />}
                {!selectedFile && <span className="text-[22px] font-extrabold text-[#5e431f]">Drop ZIP Here</span>}
                <span
                  className={`max-w-[90%] break-words ${
                    selectedFile
                      ? "text-[17px] font-extrabold leading-snug text-[#5e431f]"
                      : "text-sm text-[#8a6a45]"
                  }`}
                >
                  {selectedFile ? selectedFile.name : "or click to choose file"}
                </span>
              </button>

              <div className="flex w-full max-w-[360px] justify-center gap-2">
                <button type="button" className={`${ghostButtonClass} min-w-[132px]`} onClick={openFilePicker}>
                  Choose Another
                </button>
                <button
                  type="button"
                  className={`${ghostButtonClass} min-w-[132px] disabled:cursor-not-allowed disabled:opacity-45`}
                  disabled={!selectedFile}
                  onClick={clearSelectedFile}
                >
                  Clear
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                <button type="submit" className={primaryButtonClass}>
                  실행
                </button>
              </div>
            </form>
          )}

          {step === "running" && (
            <>
              <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-[#f8ddb0] border-t-[#e37a1a]" aria-hidden="true" />
              <p className="text-[13px] text-[#6b5a43]">Do not close this tab until result appears.</p>
            </>
          )}

          {step === "result" && importResult && (
            <>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <article className="rounded-xl border border-[#f1d9aa] bg-[#fffaf0] p-2.5">
                  <div className="text-xs text-[#7d5f3e]">New</div>
                  <div className="mt-1 text-[20px] font-extrabold">{importResult.counters.messages.new}</div>
                </article>
                <article className="rounded-xl border border-[#f1d9aa] bg-[#fffaf0] p-2.5">
                  <div className="text-xs text-[#7d5f3e]">Updated</div>
                  <div className="mt-1 text-[20px] font-extrabold">{importResult.counters.messages.updated}</div>
                </article>
                <article className="rounded-xl border border-[#f1d9aa] bg-[#fffaf0] p-2.5">
                  <div className="text-xs text-[#7d5f3e]">Unchanged</div>
                  <div className="mt-1 text-[20px] font-extrabold">{importResult.counters.messages.unchanged}</div>
                </article>
                <article className="rounded-xl border border-[#f1d9aa] bg-[#fffaf0] p-2.5">
                  <div className="text-xs text-[#7d5f3e]">Failed</div>
                  <div className="mt-1 text-[20px] font-extrabold">{importResult.counters.messages.failed}</div>
                </article>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={primaryButtonClass}
                  onClick={async () => {
                    try {
                      await fetchJson<{ ok: boolean; path: string }>("/api/open-import-folder", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ jobId: importResult.jobId })
                      });
                      setFeedback("Finder opened.", "ok");
                    } catch (error) {
                      setFeedback(
                        `Could not open folder: ${error instanceof Error ? error.message : String(error)}`,
                        "err"
                      );
                    }
                  }}
                >
                  Open in Finder
                </button>

                <button
                  type="button"
                  className={ghostButtonClass}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(commandText);
                      setFeedback("Commands copied.", "ok");
                    } catch {
                      setFeedback("Could not copy automatically.", "err");
                    }
                  }}
                >
                  Copy Commands
                </button>
              </div>
            </>
          )}

          {step === "result" && !importResult && (
            <p className="text-sm text-[#6b5a43]">No import result to display.</p>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className={`${ghostButtonClass} min-h-10 min-w-12 px-3 text-[20px] font-extrabold ${
              canGoBack ? "" : "cursor-not-allowed opacity-45"
            }`}
            onClick={goBack}
            disabled={!canGoBack}
            aria-label="Back"
          >
            ←
          </button>
          <button
            type="button"
            className={`${ghostButtonClass} min-h-10 min-w-12 px-3 text-[20px] font-extrabold ${
              canGoForward ? "" : "cursor-not-allowed opacity-45"
            }`}
            onClick={goForward}
            disabled={!canGoForward}
            aria-label="Forward"
          >
            →
          </button>
        </div>

        {feedback.message && (
          <p className={`mt-3 text-sm ${feedback.tone === "ok" ? "text-[#0f766e]" : "text-[#b91c1c]"}`}>
            {feedback.message}
          </p>
        )}
      </section>

      {lastRun && <div className="sr-only">Last run: {lastRun.provider}</div>}
      {lastRuns.length === 0 && <div className="sr-only">No run history yet</div>}
    </main>
  );
}
