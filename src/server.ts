import express from "express";
import multer from "multer";
import path from "node:path";
import { promises as fs } from "node:fs";
import { resolveLayout, ensureLayout } from "./core/layout";
import { readJsonFile } from "./lib/fsx";
import { runImport } from "./core/import-run";
import { Provider, RunRecord } from "./types/schema";

const app = express();
const port = Number(process.env.PORT || 4242);
const layout = resolveLayout(process.env.MINGLE_DATA_ROOT);

const uploadRoot = path.join(layout.root, ".uploads");
const upload = multer({ dest: uploadRoot });

const providerGuides: Record<Provider, { exportUrl: string; label: string; status: "ready" | "partial" }> = {
  chatgpt: {
    label: "ChatGPT",
    exportUrl: "https://chatgpt.com/#settings/DataControls",
    status: "ready"
  },
  claude: {
    label: "Claude",
    exportUrl: "https://claude.ai/settings/privacy",
    status: "ready"
  },
  gemini: {
    label: "Gemini",
    exportUrl: "https://gemini.google.com/app",
    status: "partial"
  }
};

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(process.cwd(), "public")));

function parseProvider(value: unknown): Provider {
  if (value === "chatgpt" || value === "claude" || value === "gemini") return value;
  throw new Error("Invalid provider. Use chatgpt|claude|gemini.");
}

function parseBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return ["1", "true", "yes", "on"].includes(value.toLowerCase());
  return false;
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
    console.log(`Minglebot running on http://localhost:${port}`);
  });
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
