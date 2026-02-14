import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

type Step = "provider" | "guide" | "upload" | "running" | "result" | "viewer";
type Tone = "" | "ok" | "err";
type ProviderKey = "chatgpt" | "claude" | "gemini" | "cursor";

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

interface ClaudeConversationSummary {
  id: string;
  title?: string;
  created_at?: string;
  updated_at?: string;
  message_count: number;
  last_message_preview?: string;
}

interface ClaudeMessageItem {
  id: string;
  conversation_id: string;
  provider?: string;
  model?: string;
  role: string;
  text: string;
  created_at?: string;
  attachment_ids?: string[];
}

interface NavState {
  stack: Step[];
  index: number;
}

const DEFAULT_NAV_STATE: NavState = { stack: ["provider"], index: 0 };

function isStep(value: unknown): value is Step {
  return (
    value === "provider" ||
    value === "guide" ||
    value === "upload" ||
    value === "running" ||
    value === "result" ||
    value === "viewer"
  );
}

function isNavState(value: unknown): value is NavState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { stack?: unknown; index?: unknown };
  if (!Array.isArray(candidate.stack)) return false;
  if (typeof candidate.index !== "number") return false;
  if (!Number.isInteger(candidate.index)) return false;
  if (!candidate.stack.every((item) => isStep(item))) return false;
  if (candidate.stack.length === 0) return false;
  if (candidate.index < 0 || candidate.index >= candidate.stack.length) return false;
  return true;
}

function buildNextNav(prev: NavState, next: Step, replace = false): NavState {
  const active = prev.stack[prev.index] ?? "provider";
  if (active === next) return prev;

  if (replace) {
    const updated = [...prev.stack];
    updated[prev.index] = next;
    return { stack: updated, index: prev.index };
  }

  const trimmed = prev.stack.slice(0, prev.index + 1);
  trimmed.push(next);
  return { stack: trimmed, index: prev.index + 1 };
}

function stepFromLocation(): Step | null {
  const url = new URL(window.location.href);
  const step = url.searchParams.get("step");
  return isStep(step) ? step : null;
}

function urlWithStep(step: Step): string {
  const url = new URL(window.location.href);
  url.searchParams.set("step", step);
  return `${url.pathname}${url.search}${url.hash}`;
}

function historyStateWithNav(nextNav: NavState): Record<string, unknown> {
  const current = window.history.state;
  const base = current && typeof current === "object" ? (current as Record<string, unknown>) : {};
  return { ...base, minglebotNav: nextNav };
}

function readNavFromHistoryState(state: unknown): NavState | null {
  if (!state || typeof state !== "object") return null;
  const raw = (state as { minglebotNav?: unknown }).minglebotNav;
  return isNavState(raw) ? raw : null;
}

