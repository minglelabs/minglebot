import path from "node:path";
import { promises as fs } from "node:fs";
import AdmZip from "adm-zip";
import { sha256 } from "../lib/hash";
import {
  appendNdjsonLine,
  ensureDir,
  exists,
  readNdjson,
  writeJsonFile,
  writeNdjson
} from "../lib/fsx";
import { nowIso, ymdParts } from "../lib/time";
import {
  CanonicalAttachment,
  CanonicalConversation,
  CanonicalMessage,
  ImportResult,
  Provider,
  RunRecord
} from "../types/schema";
import { parseProviderExport } from "../providers";
import { upsertAttachments, upsertConversations, upsertMessages } from "./dedupe";
import { ensureLayout, resolveLayout } from "./layout";
import { rebuildMessageIndexes, writeCatalog } from "./indexes";

export interface ImportRequest {
  provider: Provider;
  packagePath: string;
  originalFileName?: string;
  retainPackage?: boolean;
  dataRoot?: string;
}

function newJobId(date: Date): string {
  const stamp = date.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const random = Math.random().toString(36).slice(2, 8);
  return `job_${stamp}_${random}`;
}

function sanitizeFileName(name?: string): string {
  if (!name) return "upload.zip";
  return name.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function rel(root: string, abs: string): string {
  return path.relative(root, abs).replace(/\\/g, "/");
}

function extFromMime(mimeType?: string): string {
  if (!mimeType) return "";
  if (mimeType.includes("png")) return ".png";
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return ".jpg";
  if (mimeType.includes("webp")) return ".webp";
  if (mimeType.includes("gif")) return ".gif";
  if (mimeType.includes("pdf")) return ".pdf";
  if (mimeType.includes("json")) return ".json";
  if (mimeType.includes("text")) return ".txt";
  return "";
}

async function updateRun(layoutJobsRoot: string, run: RunRecord): Promise<void> {
  await writeJsonFile(path.join(layoutJobsRoot, `${run.job_id}.json`), run);
}

async function materializeBlobs(
  attachments: CanonicalAttachment[],
  extractedRoot: string,
  blobsRoot: string,
  errorsPath: string
): Promise<void> {
  for (const item of attachments) {
    if (!item.local_relpath) continue;
    const localAbsPath = path.join(extractedRoot, item.local_relpath);
    if (!(await exists(localAbsPath))) {
      item.storage = "missing";
      item.status = "missing";
      await appendNdjsonLine(errorsPath, {
        level: "warn",
        code: "ATTACHMENT_PATH_MISSING",
        attachment_id: item.id,
        local_relpath: item.local_relpath
      });
      continue;
    }

    const buf = await fs.readFile(localAbsPath);
    const hash = sha256(buf);
    const ext = path.extname(localAbsPath) || extFromMime(item.mime_type);
    const blobPath = path.join(blobsRoot, "sha256", hash.slice(0, 2), hash.slice(2, 4), `${hash}${ext}`);
    await ensureDir(path.dirname(blobPath));

    if (!(await exists(blobPath))) {
      await fs.writeFile(blobPath, buf);
    }

    item.blob_sha256 = hash;
    item.storage = "blob";
    item.status = "embedded";
  }
}

export async function runImport(request: ImportRequest): Promise<ImportResult> {
  const startedDate = new Date();
  const startedAt = nowIso();
  const layout = resolveLayout(request.dataRoot);
  await ensureLayout(layout);

  const jobId = newJobId(startedDate);
  const { y, m } = ymdParts(startedDate);

  const jobRawRoot = path.join(layout.rawRoot, request.provider, y, m, jobId);
  const extractedRoot = path.join(jobRawRoot, "extracted");
  const errorsPath = path.join(layout.errorsRoot, `${jobId}.ndjson`);
  const retainPackage = Boolean(request.retainPackage);

  const run: RunRecord = {
    job_id: jobId,
    provider: request.provider,
    status: "PACKAGE_SELECTED",
    started_at: startedAt,
    download_artifact_retained: retainPackage,
    warnings: [],
    errors: []
  };

  await ensureDir(extractedRoot);
  await updateRun(layout.jobsRoot, run);

  try {
    if (!(await exists(request.packagePath))) {
      throw new Error("Import package not found on disk.");
    }

    run.status = "PACKAGE_VALIDATED";
    await updateRun(layout.jobsRoot, run);

    const fileName = sanitizeFileName(request.originalFileName || path.basename(request.packagePath));
    const ext = path.extname(fileName).toLowerCase();

    if (ext === ".zip") {
      const zip = new AdmZip(request.packagePath);
      zip.extractAllTo(extractedRoot, true);
    } else if ([".json", ".txt", ".ndjson"].includes(ext)) {
      await fs.copyFile(request.packagePath, path.join(extractedRoot, fileName));
    } else {
      throw new Error("Unsupported package format. Please upload .zip, .json, .ndjson, or .txt");
    }

    if (retainPackage) {
      await fs.copyFile(request.packagePath, path.join(jobRawRoot, `download-artifact${ext || ".bin"}`));
    }

    run.status = "EXTRACTED_TO_RAW";
    run.raw_root_path = rel(layout.root, extractedRoot);
    await updateRun(layout.jobsRoot, run);

    const parseResult = await parseProviderExport(
      request.provider,
      extractedRoot,
      rel(layout.root, extractedRoot),
      jobId
    );

    run.status = "PARSED_PROVIDER_RECORDS";
    run.warnings = parseResult.warnings;
    await updateRun(layout.jobsRoot, run);

    await materializeBlobs(parseResult.attachments, extractedRoot, layout.blobsRoot, errorsPath);

    run.status = "MAPPED_CANONICAL_RECORDS";
    await updateRun(layout.jobsRoot, run);

    const canonicalConversationsPath = path.join(layout.canonicalRoot, "conversations.ndjson");
    const canonicalMessagesPath = path.join(layout.canonicalRoot, "messages.ndjson");
    const canonicalAttachmentsPath = path.join(layout.canonicalRoot, "attachments.ndjson");

    const providerRoot = path.join(layout.providerRoot, request.provider);
    const providerConversationsPath = path.join(providerRoot, "conversations.ndjson");
    const providerMessagesPath = path.join(providerRoot, "messages.ndjson");
    const providerAttachmentsPath = path.join(providerRoot, "attachments.ndjson");

    const existingCanonicalConversations = await readNdjson<CanonicalConversation>(canonicalConversationsPath);
    const existingCanonicalMessages = await readNdjson<CanonicalMessage>(canonicalMessagesPath);
    const existingCanonicalAttachments = await readNdjson<CanonicalAttachment>(canonicalAttachmentsPath);

    const existingProviderConversations = await readNdjson<CanonicalConversation>(providerConversationsPath);
    const existingProviderMessages = await readNdjson<CanonicalMessage>(providerMessagesPath);
    const existingProviderAttachments = await readNdjson<CanonicalAttachment>(providerAttachmentsPath);

    const canonicalConversationUpsert = upsertConversations(
      existingCanonicalConversations,
      parseResult.conversations,
      jobId
    );
    const canonicalMessageUpsert = upsertMessages(existingCanonicalMessages, parseResult.messages, jobId);
    const canonicalAttachmentUpsert = upsertAttachments(
      existingCanonicalAttachments,
      parseResult.attachments,
      jobId
    );

    const providerConversationUpsert = upsertConversations(
      existingProviderConversations,
      parseResult.conversations,
      jobId
    );
    const providerMessageUpsert = upsertMessages(existingProviderMessages, parseResult.messages, jobId);
    const providerAttachmentUpsert = upsertAttachments(
      existingProviderAttachments,
      parseResult.attachments,
      jobId
    );

    await writeNdjson(canonicalConversationsPath, canonicalConversationUpsert.rows);
    await writeNdjson(canonicalMessagesPath, canonicalMessageUpsert.rows);
    await writeNdjson(canonicalAttachmentsPath, canonicalAttachmentUpsert.rows);

    await writeNdjson(providerConversationsPath, providerConversationUpsert.rows);
    await writeNdjson(providerMessagesPath, providerMessageUpsert.rows);
    await writeNdjson(providerAttachmentsPath, providerAttachmentUpsert.rows);

    run.status = "DEDUPED_UPSERTED";
    run.summary = {
      conversations: canonicalConversationUpsert.stats,
      messages: canonicalMessageUpsert.stats,
      attachments: canonicalAttachmentUpsert.stats
    };
    await updateRun(layout.jobsRoot, run);

    await rebuildMessageIndexes(layout, canonicalMessageUpsert.rows);
    await writeCatalog(layout);

    run.status = "NORMALIZED";
    run.ended_at = nowIso();
    run.canonical_records = {
      conversations: canonicalConversationUpsert.rows.length,
      messages: canonicalMessageUpsert.rows.length,
      attachments: canonicalAttachmentUpsert.rows.length
    };
    await updateRun(layout.jobsRoot, run);

    if (!retainPackage) {
      try {
        await fs.unlink(request.packagePath);
      } catch {
        // ignore temp cleanup failures
      }
    }

    return {
      jobId,
      provider: request.provider,
      status: "NORMALIZED",
      startedAt,
      endedAt: run.ended_at,
      rawRootPath: run.raw_root_path || "",
      downloadArtifactRetained: retainPackage,
      counters: run.summary!,
      warnings: run.warnings || [],
      errors: []
    };
  } catch (error) {
    const endedAt = nowIso();
    const message = error instanceof Error ? error.message : String(error);
    run.status = "FAILED";
    run.ended_at = endedAt;
    run.errors = [...(run.errors || []), message];
    await updateRun(layout.jobsRoot, run);
    await appendNdjsonLine(errorsPath, {
      at: endedAt,
      level: "error",
      message
    });

    return {
      jobId,
      provider: request.provider,
      status: "FAILED",
      startedAt,
      endedAt,
      rawRootPath: run.raw_root_path || "",
      downloadArtifactRetained: retainPackage,
      counters: {
        conversations: { new: 0, updated: 0, unchanged: 0, failed: 0 },
        messages: { new: 0, updated: 0, unchanged: 0, failed: 0 },
        attachments: { new: 0, updated: 0, unchanged: 0, failed: 0 }
      },
      warnings: run.warnings || [],
      errors: [message]
    };
  }
}
