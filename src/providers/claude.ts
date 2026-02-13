import { canonicalId } from "../lib/id";
import {
  CanonicalAttachment,
  CanonicalConversation,
  CanonicalMessage,
  ProviderParseResult
} from "../types/schema";
import {
  getArray,
  getObject,
  loadJsonDocuments,
  textFromUnknown,
  toIsoOrUndefined
} from "./common";

function claudeSourcePath(sourceRelRoot: string, rel: string): string {
  return `${sourceRelRoot}/${rel}`.replace(/\\/g, "/");
}

function candidateConversationsFromDoc(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.map((item) => getObject(item)).filter(Boolean) as Record<string, unknown>[];
  }
  const obj = getObject(value);
  if (!obj) return [];

  for (const key of ["conversations", "threads", "chats", "items", "data"]) {
    const arr = getArray(obj[key]);
    if (arr.length) {
      return arr.map((item) => getObject(item)).filter(Boolean) as Record<string, unknown>[];
    }
  }

  return [];
}

function candidateMessagesFromConversation(conv: Record<string, unknown>): Record<string, unknown>[] {
  for (const key of ["messages", "chat_messages", "entries", "turns", "items"]) {
    const arr = getArray(conv[key]);
    if (arr.length) {
      return arr.map((item) => getObject(item)).filter(Boolean) as Record<string, unknown>[];
    }
  }
  return [];
}

export async function parseClaude(
  extractedRoot: string,
  sourceRelRoot: string,
  jobId: string
): Promise<ProviderParseResult> {
  const docs = await loadJsonDocuments(extractedRoot);
  const warnings: string[] = [];

  const conversations: CanonicalConversation[] = [];
  const messages: CanonicalMessage[] = [];
  const attachments: CanonicalAttachment[] = [];

  for (const doc of docs) {
    const sourcePath = claudeSourcePath(sourceRelRoot, doc.relPath);
    const candidates = candidateConversationsFromDoc(doc.value);

    for (const conv of candidates) {
      const providerConversationId = String(
        conv.id || conv.uuid || conv.conversation_id || conv.thread_id || ""
      ).trim();
      if (!providerConversationId) continue;

      const conversationId = canonicalId("cnv", "claude", providerConversationId, providerConversationId);

      conversations.push({
        id: conversationId,
        provider: "claude",
        provider_conversation_id: providerConversationId,
        title: typeof conv.title === "string" ? conv.title : undefined,
        created_at: toIsoOrUndefined(conv.created_at || conv.createdAt || conv.created_time),
        updated_at: toIsoOrUndefined(conv.updated_at || conv.updatedAt || conv.updated_time),
        source_job_id: jobId,
        source_path: sourcePath
      });

      const msgCandidates = candidateMessagesFromConversation(conv);
      for (const msg of msgCandidates) {
        const providerMessageId = String(msg.id || msg.uuid || msg.message_id || "").trim();
        const role = String(msg.role || msg.sender || msg.author || "unknown");
        const text = textFromUnknown(msg.text || msg.content || msg.body || msg.message);
        const createdAt = toIsoOrUndefined(msg.created_at || msg.createdAt || msg.timestamp);

        if (!providerMessageId && !text) continue;

        const messageId = canonicalId(
          "msg",
          "claude",
          providerMessageId || undefined,
          `${providerConversationId}:${role}:${text}:${createdAt || ""}`
        );

        const attachmentIds: string[] = [];
        const msgAttachments = getArray(msg.attachments);
        for (const rawAttachment of msgAttachments) {
          const attachment = getObject(rawAttachment);
          if (!attachment) continue;
          const providerAttachmentId = String(
            attachment.id || attachment.uuid || attachment.asset_id || ""
          ).trim();

          const attachmentId = canonicalId(
            "att",
            "claude",
            providerAttachmentId || undefined,
            `${messageId}:${JSON.stringify(attachment)}`
          );
          attachmentIds.push(attachmentId);

          const url = typeof attachment.url === "string" ? attachment.url : null;
          const localRel = typeof attachment.path === "string" ? attachment.path : undefined;

          attachments.push({
            id: attachmentId,
            provider: "claude",
            provider_attachment_id: providerAttachmentId || undefined,
            message_id: messageId,
            kind: typeof attachment.kind === "string" ? attachment.kind : "attachment",
            mime_type: typeof attachment.mime_type === "string" ? attachment.mime_type : undefined,
            size_bytes: typeof attachment.size_bytes === "number" ? attachment.size_bytes : undefined,
            storage: localRel ? "blob" : url ? "url" : "missing",
            local_relpath: localRel,
            url,
            status: localRel ? "embedded" : url ? "linked" : "missing",
            source_job_id: jobId,
            source_path: sourcePath
          });
        }

        messages.push({
          id: messageId,
          conversation_id: conversationId,
          provider: "claude",
          provider_message_id: providerMessageId || undefined,
          role,
          text,
          created_at: createdAt,
          attachment_ids: attachmentIds,
          source_job_id: jobId,
          source_path: sourcePath
        });
      }
    }
  }

  if (!conversations.length) {
    warnings.push("No conversations parsed from Claude export payload.");
  }
  if (!messages.length) {
    warnings.push("No messages parsed from Claude export payload.");
  }

  return {
    provider: "claude",
    conversations,
    messages,
    attachments,
    warnings
  };
}
