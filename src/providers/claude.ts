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

function conversationIdFromUnknown(conv: Record<string, unknown>): string {
  return String(conv.id || conv.uuid || conv.conversation_id || conv.thread_id || "").trim();
}

function messageConversationId(msg: Record<string, unknown>): string {
  return String(
    msg.conversation_id ||
      msg.conversationId ||
      msg.thread_id ||
      msg.threadId ||
      msg.chat_id ||
      ""
  ).trim();
}

function messageRole(msg: Record<string, unknown>): string {
  const author = getObject(msg.author);
  const role = msg.role || msg.sender || author?.role || author?.type || msg.from;
  return String(role || "unknown");
}

function messageModel(msg: Record<string, unknown>): string | undefined {
  const direct =
    msg.model ||
    msg.model_name ||
    msg.modelName ||
    getObject(msg.metadata)?.model ||
    getObject(msg.meta)?.model ||
    getObject(msg.author)?.model;

  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }

  return undefined;
}

function messageText(msg: Record<string, unknown>): string {
  const content = msg.content;
  if (Array.isArray(content)) {
    const lines = content
      .map((block) => {
        const obj = getObject(block);
        if (!obj) return "";
        if (typeof obj.text === "string") return obj.text;
        if (typeof obj.content === "string") return obj.content;
        if (obj.type === "text" && typeof obj.value === "string") return obj.value;
        return textFromUnknown(obj);
      })
      .filter(Boolean);
    if (lines.length) return lines.join("\n");
  }
  return textFromUnknown(msg.text || msg.content || msg.body || msg.message);
}

function looksLikeMessageRecord(row: Record<string, unknown>): boolean {
  return Boolean(
    messageConversationId(row) ||
      row.role ||
      row.sender ||
      row.from ||
      getObject(row.author)?.role ||
      row.message_id
  );
}

function looksLikeConversationRecord(row: Record<string, unknown>): boolean {
  if (!conversationIdFromUnknown(row)) return false;

  if (looksLikeMessageRecord(row)) return false;

  if (candidateMessagesFromConversation(row).length) return true;

  if (
    typeof row.title === "string" ||
    row.created_at !== undefined ||
    row.createdAt !== undefined ||
    row.created_time !== undefined ||
    row.updated_at !== undefined ||
    row.updatedAt !== undefined ||
    row.updated_time !== undefined
  ) {
    return true;
  }

  return false;
}

function isRecord(value: Record<string, unknown> | undefined): value is Record<string, unknown> {
  return value !== undefined;
}

function candidateConversationsFromDoc(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => getObject(item))
      .filter(isRecord)
      .filter((item) => looksLikeConversationRecord(item));
  }

  const obj = getObject(value);
  if (!obj) return [];

  for (const key of ["conversations", "threads", "chats", "items", "data"]) {
    const arr = getArray(obj[key]);
    if (!arr.length) continue;

    const candidates = arr
      .map((item) => getObject(item))
      .filter(isRecord)
      .filter((item) => looksLikeConversationRecord(item));

    if (candidates.length) return candidates;
  }

  return [];
}

function candidateMessagesFromConversation(conv: Record<string, unknown>): Record<string, unknown>[] {
  for (const key of ["messages", "chat_messages", "entries", "turns", "items"]) {
    const arr = getArray(conv[key]);
    if (arr.length) {
      return arr.map((item) => getObject(item)).filter(isRecord);
    }
  }
  return [];
}

function candidateFlatMessagesFromDoc(value: unknown): Record<string, unknown>[] {
  const fromArray = (rows: unknown[]): Record<string, unknown>[] =>
    rows
      .map((item) => getObject(item))
      .filter(isRecord)
      .filter((msg) => messageConversationId(msg).length > 0);

  if (Array.isArray(value)) {
    return fromArray(value);
  }

  const obj = getObject(value);
  if (!obj) return [];

  for (const key of ["messages", "items", "data", "entries"]) {
    const arr = getArray(obj[key]);
    if (!arr.length) continue;
    const parsed = fromArray(arr);
    if (parsed.length) return parsed;
  }

  return [];
}

