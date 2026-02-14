import path from "node:path";
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
  loadTextDocuments,
  textFromUnknown,
  toIsoOrUndefined
} from "./common";

interface ParsedCursorMessage {
  role: string;
  text: string;
}

interface ParsedCursorConversation {
  providerConversationId?: string;
  title?: string;
  createdAt?: string;
  updatedAt?: string;
  messages: Array<{
    providerMessageId?: string;
    role: string;
    text: string;
    createdAt?: string;
    model?: string;
  }>;
}

function cursorSourcePath(sourceRelRoot: string, rel: string): string {
  return `${sourceRelRoot}/${rel}`.replace(/\\/g, "/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeCursorRole(value: string): string {
  const role = value.trim().toLowerCase();
  if (["assistant", "ai", "cursor", "model", "bot"].includes(role)) return "assistant";
  if (["user", "human", "you", "me"].includes(role)) return "user";
  if (role === "system") return "system";
  return role || "unknown";
}

function detectRoleHeader(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const patterns = [
    /^#{1,6}\s*[^a-zA-Z0-9]*(user|assistant|ai|system|human|you|cursor)\b.*$/i,
    /^\*\*(user|assistant|ai|system|human|you|cursor)\*\*:?\s*$/i,
    /^(user|assistant|ai|system|human|you|cursor)\s*:\s*$/i,
    /^>\s*(user|assistant|ai|system|human|you|cursor)\s*:?\s*$/i
  ];

  for (const pattern of patterns) {
    const matched = trimmed.match(pattern);
    if (!matched) continue;
    return normalizeCursorRole(matched[1]);
  }

  return null;
}

function firstHeading(text: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    const matched = trimmed.match(/^#\s+(.+)$/);
    if (matched && matched[1].trim()) {
      return matched[1].trim();
    }
  }
  return undefined;
}

function parseCursorMarkdownMessages(text: string): ParsedCursorMessage[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const messages: ParsedCursorMessage[] = [];

  let currentRole: string | null = null;
  let buffer: string[] = [];

  const flush = (): void => {
    if (!currentRole) return;
    const body = buffer.join("\n").trim();
    if (body) {
      messages.push({ role: currentRole, text: body });
    }
    buffer = [];
  };

  for (const line of lines) {
    const role = detectRoleHeader(line);
    if (role) {
      flush();
      currentRole = role;
      continue;
    }

    if (currentRole) {
      buffer.push(line);
    }
  }
  flush();

  if (messages.length > 0) return messages;

  const fallback: ParsedCursorMessage[] = [];
  const roleMarkers = [...text.matchAll(/(?:^|\n)(User|Assistant|AI|System|Human|You|Cursor)\s*:\s*/gi)];
  if (roleMarkers.length === 0) return fallback;

  for (let i = 0; i < roleMarkers.length; i += 1) {
    const marker = roleMarkers[i];
    const nextMarker = roleMarkers[i + 1];
    const from = (marker.index || 0) + marker[0].length;
    const to = nextMarker ? nextMarker.index : text.length;
    const body = text.slice(from, to).trim();
    if (!body) continue;

    fallback.push({
      role: normalizeCursorRole(marker[1]),
      text: body
    });
  }

  return fallback;
}

function looksLikeCursorMessage(value: Record<string, unknown>): boolean {
  return Boolean(
    value.role ||
      value.author ||
      value.sender ||
      value.text ||
      value.content ||
      value.parts ||
      value.message
  );
}

function cursorMessageText(value: Record<string, unknown>): string {
  return textFromUnknown(value.text || value.content || value.parts || value.message || value.body).trim();
}

function cursorMessageRole(value: Record<string, unknown>): string {
  const author = getObject(value.author);
  const raw = value.role || value.sender || value.from || author?.role || author?.type;
  return normalizeCursorRole(String(raw || "unknown"));
}

function cursorMessageModel(value: Record<string, unknown>): string | undefined {
  const model =
    value.model ||
    value.model_name ||
    value.modelName ||
    getObject(value.metadata)?.model ||
    getObject(value.meta)?.model;
  if (typeof model === "string" && model.trim()) return model.trim();
  return undefined;
}

function cursorConversationMessages(value: Record<string, unknown>): Record<string, unknown>[] {
  for (const key of ["messages", "turns", "entries", "items", "chat_messages"]) {
    const rows = getArray(value[key]).filter(isRecord).filter((row) => looksLikeCursorMessage(row));
    if (rows.length) return rows;
  }
  return [];
}

function extractCursorConversationsFromJson(value: unknown): ParsedCursorConversation[] {
  if (Array.isArray(value)) {
    const records = value.filter(isRecord);
    const grouped = records.filter((row) => cursorConversationMessages(row).length > 0);
    if (grouped.length > 0) {
      return grouped.map((row) => ({
        providerConversationId: String(
          row.id || row.uuid || row.conversation_id || row.thread_id || ""
        ).trim() || undefined,
        title:
          (typeof row.title === "string" && row.title.trim()) ||
          (typeof row.name === "string" && row.name.trim()) ||
          undefined,
        createdAt: toIsoOrUndefined(row.created_at || row.createdAt || row.create_time),
        updatedAt: toIsoOrUndefined(row.updated_at || row.updatedAt || row.update_time),
        messages: cursorConversationMessages(row).map((msg) => ({
          providerMessageId: String(msg.id || msg.uuid || msg.message_id || "").trim() || undefined,
          role: cursorMessageRole(msg),
          text: cursorMessageText(msg),
          createdAt: toIsoOrUndefined(msg.created_at || msg.createdAt || msg.timestamp),
          model: cursorMessageModel(msg)
        }))
      }));
    }

    const messageRows = records.filter((row) => looksLikeCursorMessage(row));
    if (messageRows.length > 0) {
      return [
        {
          messages: messageRows.map((msg) => ({
            providerMessageId: String(msg.id || msg.uuid || msg.message_id || "").trim() || undefined,
            role: cursorMessageRole(msg),
            text: cursorMessageText(msg),
            createdAt: toIsoOrUndefined(msg.created_at || msg.createdAt || msg.timestamp),
            model: cursorMessageModel(msg)
          }))
        }
      ];
    }
    return [];
  }

  const obj = getObject(value);
  if (!obj) return [];

  for (const key of ["conversations", "threads", "chats", "items", "data"]) {
    const rows = getArray(obj[key]).filter(isRecord);
    const parsed = extractCursorConversationsFromJson(rows);
    if (parsed.length > 0) return parsed;
  }

  const directMessages = cursorConversationMessages(obj);
  if (directMessages.length > 0) {
    return [
      {
        providerConversationId: String(
          obj.id || obj.uuid || obj.conversation_id || obj.thread_id || ""
        ).trim() || undefined,
        title:
          (typeof obj.title === "string" && obj.title.trim()) ||
          (typeof obj.name === "string" && obj.name.trim()) ||
          undefined,
        createdAt: toIsoOrUndefined(obj.created_at || obj.createdAt || obj.create_time),
        updatedAt: toIsoOrUndefined(obj.updated_at || obj.updatedAt || obj.update_time),
        messages: directMessages.map((msg) => ({
          providerMessageId: String(msg.id || msg.uuid || msg.message_id || "").trim() || undefined,
          role: cursorMessageRole(msg),
          text: cursorMessageText(msg),
          createdAt: toIsoOrUndefined(msg.created_at || msg.createdAt || msg.timestamp),
          model: cursorMessageModel(msg)
        }))
      }
    ];
  }

  if (looksLikeCursorMessage(obj)) {
    return [
      {
        messages: [
          {
            providerMessageId: String(obj.id || obj.uuid || obj.message_id || "").trim() || undefined,
            role: cursorMessageRole(obj),
            text: cursorMessageText(obj),
            createdAt: toIsoOrUndefined(obj.created_at || obj.createdAt || obj.timestamp),
            model: cursorMessageModel(obj)
          }
        ]
      }
    ];
  }

  return [];
}

export async function parseCursor(
  extractedRoot: string,
  sourceRelRoot: string,
  jobId: string
): Promise<ProviderParseResult> {
  const jsonDocs = await loadJsonDocuments(extractedRoot);
  const textDocs = await loadTextDocuments(extractedRoot, [".md", ".markdown"]);
  const warnings: string[] = [];

  const conversations = new Map<string, CanonicalConversation>();
  const messages = new Map<string, CanonicalMessage>();
  const attachments: CanonicalAttachment[] = [];

  for (const doc of jsonDocs) {
    const sourcePath = cursorSourcePath(sourceRelRoot, doc.relPath);
    const parsedConversations = extractCursorConversationsFromJson(doc.value);

    for (let convIndex = 0; convIndex < parsedConversations.length; convIndex += 1) {
      const parsed = parsedConversations[convIndex];
      const providerConversationId =
        parsed.providerConversationId ||
        `cursor_${doc.relPath.replace(/[^a-zA-Z0-9_-]/g, "_")}_${convIndex}`;
      const conversationId = canonicalId("cnv", "cursor", providerConversationId, providerConversationId);

      if (!conversations.has(conversationId)) {
        conversations.set(conversationId, {
          id: conversationId,
          provider: "cursor",
          provider_conversation_id: providerConversationId,
          title: parsed.title,
          created_at: parsed.createdAt,
          updated_at: parsed.updatedAt,
          source_job_id: jobId,
          source_path: sourcePath
        });
      }

      for (let messageIndex = 0; messageIndex < parsed.messages.length; messageIndex += 1) {
        const message = parsed.messages[messageIndex];
        if (!message.text) continue;

        const messageId = canonicalId(
          "msg",
          "cursor",
          message.providerMessageId,
          `${providerConversationId}:${messageIndex}:${message.role}:${message.text}:${message.createdAt || ""}`
        );
        if (messages.has(messageId)) continue;

        messages.set(messageId, {
          id: messageId,
          conversation_id: conversationId,
          provider: "cursor",
          provider_message_id: message.providerMessageId,
          model: message.model,
          role: message.role,
          text: message.text,
          created_at: message.createdAt,
          attachment_ids: [],
          source_job_id: jobId,
          source_path: sourcePath
        });
      }
    }
  }

  for (const doc of textDocs) {
    const sourcePath = cursorSourcePath(sourceRelRoot, doc.relPath);
    const markdownMessages = parseCursorMarkdownMessages(doc.text);
    if (markdownMessages.length === 0) continue;

    const base = path.basename(doc.relPath, path.extname(doc.relPath));
    const providerConversationId = `cursor_md_${doc.relPath.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
    const conversationId = canonicalId("cnv", "cursor", providerConversationId, providerConversationId);

    if (!conversations.has(conversationId)) {
      conversations.set(conversationId, {
        id: conversationId,
        provider: "cursor",
        provider_conversation_id: providerConversationId,
        title: firstHeading(doc.text) || base,
        created_at: undefined,
        updated_at: undefined,
        source_job_id: jobId,
        source_path: sourcePath
      });
    }

    for (let index = 0; index < markdownMessages.length; index += 1) {
      const row = markdownMessages[index];
      const messageId = canonicalId(
        "msg",
        "cursor",
        undefined,
        `${providerConversationId}:${index}:${row.role}:${row.text}`
      );

      if (messages.has(messageId)) continue;
      messages.set(messageId, {
        id: messageId,
        conversation_id: conversationId,
        provider: "cursor",
        provider_message_id: undefined,
        model: undefined,
        role: row.role,
        text: row.text,
        created_at: undefined,
        attachment_ids: [],
        source_job_id: jobId,
        source_path: sourcePath
      });
    }
  }

  if (conversations.size === 0) {
    warnings.push("No conversations parsed from Cursor export payload.");
  }
  if (messages.size === 0) {
    warnings.push("No messages parsed from Cursor export payload.");
  }

  return {
    provider: "cursor",
    conversations: [...conversations.values()],
    messages: [...messages.values()],
    attachments,
    warnings
  };
}
