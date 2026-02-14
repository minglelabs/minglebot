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

function geminiSourcePath(sourceRelRoot: string, rel: string): string {
  return `${sourceRelRoot}/${rel}`.replace(/\\/g, "/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function messageLike(value: Record<string, unknown>): boolean {
  return Boolean(
    value.role ||
      value.author ||
      value.sender ||
      value.text ||
      value.content ||
      value.parts ||
      value.message ||
      value.response ||
      value.candidates
  );
}

function normalizeGeminiRole(value: string): string {
  const role = value.trim().toLowerCase();
  if (["model", "assistant", "ai", "bot", "gemini"].includes(role)) return "assistant";
  if (["user", "human", "prompt", "customer", "you"].includes(role)) return "user";
  if (role === "system") return "system";
  return role || "unknown";
}

function geminiRole(msg: Record<string, unknown>): string {
  const author = getObject(msg.author);
  const raw = msg.role || msg.sender || author?.role || author?.type || msg.from;
  return normalizeGeminiRole(String(raw || "unknown"));
}

function geminiModel(msg: Record<string, unknown>): string | undefined {
  const direct =
    msg.model ||
    msg.model_name ||
    msg.modelName ||
    getObject(msg.metadata)?.model ||
    getObject(msg.meta)?.model;

  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }

  return undefined;
}

function geminiMessageText(msg: Record<string, unknown>): string {
  const direct = textFromUnknown(
    msg.text ||
      msg.content ||
      msg.parts ||
      msg.message ||
      msg.response ||
      msg.output ||
      msg.value
  ).trim();
  if (direct) return direct;

  const candidateTexts: string[] = [];
  for (const rawCandidate of getArray(msg.candidates)) {
    const candidate = getObject(rawCandidate);
    if (!candidate) continue;
    const text = textFromUnknown(
      getObject(candidate.content)?.parts ||
        candidate.content ||
        candidate.text ||
        candidate.message
    ).trim();
    if (text) candidateTexts.push(text);
  }

  if (candidateTexts.length) {
    return candidateTexts.join("\n\n");
  }

  return "";
}

function candidateMessagesFromConversation(conv: Record<string, unknown>): Record<string, unknown>[] {
  for (const key of ["messages", "turns", "history", "entries", "items", "events"]) {
    const rows = getArray(conv[key]).filter(isRecord).filter((item) => messageLike(item));
    if (rows.length) return rows;
  }

  const mapping = getObject(conv.mapping);
  if (mapping) {
    const rows = Object.values(mapping)
      .filter(isRecord)
      .map((item) => getObject(item.message) || item)
      .filter((item): item is Record<string, unknown> => Boolean(item))
      .filter((item) => messageLike(item));
    if (rows.length) return rows;
  }

  return [];
}

function conversationId(value: Record<string, unknown>): string {
  return String(
    value.id || value.uuid || value.conversation_id || value.chat_id || value.thread_id || ""
  ).trim();
}

function conversationTitle(value: Record<string, unknown>): string | undefined {
  const title =
    (typeof value.title === "string" && value.title.trim()) ||
    (typeof value.name === "string" && value.name.trim()) ||
    (typeof value.subject === "string" && value.subject.trim()) ||
    undefined;
  return title || undefined;
}

