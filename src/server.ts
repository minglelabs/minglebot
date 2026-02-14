import express from "express";
import multer from "multer";
import path from "node:path";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveLayout, ensureLayout } from "./core/layout";
import { readJsonFile, readNdjson } from "./lib/fsx";
import { runImport } from "./core/import-run";
import { CanonicalConversation, CanonicalMessage, Provider, RunRecord } from "./types/schema";
import {
  getClaudeAutomationStatus,
  startClaudeAutomation,
  stopClaudeAutomation
} from "./automation/claude-browser";

const app = express();
const port = Number(process.env.PORT || 4242);
const layout = resolveLayout(process.env.MINGLE_DATA_ROOT);
const execFileAsync = promisify(execFile);

const uploadRoot = path.join(layout.root, ".uploads");
const upload = multer({ dest: uploadRoot });

const providerGuides: Record<Exclude<Provider, "gemini">, { exportUrl: string; label: string }> = {
  chatgpt: {
    label: "ChatGPT",
    exportUrl: "https://chatgpt.com/#settings/DataControls"
  },
  claude: {
    label: "Claude",
    exportUrl: "https://claude.ai/settings/privacy"
  }
};

interface ClaudeConversationSummary {
  id: string;
  title?: string;
  created_at?: string;
  updated_at?: string;
  message_count: number;
  last_message_preview?: string;
}

function rawConversationId(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const row = value as Record<string, unknown>;
  return String(row.id || row.uuid || row.conversation_id || row.thread_id || "").trim();
}

function rawConversationTitle(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  if (typeof row.title === "string" && row.title.trim()) return row.title.trim();
  if (typeof row.name === "string" && row.name.trim()) return row.name.trim();
  return undefined;
}

async function recoverClaudeConversationTitles(
  conversations: CanonicalConversation[]
): Promise<Map<string, string>> {
  const missing = conversations.filter((row) => !row.title || !row.title.trim());
  if (missing.length === 0) return new Map();

  const sourceMap = new Map<string, Set<string>>();
  for (const row of missing) {
    if (!row.source_path) continue;
    const sourcePath = row.source_path.replace(/\\/g, "/");
    const set = sourceMap.get(sourcePath) || new Set<string>();
    set.add(row.provider_conversation_id);
    sourceMap.set(sourcePath, set);
  }

  if (sourceMap.size === 0) return new Map();

  const absRoot = path.resolve(layout.root);
  const titleMap = new Map<string, string>();

  await Promise.all(
    [...sourceMap.entries()].map(async ([sourceRelPath, conversationIds]) => {
      const absPath = path.resolve(layout.root, sourceRelPath);
      if (!isPathInsideRoot(absRoot, absPath)) return;

      const rows = await readJsonFile<unknown>(absPath, null);
      if (!Array.isArray(rows)) return;

      for (const item of rows) {
        const providerConversationId = rawConversationId(item);
        if (!providerConversationId) continue;
        if (!conversationIds.has(providerConversationId)) continue;

        const title = rawConversationTitle(item);
        if (title) {
          titleMap.set(providerConversationId, title);
        }
      }
    })
  );

  return titleMap;
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(process.cwd(), "public")));

function parseProvider(value: unknown): Provider {
  if (value === "chatgpt" || value === "claude") return value;
  throw new Error("Invalid provider. Use chatgpt|claude.");
}

function parseBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return ["1", "true", "yes", "on"].includes(value.toLowerCase());
  return false;
}

function isPathInsideRoot(absRoot: string, absTarget: string): boolean {
  return absTarget === absRoot || absTarget.startsWith(`${absRoot}${path.sep}`);
}

async function openInFileManager(targetPath: string): Promise<void> {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  await execFileAsync(command, [targetPath]);
}

async function readRuns(): Promise<RunRecord[]> {
  try {
    const files = await fs.readdir(layout.jobsRoot);
    const jsonFiles = files.filter((name) => name.endsWith(".json"));
    const rows: RunRecord[] = [];

    for (const name of jsonFiles) {
      const run = await readJsonFile<RunRecord | null>(path.join(layout.jobsRoot, name), null);
      if (run) rows.push(run);
    }

    rows.sort((a, b) => {
      const at = a.started_at || "";
      const bt = b.started_at || "";
      return bt.localeCompare(at);
    });

    return rows;
  } catch {
    return [];
  }
}

app.get("/api/providers", (_req, res) => {
  res.json(providerGuides);
});

app.get("/api/status", async (_req, res) => {
  const runs = await readRuns();
  res.json({
    dataRoot: layout.root,
    lastRun: runs[0] || null
  });
});

app.get("/api/runs", async (_req, res) => {
  const runs = await readRuns();
  res.json(runs);
});

app.get("/api/runs/:jobId", async (req, res) => {
  const filePath = path.join(layout.jobsRoot, `${req.params.jobId}.json`);
  const run = await readJsonFile<RunRecord | null>(filePath, null);
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  res.json(run);
});