function attachmentFromObject(
  provider: "claude",
  messageId: string,
  sourcePath: string,
  jobId: string,
  rawAttachment: Record<string, unknown>
): CanonicalAttachment {
  const providerAttachmentId = String(
    rawAttachment.id || rawAttachment.uuid || rawAttachment.asset_id || rawAttachment.pointer || ""
  ).trim();

  const attachmentId = canonicalId(
    "att",
    provider,
    providerAttachmentId || undefined,
    `${messageId}:${JSON.stringify(rawAttachment)}`
  );

  const url = typeof rawAttachment.url === "string" ? rawAttachment.url : null;
  const localRel =
    (typeof rawAttachment.path === "string" && rawAttachment.path) ||
    (typeof rawAttachment.local_path === "string" && rawAttachment.local_path) ||
    (typeof rawAttachment.filepath === "string" && rawAttachment.filepath) ||
    undefined;

  return {
    id: attachmentId,
    provider,
    provider_attachment_id: providerAttachmentId || undefined,
    message_id: messageId,
    kind: typeof rawAttachment.kind === "string" ? rawAttachment.kind : "attachment",
    mime_type: typeof rawAttachment.mime_type === "string" ? rawAttachment.mime_type : undefined,
    size_bytes: typeof rawAttachment.size_bytes === "number" ? rawAttachment.size_bytes : undefined,
    storage: localRel ? "blob" : url ? "url" : "missing",
    local_relpath: localRel,
    url,
    status: localRel ? "embedded" : url ? "linked" : "missing",
    source_job_id: jobId,
    source_path: sourcePath
  };
}

function attachmentsFromMessage(
  message: Record<string, unknown>,
  messageId: string,
  sourcePath: string,
  jobId: string
): CanonicalAttachment[] {
  const out: CanonicalAttachment[] = [];

  for (const rawAttachment of getArray(message.attachments)) {
    const attachment = getObject(rawAttachment);
    if (!attachment) continue;
    out.push(attachmentFromObject("claude", messageId, sourcePath, jobId, attachment));
  }

  if (Array.isArray(message.content)) {
    for (const rawBlock of message.content) {
      const block = getObject(rawBlock);
      if (!block) continue;

      const hasAttachmentShape =
        typeof block.url === "string" ||
        typeof block.path === "string" ||
        typeof block.local_path === "string" ||
        typeof block.filepath === "string";

      const type = String(block.type || "").toLowerCase();
      const isAttachmentType = ["image", "file", "attachment", "document"].includes(type);

      if (hasAttachmentShape || isAttachmentType) {
        out.push(attachmentFromObject("claude", messageId, sourcePath, jobId, block));
      }
    }
  }

  return out;
}

function upsertMessageAndAttachments(
  providerConversationId: string,
  conversationId: string,
  msg: Record<string, unknown>,
  msgSourcePath: string,
  jobId: string,
  messages: Map<string, CanonicalMessage>,
  attachments: Map<string, CanonicalAttachment>
): void {
  const providerMessageId = String(msg.id || msg.uuid || msg.message_id || "").trim();
  const role = messageRole(msg);
  const model = messageModel(msg);
  const text = messageText(msg);
  const createdAt = toIsoOrUndefined(msg.created_at || msg.createdAt || msg.timestamp);

  if (!providerMessageId && !text) return;

  const messageId = canonicalId(
    "msg",
    "claude",
    providerMessageId || undefined,
    `${providerConversationId}:${role}:${text}:${createdAt || ""}`
  );

  const attachmentsFromCurrent = attachmentsFromMessage(msg, messageId, msgSourcePath, jobId);
  const attachmentIds = attachmentsFromCurrent.map((att) => att.id);

  const nextMessage: CanonicalMessage = {
    id: messageId,
    conversation_id: conversationId,
    provider: "claude",
    provider_message_id: providerMessageId || undefined,
    model,
    role,
    text,
    created_at: createdAt,
    attachment_ids: attachmentIds,
    source_job_id: jobId,
    source_path: msgSourcePath
  };

  const existingMessage = messages.get(messageId);
  if (!existingMessage) {
    messages.set(messageId, nextMessage);
  } else {
    messages.set(messageId, {
      ...existingMessage,
      text: nextMessage.text.length >= existingMessage.text.length ? nextMessage.text : existingMessage.text,
      model: nextMessage.model || existingMessage.model,
      role: nextMessage.role || existingMessage.role,
      created_at: nextMessage.created_at || existingMessage.created_at,
      source_path: existingMessage.source_path || nextMessage.source_path,
      attachment_ids: [...new Set([...(existingMessage.attachment_ids || []), ...attachmentIds])]
    });
  }

  for (const attachment of attachmentsFromCurrent) {
    if (!attachments.has(attachment.id)) {
      attachments.set(attachment.id, attachment);
    }
  }
}