function candidateConversationsFromDoc(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    const records = value.filter(isRecord);
    const withMessageBuckets = records.filter((row) => candidateMessagesFromConversation(row).length > 0);
    if (withMessageBuckets.length) return withMessageBuckets;

    const messageRows = records.filter((row) => messageLike(row));
    if (messageRows.length) {
      return [{ messages: messageRows }];
    }
    return [];
  }

  const obj = getObject(value);
  if (!obj) return [];

  for (const key of ["conversations", "threads", "chats", "items", "data"]) {
    const rows = getArray(obj[key]).filter(isRecord);
    const withMessageBuckets = rows.filter((row) => candidateMessagesFromConversation(row).length > 0);
    if (withMessageBuckets.length) return withMessageBuckets;
  }

  if (candidateMessagesFromConversation(obj).length > 0) return [obj];

  for (const key of ["messages", "turns", "history", "entries", "events"]) {
    const rows = getArray(obj[key]).filter(isRecord).filter((row) => messageLike(row));
    if (rows.length) {
      return [
        {
          id: obj.id,
          title: obj.title || obj.name,
          created_at: obj.created_at || obj.create_time || obj.createdAt,
          updated_at: obj.updated_at || obj.update_time || obj.updatedAt,
          messages: rows
        }
      ];
    }
  }

  if (messageLike(obj)) {
    return [{ messages: [obj] }];
  }

  return [];
}

export async function parseGemini(
  extractedRoot: string,
  sourceRelRoot: string,
  jobId: string
): Promise<ProviderParseResult> {
  const docs = await loadJsonDocuments(extractedRoot);
  if (docs.length === 0) {
    throw new Error("Gemini parser could not find a usable JSON file.");
  }

  const warnings: string[] = [];
  const conversations = new Map<string, CanonicalConversation>();
  const messages = new Map<string, CanonicalMessage>();
  const attachments: CanonicalAttachment[] = [];

  for (const doc of docs) {
    const sourcePath = geminiSourcePath(sourceRelRoot, doc.relPath);
    const candidates = candidateConversationsFromDoc(doc.value);

    for (let index = 0; index < candidates.length; index += 1) {
      const conv = candidates[index];
      const rawConversationId =
        conversationId(conv) || `gemini_${doc.relPath.replace(/[^a-zA-Z0-9_-]/g, "_")}_${index}`;
      const conversationCanonicalId = canonicalId(
        "cnv",
        "gemini",
        rawConversationId,
        `${doc.relPath}:${index}`
      );

      if (!conversations.has(conversationCanonicalId)) {
        conversations.set(conversationCanonicalId, {
          id: conversationCanonicalId,
          provider: "gemini",
          provider_conversation_id: rawConversationId,
          title: conversationTitle(conv),
          created_at: toIsoOrUndefined(conv.created_at || conv.create_time || conv.createdAt),
          updated_at: toIsoOrUndefined(conv.updated_at || conv.update_time || conv.updatedAt),
          source_job_id: jobId,
          source_path: sourcePath
        });
      }

      const messageRows = candidateMessagesFromConversation(conv);
      for (let messageIndex = 0; messageIndex < messageRows.length; messageIndex += 1) {
        const row = messageRows[messageIndex];
        const text = geminiMessageText(row);
        const role = geminiRole(row);
        const model = geminiModel(row);
        const createdAt = toIsoOrUndefined(
          row.created_at || row.create_time || row.createdAt || row.timestamp || row.time
        );
        const providerMessageId = String(
          row.id || row.uuid || row.message_id || row.turn_id || row.event_id || ""
        ).trim();

        if (!providerMessageId && !text) continue;

        const messageCanonicalId = canonicalId(
          "msg",
          "gemini",
          providerMessageId || undefined,
          `${rawConversationId}:${messageIndex}:${role}:${text}:${createdAt || ""}`
        );

        if (!messages.has(messageCanonicalId)) {
          messages.set(messageCanonicalId, {
            id: messageCanonicalId,
            conversation_id: conversationCanonicalId,
            provider: "gemini",
            provider_message_id: providerMessageId || undefined,
            model,
            role,
            text,
            created_at: createdAt,
            attachment_ids: [],
            source_job_id: jobId,
            source_path: sourcePath
          });
        }
      }
    }
  }

  if (conversations.size === 0) {
    warnings.push("No conversations parsed from Gemini export payload.");
  }
  if (messages.size === 0) {
    warnings.push("No messages parsed from Gemini export payload.");
  }

  return {
    provider: "gemini",
    conversations: [...conversations.values()],
    messages: [...messages.values()],
    attachments,
    warnings
  };
}