app.get("/api/claude/conversations", async (_req, res) => {
  try {
    const conversationsPath = path.join(layout.providerRoot, "claude", "conversations.ndjson");
    const messagesPath = path.join(layout.providerRoot, "claude", "messages.ndjson");
    const [conversations, messages] = await Promise.all([
      readNdjson<CanonicalConversation>(conversationsPath),
      readNdjson<CanonicalMessage>(messagesPath)
    ]);
    const recoveredTitleByConversationId = await recoverClaudeConversationTitles(conversations);

    const messageCountByConversation = new Map<string, number>();
    const lastMessageByConversation = new Map<string, CanonicalMessage>();

    for (const message of messages) {
      const key = message.conversation_id;
      messageCountByConversation.set(key, (messageCountByConversation.get(key) || 0) + 1);

      const previous = lastMessageByConversation.get(key);
      const prevAt = previous?.created_at || "";
      const nextAt = message.created_at || "";
      if (!previous || nextAt >= prevAt) {
        lastMessageByConversation.set(key, message);
      }
    }

    const rows: ClaudeConversationSummary[] = conversations
      .map((conversation) => {
        const latest = lastMessageByConversation.get(conversation.id);
        const preview = latest?.text?.trim()?.slice(0, 140);
        const recoveredTitle = recoveredTitleByConversationId.get(conversation.provider_conversation_id);
        return {
          id: conversation.id,
          title: conversation.title || recoveredTitle || undefined,
          created_at: conversation.created_at,
          updated_at: conversation.updated_at,
          message_count: messageCountByConversation.get(conversation.id) || 0,
          last_message_preview: preview || undefined
        };
      })
      .sort((a, b) => {
        const at = a.updated_at || a.created_at || "";
        const bt = b.updated_at || b.created_at || "";
        return bt.localeCompare(at);
      });

    res.json(rows);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

app.get("/api/claude/conversations/:conversationId/messages", async (req, res) => {
  try {
    const conversationId = String(req.params.conversationId || "").trim();
    if (!conversationId) {
      res.status(400).json({ error: "Missing conversationId" });
      return;
    }

    const messagesPath = path.join(layout.providerRoot, "claude", "messages.ndjson");
    const messages = await readNdjson<CanonicalMessage>(messagesPath);
    const rows = messages
      .filter((message) => message.conversation_id === conversationId)
      .sort((a, b) => {
        const at = a.created_at || "";
        const bt = b.created_at || "";
        return at.localeCompare(bt);
      });

    res.json(rows);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post("/api/open-import-folder", async (req, res) => {
  try {
    const jobId = String(req.body?.jobId || "").trim();
    if (!jobId) {
      res.status(400).json({ error: "Missing jobId" });
      return;
    }

    const run = await readJsonFile<RunRecord | null>(path.join(layout.jobsRoot, `${jobId}.json`), null);
    if (!run || !run.raw_root_path) {
      res.status(404).json({ error: "Run path not found for this job." });
      return;
    }

    const absRoot = path.resolve(layout.root);
    const absTarget = path.resolve(layout.root, run.raw_root_path);
    if (!isPathInsideRoot(absRoot, absTarget)) {
      res.status(400).json({ error: "Resolved path is outside data root." });
      return;
    }

    const stat = await fs.stat(absTarget).catch(() => null);
    if (!stat || !stat.isDirectory()) {
      res.status(404).json({ error: "Import folder does not exist." });
      return;
    }

    await openInFileManager(absTarget);
    res.json({ ok: true, path: absTarget });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post("/api/open-data-root", async (_req, res) => {
  try {
    const absTarget = path.resolve(layout.root);
    const stat = await fs.stat(absTarget).catch(() => null);
    if (!stat || !stat.isDirectory()) {
      res.status(404).json({ error: "Data root does not exist." });
      return;
    }

    await openInFileManager(absTarget);
    res.json({ ok: true, path: absTarget });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

app.get("/api/automation/claude/status", (_req, res) => {
  res.json(getClaudeAutomationStatus());
});

app.post("/api/automation/claude/start", async (_req, res) => {
  try {
    const status = await startClaudeAutomation(layout.root);
    res.json(status);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post("/api/automation/claude/stop", async (_req, res) => {
  try {
    const status = await stopClaudeAutomation();
    res.json(status);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post("/api/import", upload.single("package"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "Missing package upload field: package" });
    return;
  }

  try {
    const provider = parseProvider(req.body.provider);
    const retainPackage = parseBoolean(req.body.retainPackage);

    const result = await runImport({
      provider,
      packagePath: req.file.path,
      originalFileName: req.file.originalname,
      retainPackage
    });

    if (result.status === "FAILED") {
      res.status(422).json(result);
      return;
    }

    res.json(result);
  } catch (error) {
    try {
      await fs.unlink(req.file.path);
    } catch {
      // ignore cleanup errors
    }

    res.status(400).json({
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "index.html"));
});

async function main(): Promise<void> {
  await ensureLayout(layout);
  await fs.mkdir(uploadRoot, { recursive: true });

  app.listen(port, () => {
    // Keep startup log concise for local operation.
    // eslint-disable-next-line no-console
    console.log(`MingleBot running on http://localhost:${port}`);
  });
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