export async function parseClaude(
  extractedRoot: string,
  sourceRelRoot: string,
  jobId: string
): Promise<ProviderParseResult> {
  const docs = await loadJsonDocuments(extractedRoot);
  const warnings: string[] = [];

  const conversations = new Map<string, CanonicalConversation>();
  const messages = new Map<string, CanonicalMessage>();
  const attachments = new Map<string, CanonicalAttachment>();

  const flatMessagesByConversation = new Map<string, Array<{ message: Record<string, unknown>; sourcePath: string }>>();

  for (const doc of docs) {
    const sourcePath = claudeSourcePath(sourceRelRoot, doc.relPath);
    for (const msg of candidateFlatMessagesFromDoc(doc.value)) {
      const convId = messageConversationId(msg);
      if (!convId) continue;
      const bucket = flatMessagesByConversation.get(convId) || [];
      bucket.push({ message: msg, sourcePath });
      flatMessagesByConversation.set(convId, bucket);
    }
  }

  for (const doc of docs) {
    const sourcePath = claudeSourcePath(sourceRelRoot, doc.relPath);
    const candidates = candidateConversationsFromDoc(doc.value);

    for (const conv of candidates) {
      const providerConversationId = conversationIdFromUnknown(conv);
      if (!providerConversationId) continue;

      const conversationId = canonicalId("cnv", "claude", providerConversationId, providerConversationId);
      const title =
        (typeof conv.title === "string" && conv.title.trim()) ||
        (typeof conv.name === "string" && conv.name.trim()) ||
        undefined;
      const conversation: CanonicalConversation = {
        id: conversationId,
        provider: "claude",
        provider_conversation_id: providerConversationId,
        title,
        created_at: toIsoOrUndefined(conv.created_at || conv.createdAt || conv.created_time),
        updated_at: toIsoOrUndefined(conv.updated_at || conv.updatedAt || conv.updated_time),
        source_job_id: jobId,
        source_path: sourcePath
      };

      if (!conversations.has(conversation.id)) {
        conversations.set(conversation.id, conversation);
      }

      const nestedMessages = candidateMessagesFromConversation(conv).map((message) => ({
        message,
        sourcePath
      }));

      const flatMessages = flatMessagesByConversation.get(providerConversationId) || [];
      const allMessages = [...nestedMessages, ...flatMessages];

      for (const item of allMessages) {
        upsertMessageAndAttachments(
          providerConversationId,
          conversationId,
          item.message,
          item.sourcePath,
          jobId,
          messages,
          attachments
        );
      }
    }
  }

  for (const [providerConversationId, groupedMessages] of flatMessagesByConversation.entries()) {
    const conversationId = canonicalId("cnv", "claude", providerConversationId, providerConversationId);
    if (!conversations.has(conversationId)) {
      conversations.set(conversationId, {
        id: conversationId,
        provider: "claude",
        provider_conversation_id: providerConversationId,
        title: undefined,
        source_job_id: jobId,
        source_path: groupedMessages[0]?.sourcePath
      });
    }

    for (const item of groupedMessages) {
      upsertMessageAndAttachments(
        providerConversationId,
        conversationId,
        item.message,
        item.sourcePath,
        jobId,
        messages,
        attachments
      );
    }
  }

  if (!conversations.size) {
    warnings.push("No conversations parsed from Claude export payload.");
  }
  if (!messages.size) {
    warnings.push("No messages parsed from Claude export payload.");
  }

  return {
    provider: "claude",
    conversations: [...conversations.values()],
    messages: [...messages.values()],
    attachments: [...attachments.values()],
    warnings
  };
}