function formatDateTime(iso?: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function roleLabel(role: string): string {
  const lower = role.toLowerCase();
  if (lower === "human" || lower === "user") return "You";
  if (lower === "assistant") return "Claude";
  return role;
}

function assistantProviderLabel(provider?: string): string {
  const value = (provider || "").toLowerCase();
  if (value === "chatgpt") return "ChatGPT";
  if (value === "claude") return "Claude";
  if (value === "gemini") return "Gemini";
  if (value === "cursor") return "Cursor";
  return "Assistant";
}

function cleanViewerText(text: string): string {
  return text
    .replace(/```[\s\n]*This block is not supported on your current device yet\.[\s\n]*```/g, "")
    .replace(/This block is not supported on your current device yet\./g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
  const [nav, setNav] = useState<NavState>(DEFAULT_NAV_STATE);
  const step = nav.stack[nav.index] ?? "provider";
  const navRef = useRef<NavState>(DEFAULT_NAV_STATE);
  const messagesViewportRef = useRef<HTMLDivElement | null>(null);

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
  const [claudeConversations, setClaudeConversations] = useState<ClaudeConversationSummary[]>([]);
  const [claudeMessages, setClaudeMessages] = useState<ClaudeMessageItem[]>([]);
  const [selectedClaudeConversationId, setSelectedClaudeConversationId] = useState<string>("");
  const [claudeSearch, setClaudeSearch] = useState("");
  const [isClaudeConversationsLoading, setIsClaudeConversationsLoading] = useState(false);
  const [isClaudeMessagesLoading, setIsClaudeMessagesLoading] = useState(false);

  const setFeedback = useCallback((message: string, tone: Tone = "") => {
    setFeedbackState({ message, tone });
  }, []);

  const goto = useCallback((next: Step, options?: { replace?: boolean }) => {
    const current = navRef.current;
    const nextNav = buildNextNav(current, next, options?.replace === true);
    if (nextNav === current) return;

    navRef.current = nextNav;
    setNav(nextNav);
    const activeStep = nextNav.stack[nextNav.index] ?? "provider";
    const url = urlWithStep(activeStep);

    if (options?.replace) {
      window.history.replaceState(historyStateWithNav(nextNav), "", url);
      return;
    }
    window.history.pushState(historyStateWithNav(nextNav), "", url);
  }, []);

  const goBack = useCallback(() => {
    if (navRef.current.index <= 0) return;
    window.history.back();
  }, []);

  const goForward = useCallback(() => {
    if (navRef.current.index >= navRef.current.stack.length - 1) return;
    window.history.forward();
  }, []);

  useEffect(() => {
    navRef.current = nav;
  }, [nav]);

  useEffect(() => {
    const fromHistory = readNavFromHistoryState(window.history.state);
    if (fromHistory) {
      navRef.current = fromHistory;
      setNav(fromHistory);
      const activeStep = fromHistory.stack[fromHistory.index] ?? "provider";
      window.history.replaceState(historyStateWithNav(fromHistory), "", urlWithStep(activeStep));
    } else {
      const fromLocation = stepFromLocation();
      const initialNav: NavState = fromLocation ? { stack: [fromLocation], index: 0 } : DEFAULT_NAV_STATE;
      navRef.current = initialNav;
      setNav(initialNav);
      const activeStep = initialNav.stack[initialNav.index] ?? "provider";
      window.history.replaceState(historyStateWithNav(initialNav), "", urlWithStep(activeStep));
    }

    const handlePopState = (event: PopStateEvent) => {
      const nextNav = readNavFromHistoryState(event.state);
      const fromLocation = stepFromLocation();
      const safeNav = nextNav ?? (fromLocation ? { stack: [fromLocation], index: 0 } : DEFAULT_NAV_STATE);
      navRef.current = safeNav;
      setNav(safeNav);
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
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

        if (runs.length > 0 && navRef.current.stack[navRef.current.index] === "provider") {
          setSelectedProvider("claude");
          goto("viewer");
        }
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
  }, [goto, setFeedback]);

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

  const loadClaudeConversations = useCallback(async () => {
    setIsClaudeConversationsLoading(true);
    try {
      const rows = await fetchJson<ClaudeConversationSummary[]>("/api/claude/conversations");
      setClaudeConversations(rows);

      if (rows.length === 0) {
        setSelectedClaudeConversationId("");
        setClaudeMessages([]);
        return;
      }

      setSelectedClaudeConversationId((previousId) =>
        rows.some((row) => row.id === previousId) ? previousId : rows[0].id
      );
    } catch (error) {
      setClaudeConversations([]);
      setSelectedClaudeConversationId("");
      setClaudeMessages([]);
      setFeedback(
        `Failed to load conversations: ${error instanceof Error ? error.message : String(error)}`,
        "err"
      );
    } finally {
      setIsClaudeConversationsLoading(false);
    }
  }, [setFeedback]);

  const loadClaudeMessages = useCallback(
    async (conversationId: string) => {
      if (!conversationId) {
        setClaudeMessages([]);
        return;
      }

      setIsClaudeMessagesLoading(true);
      try {
        const rows = await fetchJson<ClaudeMessageItem[]>(
          `/api/claude/conversations/${encodeURIComponent(conversationId)}/messages`
        );
        setClaudeMessages(rows);
      } catch (error) {
        setClaudeMessages([]);
        setFeedback(
          `Failed to load messages: ${error instanceof Error ? error.message : String(error)}`,
          "err"
        );
      } finally {
        setIsClaudeMessagesLoading(false);
      }
    },
    [setFeedback]
  );

  useEffect(() => {
    if (step !== "viewer") return;
    void loadClaudeConversations();
  }, [loadClaudeConversations, step]);

  useEffect(() => {
    if (step !== "viewer") return;
    void loadClaudeMessages(selectedClaudeConversationId);
  }, [loadClaudeMessages, selectedClaudeConversationId, step]);

  useEffect(() => {
    if (step !== "viewer") return;
    const viewport = messagesViewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [claudeMessages, step]);

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
        setFeedback("");
        toast.success(`Import complete: ${result.jobId}`);
        setSelectedProvider("claude");
        goto("viewer", { replace: true });
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

  const filteredClaudeConversations = useMemo(() => {
    const keyword = claudeSearch.trim().toLowerCase();
    if (!keyword) return claudeConversations;
    return claudeConversations.filter((item) => {
      const title = (item.title || "").toLowerCase();
      const preview = (item.last_message_preview || "").toLowerCase();
      return title.includes(keyword) || preview.includes(keyword);
    });
  }, [claudeConversations, claudeSearch]);

  const selectedClaudeConversation = useMemo(
    () => claudeConversations.find((item) => item.id === selectedClaudeConversationId) || null,
    [claudeConversations, selectedClaudeConversationId]
  );

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
    const packageLabel = selectedProvider === "cursor" ? "export package" : "zip package";
    title = `Upload ${selectedProvider || ""} ${packageLabel}`.trim();
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

  if (step === "viewer") {
    return (
      <main className="h-screen overflow-hidden bg-[#1f1d1a] text-[#e9e0d3]">
        <div className="grid h-full min-h-0 grid-cols-[320px_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col border-r border-[#35312a] bg-gradient-to-b from-[#2b2722] via-[#231f1b] to-[#1a1815]">
            <header className="shrink-0 border-b border-[#35312a] px-4 py-4">
              <div className="flex items-center gap-3">
                <div className="grid h-8 w-8 place-content-center rounded-md bg-gradient-to-br from-[#f7ba6d] to-[#e4933c] text-base font-black text-[#24150a]">
                  M
                </div>
                <div className="text-[30px] font-semibold leading-none tracking-[-0.02em] text-[#f2e4cf]">
                  MingleBot
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="inline-flex h-9 min-w-[96px] items-center justify-center rounded-lg border border-[#5f4d35] bg-[#3a2e20] px-3 text-sm font-semibold text-[#f5d6a8] transition hover:bg-[#473827]"
                  onClick={() => {
                    clearSelectedFile();
                    goto("provider");
                  }}
                >
                  Add Data
                </button>
                <button
                  type="button"
                  className="inline-flex h-9 min-w-[126px] items-center justify-center rounded-lg border border-[#4c4338] bg-[#2a251e] px-3 text-sm font-semibold text-[#e7d8c2] transition hover:bg-[#322c24]"
                  onClick={async () => {
                    try {
                      await fetchJson<{ ok: boolean; path: string }>("/api/open-data-root", {
                        method: "POST"
                      });
                      toast.success("Opened data folder.");
                    } catch (error) {
                      toast.error(
                        `Could not open data folder: ${error instanceof Error ? error.message : String(error)}`
                      );
                    }
                  }}
                >
                  Show Data Folder
                </button>
              </div>

              <div className="mt-3">
                <input
                  type="text"
                  value={claudeSearch}
                  onChange={(event) => setClaudeSearch(event.target.value)}
                  placeholder="Search chats"
                  className="w-full rounded-lg border border-[#4f463b] bg-[#1e1b17] px-3 py-2 text-sm text-[#efe4d2] outline-none placeholder:text-[#8f8475] focus:border-[#7f6848]"
                />
                <div className="mt-2 text-xs text-[#a9957d]">
                  Total conversations: {claudeConversations.length}
                </div>
                <div className="mt-1 break-all text-[11px] text-[#8f7b63]">Data root: {dataRoot}</div>
              </div>
            </header>

            <div className="no-scrollbar min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2 py-2">
              {isClaudeConversationsLoading && (
                <p className="rounded-lg border border-[#3b352d] bg-[#26221d] p-3 text-sm text-[#c8baa6]">
                  Loading conversations...
                </p>
              )}

              {!isClaudeConversationsLoading && filteredClaudeConversations.length === 0 && (
                <p className="rounded-lg border border-[#3b352d] bg-[#26221d] p-3 text-sm text-[#c8baa6]">
                  No imported conversations found.
                </p>
              )}

              {!isClaudeConversationsLoading &&
                filteredClaudeConversations.map((item) => {
                  const active = item.id === selectedClaudeConversationId;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedClaudeConversationId(item.id)}
                      className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                        active
                          ? "border-[#7b6240] bg-[#342c22]"
                          : "border-[#373128] bg-[#25211b] hover:border-[#5a4c39] hover:bg-[#2d2720]"
                      }`}
                    >
                      <div className="max-h-10 overflow-hidden text-sm font-semibold text-[#f2e6d2]">
                        {item.title || "Untitled conversation"}
                      </div>
                      <div className="mt-1 text-[11px] text-[#a9957d]">
                        {item.message_count} messages
                        {item.updated_at || item.created_at
                          ? ` • ${formatDateTime(item.updated_at || item.created_at)}`
                          : ""}
                      </div>
                    </button>
                  );
                })}
            </div>
          </aside>

          <section className="flex min-h-0 flex-col overflow-hidden">
            <header className="shrink-0 border-b border-[#35312a] bg-[#22201cd6] px-5 py-4 backdrop-blur">
              <div className="text-[21px] font-semibold text-[#f2e7d6]">
                {selectedClaudeConversation?.title || "Select a conversation"}
              </div>
              <div className="mt-1 text-xs text-[#a79279]">
                {selectedClaudeConversation?.updated_at || selectedClaudeConversation?.created_at
                  ? formatDateTime(selectedClaudeConversation.updated_at || selectedClaudeConversation.created_at)
                  : "No timestamp"}
              </div>
            </header>

            <div
              ref={messagesViewportRef}
              className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6"
            >
              <div className="mx-auto w-full max-w-[940px] space-y-4">
                {isClaudeMessagesLoading && (
                  <p className="rounded-xl border border-[#3b352d] bg-[#26221d] p-4 text-sm text-[#d0c2ad]">
                    Loading messages...
                  </p>
                )}

                {!isClaudeMessagesLoading && !selectedClaudeConversation && (
                  <p className="rounded-xl border border-[#3b352d] bg-[#26221d] p-4 text-sm text-[#d0c2ad]">
                    Pick a conversation from the left to view messages.
                  </p>
                )}

                {!isClaudeMessagesLoading && selectedClaudeConversation && claudeMessages.length === 0 && (
                  <p className="rounded-xl border border-[#3b352d] bg-[#26221d] p-4 text-sm text-[#d0c2ad]">
                    This conversation has no messages in the dataset.
                  </p>
                )}

                {!isClaudeMessagesLoading &&
                  claudeMessages.map((message) => {
                    const isAssistant = message.role.toLowerCase() === "assistant";
                    const cleaned = cleanViewerText(message.text || "");
                    const roleText = isAssistant
                      ? `${assistantProviderLabel(message.provider)}${message.model ? ` • ${message.model}` : ""}`
                      : roleLabel(message.role);
                    return (
                      <article key={message.id} className={`flex ${isAssistant ? "justify-start" : "justify-end"}`}>
                        <div
                          className={`max-w-[90%] rounded-2xl border px-4 py-3 ${
                            isAssistant
                              ? "border-[#3d372f] bg-[#26221d] text-[#efe4d3]"
                              : "border-[#7a5b36] bg-gradient-to-b from-[#6f5232] to-[#5f4529] text-[#f7eee0]"
                          }`}
                        >
                          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#bfaa8a]">
                            {roleText}
                          </div>
                          <div className="whitespace-pre-wrap text-[15px] leading-[1.65]">
                            {cleaned || "(empty message)"}
                          </div>
                          <div className="mt-2 text-[11px] text-[#9d8a73]">
                            {formatDateTime(message.created_at)}
                            {message.attachment_ids && message.attachment_ids.length > 0
                              ? ` • ${message.attachment_ids.length} attachment(s)`
                              : ""}
                          </div>
                        </div>
                      </article>
                    );
                  })}
              </div>
            </div>

            {feedback.message && (
              <p className={`border-t border-[#35312a] px-5 py-2 text-sm ${feedback.tone === "ok" ? "text-[#4fd1c5]" : "text-[#fca5a5]"}`}>
                {feedback.message}
              </p>
            )}
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[760px] px-4 pb-12 pt-8">
      <header className="mb-4 text-center">
        <div className="text-[40px] font-semibold tracking-[0.2px]">MingleBot</div>
      </header>

      <section className="rounded-[20px] border border-[#f1d9aa] bg-gradient-to-b from-[#fffef9] to-[#fff6df] px-5 py-6 shadow-[0_18px_34px_rgba(170,98,9,0.12),0_4px_10px_rgba(170,98,9,0.08)]">
        <div className="inline-block rounded-full border border-[#f7c977] bg-[#ffe3ad] px-2.5 py-1 text-xs font-bold text-[#7c4a10]">
          {chip}
        </div>
        <h1 className="mb-2 mt-3 text-[28px] leading-tight">{title}</h1>
        <p className="min-h-[22px] text-[15px] text-[#6b5a43]">{description}</p>

        <div className="mt-6 grid gap-4">
          {step === "provider" && (
            <div className="grid gap-2.5">
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
              <button
                type="button"
                className={`${ghostButtonClass} justify-center`}
                onClick={() => {
                  setSelectedProvider("claude");
                  goto("viewer");
                }}
              >
                Open Conversation Viewer
              </button>
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
              <button
                type="button"
                className={ghostButtonClass}
                onClick={() => {
                  goto("upload");
                }}
              >
                Import ZIP File
              </button>
            </div>
          )}

          {step === "upload" && (
            <form className="grid justify-items-center gap-4" onSubmit={handleImportSubmit}>
              <input
                ref={fileInputRef}
                name="package"
                type="file"
                accept=".zip,.json,.ndjson,.txt,.md,.markdown"
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
                  Run Import
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
                <button
                  type="button"
                  className={ghostButtonClass}
                  onClick={() => {
                    setSelectedProvider("claude");
                    goto("viewer");
                  }}
                >
                  Open Conversation Viewer
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
