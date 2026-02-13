export type Provider = "chatgpt" | "claude" | "gemini";

export type AttachmentStatus = "embedded" | "linked" | "missing";
export type AttachmentStorage = "blob" | "url" | "missing";

export interface ProvenanceFields {
  source_job_id: string;
  source_path?: string;
  first_seen_job_id?: string;
  last_seen_job_id?: string;
  seen_in_jobs?: string[];
}

export interface CanonicalConversation extends ProvenanceFields {
  id: string;
  provider: Provider;
  provider_conversation_id: string;
  title?: string;
  created_at?: string;
  updated_at?: string;
}

export interface CanonicalMessage extends ProvenanceFields {
  id: string;
  conversation_id: string;
  provider: Provider;
  provider_message_id?: string;
  role: string;
  text: string;
  created_at?: string;
  attachment_ids?: string[];
}

export interface CanonicalAttachment extends ProvenanceFields {
  id: string;
  provider: Provider;
  provider_attachment_id?: string;
  message_id: string;
  kind?: string;
  mime_type?: string;
  size_bytes?: number;
  storage: AttachmentStorage;
  blob_sha256?: string;
  url?: string | null;
  status: AttachmentStatus;
  local_relpath?: string;
}

export interface ProviderParseResult {
  provider: Provider;
  conversations: CanonicalConversation[];
  messages: CanonicalMessage[];
  attachments: CanonicalAttachment[];
  warnings: string[];
}

export interface ImportCounters {
  conversations: {
    new: number;
    updated: number;
    unchanged: number;
    failed: number;
  };
  messages: {
    new: number;
    updated: number;
    unchanged: number;
    failed: number;
  };
  attachments: {
    new: number;
    updated: number;
    unchanged: number;
    failed: number;
  };
}

export interface ImportResult {
  jobId: string;
  provider: Provider;
  status: "NORMALIZED" | "FAILED";
  startedAt: string;
  endedAt: string;
  rawRootPath: string;
  downloadArtifactRetained: boolean;
  counters: ImportCounters;
  warnings: string[];
  errors: string[];
}

export interface RunRecord {
  job_id: string;
  provider: Provider;
  status:
    | "PACKAGE_SELECTED"
    | "PACKAGE_VALIDATED"
    | "EXTRACTED_TO_RAW"
    | "PARSED_PROVIDER_RECORDS"
    | "MAPPED_CANONICAL_RECORDS"
    | "DEDUPED_UPSERTED"
    | "NORMALIZED"
    | "FAILED";
  started_at: string;
  ended_at?: string;
  raw_root_path?: string;
  download_artifact_retained: boolean;
  canonical_records?: {
    conversations: number;
    messages: number;
    attachments: number;
  };
  summary?: {
    conversations: { new: number; updated: number; unchanged: number; failed: number };
    messages: { new: number; updated: number; unchanged: number; failed: number };
    attachments: { new: number; updated: number; unchanged: number; failed: number };
  };
  warnings?: string[];
  errors?: string[];
}
