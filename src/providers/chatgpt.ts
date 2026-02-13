import { canonicalId } from "../lib/id";
import {
  CanonicalAttachment,
  CanonicalConversation,
  CanonicalMessage,
  ProviderParseResult
} from "../types/schema";
import { getArray, getObject, loadJsonDocuments, textFromUnknown, toIsoOrUndefined } from "./common";

function chatgptSourcePath(sourceRelRoot: string, rel: string): string {
  return `${sourceRelRoot}/${rel}`.replace(/\\/g, "/");
}

export async function parseChatGPT(
  extractedRoot: string,
  sourceRelRoot: string,
  jobId: string
): Promise<ProviderParseResult> {
  const docs = await loadJsonDocuments(extractedRoot);
  const warnings: string[] = [];

  const conversationDoc = docs.find((doc) => doc.relPath.toLowerCase().endsWith("conversations.json"));
  const fallbackDoc = docs.find((doc) =>
    Array.isArray(doc.value) &&
    (doc.value as unknown[]).some(
      (item) => !!getObject(item)?.mapping || typeof getObject(item)?.id === "string"
    )
  );

  const targetDoc = conversationDoc || fallbackDoc;
  if (!targetDoc) {
    throw new Error("ChatGPT parser could not find a usable conversations JSON file.");
  }

  const rows = getArray(targetDoc.value);
  const conversations: CanonicalConversation[] = [];
  const messages: CanonicalMessage[] = [];
  const attachments: CanonicalAttachment[] = [];

  for (const row of rows) {
    const conv = getObject(row);
    if (!conv) continue;

    const providerConversationId = String(conv.id || "").trim();
    if (!providerConversationId) continue;

    const conversationId = canonicalId("cnv", "chatgpt", providerConversationId, providerConversationId);
    const sourcePath = chatgptSourcePath(sourceRelRoot, targetDoc.relPath);

    conversations.push({
      id: conversationId,
      provider: "chatgpt",
      provider_conversation_id: providerConversationId,
      title: typeof conv.title === "string" ? conv.title : undefined,
      created_at: toIsoOrUndefined(conv.create_time),
      updated_at: toIsoOrUndefined(conv.update_time),
      source_job_id: jobId,
      source_path: sourcePath
    });

    const mapping = getObject(conv.mapping) || {};
    const mappingValues = Object.values(mapping);

    for (const mapNode of mappingValues) {
      const node = getObject(mapNode);
      if (!node) continue;
      const msgObj = getObject(node.message);
      if (!msgObj) continue;

      const providerMessageId = String(msgObj.id || node.id || "").trim();
      if (!providerMessageId) continue;

      const role = String(getObject(msgObj.author)?.role || "unknown");
      const contentObj = getObject(msgObj.content);
      const text = textFromUnknown(contentObj?.parts || contentObj?.text || msgObj.content);
      const createdAt = toIsoOrUndefined(msgObj.create_time || node.create_time);

      const messageId = canonicalId(
        "msg",
        "chatgpt",
        providerMessageId,
        `${providerConversationId}:${role}:${text}:${createdAt || ""}`
      );

      const attachmentIds: string[] = [];
      const messageMeta = getObject(msgObj.metadata);
      const messageAttachments = getArray(messageMeta?.attachments);

      for (const rawAttachment of messageAttachments) {
        const attachment = getObject(rawAttachment);
        if (!attachment) continue;
        const providerAttachmentId = String(attachment.id || attachment.asset_pointer || "").trim();
        const attachmentId = canonicalId(
          "att",
          "chatgpt",
          providerAttachmentId || undefined,
          `${messageId}:${JSON.stringify(attachment)}`
        );
        attachmentIds.push(attachmentId);

        attachments.push({
          id: attachmentId,
          provider: "chatgpt",
          provider_attachment_id: providerAttachmentId || undefined,
          message_id: messageId,
          kind: typeof attachment.type === "string" ? attachment.type : "attachment",
          mime_type: typeof attachment.mime_type === "string" ? attachment.mime_type : undefined,
          size_bytes: typeof attachment.size_bytes === "number" ? attachment.size_bytes : undefined,
          storage: typeof attachment.url === "string" ? "url" : "missing",
          url: typeof attachment.url === "string" ? attachment.url : null,
          status: typeof attachment.url === "string" ? "linked" : "missing",
          source_job_id: jobId,
          source_path: sourcePath
        });
      }

      messages.push({
        id: messageId,
        conversation_id: conversationId,
        provider: "chatgpt",
        provider_message_id: providerMessageId,
        role,
        text,
        created_at: createdAt,
        attachment_ids: attachmentIds,
        source_job_id: jobId,
        source_path: sourcePath
      });
    }
  }

  if (!conversations.length) {
    warnings.push("No conversations parsed from ChatGPT export payload.");
  }
  if (!messages.length) {
    warnings.push("No messages parsed from ChatGPT export payload.");
  }

  return {
    provider: "chatgpt",
    conversations,
    messages,
    attachments,
    warnings
  };
}
