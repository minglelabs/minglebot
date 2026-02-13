import { sha256 } from "./hash";

function safe(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function canonicalId(prefix: string, provider: string, rawId?: string, fallback?: string): string {
  if (rawId && rawId.trim()) {
    return `mb_${provider}_${prefix}_${safe(rawId)}`;
  }
  return `mb_${provider}_${prefix}_${sha256(fallback || "missing").slice(0, 20)}`;
}
