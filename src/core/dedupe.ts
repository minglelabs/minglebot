import {
  CanonicalAttachment,
  CanonicalConversation,
  CanonicalMessage,
  ProvenanceFields
} from "../types/schema";
import { isIsoDateNewer } from "../lib/time";

export interface UpsertStats {
  new: number;
  updated: number;
  unchanged: number;
  failed: number;
}

function withProvenance<T extends ProvenanceFields>(item: T, jobId: string): T {
  const seen = new Set([...(item.seen_in_jobs || []), jobId]);
  return {
    ...item,
    first_seen_job_id: item.first_seen_job_id || jobId,
    last_seen_job_id: jobId,
    seen_in_jobs: [...seen]
  };
}

function stableSignature(item: unknown): string {
  const clone: Record<string, unknown> =
    item && typeof item === "object" ? { ...(item as Record<string, unknown>) } : {};
  delete clone.source_job_id;
  delete clone.source_path;
  delete clone.first_seen_job_id;
  delete clone.last_seen_job_id;
  delete clone.seen_in_jobs;
  return JSON.stringify(clone);
}

function mergeText(prev: string | undefined, next: string | undefined): string | undefined {
  if (!next) return prev;
  if (!prev) return next;
  return next.length >= prev.length ? next : prev;
}

function mergeOptional(prev?: string, next?: string): string | undefined {
  return next && next.trim() ? next : prev;
}

function mergeArray(prev?: string[], next?: string[]): string[] | undefined {
  const combined = new Set([...(prev || []), ...(next || [])]);
  return combined.size ? [...combined] : undefined;
}

function mergeConversation(prev: CanonicalConversation, next: CanonicalConversation): CanonicalConversation {
  return {
    ...prev,
    source_job_id: next.source_job_id,
    source_path: next.source_path || prev.source_path,
    title: mergeText(prev.title, next.title),
    created_at: isIsoDateNewer(prev.created_at, next.created_at) ? prev.created_at : next.created_at || prev.created_at,
    updated_at: isIsoDateNewer(next.updated_at, prev.updated_at) ? next.updated_at : prev.updated_at
  };
}

function mergeMessage(prev: CanonicalMessage, next: CanonicalMessage): CanonicalMessage {
  return {
    ...prev,
    source_job_id: next.source_job_id,
    source_path: next.source_path || prev.source_path,
    provider_message_id: mergeOptional(prev.provider_message_id, next.provider_message_id),
    model: mergeOptional(prev.model, next.model),
    role: next.role || prev.role,
    text: mergeText(prev.text, next.text) || "",
    created_at: isIsoDateNewer(prev.created_at, next.created_at) ? prev.created_at : next.created_at || prev.created_at,
    attachment_ids: mergeArray(prev.attachment_ids, next.attachment_ids)
  };
}

function mergeAttachment(prev: CanonicalAttachment, next: CanonicalAttachment): CanonicalAttachment {
  return {
    ...prev,
    source_job_id: next.source_job_id,
    source_path: next.source_path || prev.source_path,
    provider_attachment_id: mergeOptional(prev.provider_attachment_id, next.provider_attachment_id),
    kind: mergeOptional(prev.kind, next.kind),
    mime_type: mergeOptional(prev.mime_type, next.mime_type),
    size_bytes: next.size_bytes ?? prev.size_bytes,
    storage: next.storage || prev.storage,
    blob_sha256: mergeOptional(prev.blob_sha256, next.blob_sha256),
    url: next.url ?? prev.url,
    status: next.status || prev.status,
    local_relpath: mergeOptional(prev.local_relpath, next.local_relpath)
  };
}

export function upsertConversations(
  existing: CanonicalConversation[],
  incoming: CanonicalConversation[],
  jobId: string
): { rows: CanonicalConversation[]; stats: UpsertStats } {
  const stats: UpsertStats = { new: 0, updated: 0, unchanged: 0, failed: 0 };
  const index = new Map(existing.map((row) => [row.id, row]));

  for (const raw of incoming) {
    if (!raw.id) {
      stats.failed += 1;
      continue;
    }
    const next = withProvenance(raw, jobId);
    const prev = index.get(next.id);
    if (!prev) {
      index.set(next.id, next);
      stats.new += 1;
      continue;
    }

    const merged = withProvenance(mergeConversation(prev, next), jobId);
    if (stableSignature(prev) === stableSignature(merged)) {
      stats.unchanged += 1;
    } else {
      stats.updated += 1;
    }
    index.set(next.id, merged);
  }

  return { rows: [...index.values()], stats };
}

export function upsertMessages(
  existing: CanonicalMessage[],
  incoming: CanonicalMessage[],
  jobId: string
): { rows: CanonicalMessage[]; stats: UpsertStats } {
  const stats: UpsertStats = { new: 0, updated: 0, unchanged: 0, failed: 0 };
  const index = new Map(existing.map((row) => [row.id, row]));

  for (const raw of incoming) {
    if (!raw.id || !raw.conversation_id) {
      stats.failed += 1;
      continue;
    }
    const next = withProvenance(raw, jobId);
    const prev = index.get(next.id);
    if (!prev) {
      index.set(next.id, next);
      stats.new += 1;
      continue;
    }

    const merged = withProvenance(mergeMessage(prev, next), jobId);
    if (stableSignature(prev) === stableSignature(merged)) {
      stats.unchanged += 1;
    } else {
      stats.updated += 1;
    }
    index.set(next.id, merged);
  }

  return { rows: [...index.values()], stats };
}

export function upsertAttachments(
  existing: CanonicalAttachment[],
  incoming: CanonicalAttachment[],
  jobId: string
): { rows: CanonicalAttachment[]; stats: UpsertStats } {
  const stats: UpsertStats = { new: 0, updated: 0, unchanged: 0, failed: 0 };
  const index = new Map(existing.map((row) => [row.id, row]));

  for (const raw of incoming) {
    if (!raw.id || !raw.message_id) {
      stats.failed += 1;
      continue;
    }
    const next = withProvenance(raw, jobId);
    const prev = index.get(next.id);
    if (!prev) {
      index.set(next.id, next);
      stats.new += 1;
      continue;
    }

    const merged = withProvenance(mergeAttachment(prev, next), jobId);
    if (stableSignature(prev) === stableSignature(merged)) {
      stats.unchanged += 1;
    } else {
      stats.updated += 1;
    }
    index.set(next.id, merged);
  }

  return { rows: [...index.values()], stats };
}
