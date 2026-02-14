import path from "node:path";
import { promises as fs } from "node:fs";
import { listFilesRecursive } from "../lib/fsx";

export interface JsonDoc {
  absPath: string;
  relPath: string;
  value: unknown;
}

export interface TextDoc {
  absPath: string;
  relPath: string;
  text: string;
}

export async function loadJsonDocuments(extractedRoot: string): Promise<JsonDoc[]> {
  const files = await listFilesRecursive(extractedRoot);
  const jsonFiles = files.filter((filePath) => filePath.toLowerCase().endsWith(".json"));
  const docs: JsonDoc[] = [];

  for (const filePath of jsonFiles) {
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      docs.push({
        absPath: filePath,
        relPath: path.relative(extractedRoot, filePath).replace(/\\/g, "/"),
        value: JSON.parse(raw)
      });
    } catch {
      // Ignore malformed files. Higher-level parser reports if no usable docs found.
    }
  }

  return docs;
}

export async function loadTextDocuments(
  extractedRoot: string,
  extensions: string[] = [".md", ".markdown", ".txt"]
): Promise<TextDoc[]> {
  const files = await listFilesRecursive(extractedRoot);
  const normalized = new Set(extensions.map((ext) => ext.toLowerCase()));
  const textFiles = files.filter((filePath) => normalized.has(path.extname(filePath).toLowerCase()));
  const docs: TextDoc[] = [];

  for (const filePath of textFiles) {
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      docs.push({
        absPath: filePath,
        relPath: path.relative(extractedRoot, filePath).replace(/\\/g, "/"),
        text: raw
      });
    } catch {
      // Ignore unreadable files.
    }
  }

  return docs;
}

export function textFromUnknown(input: unknown): string {
  if (typeof input === "string") return input;
  if (typeof input === "number" || typeof input === "boolean") return String(input);
  if (Array.isArray(input)) {
    return input.map((item) => textFromUnknown(item)).filter(Boolean).join("\n");
  }
  if (input && typeof input === "object") {
    const candidate = input as Record<string, unknown>;
    if (typeof candidate.text === "string") return candidate.text;
    if (typeof candidate.value === "string") return candidate.value;
    if (typeof candidate.content === "string") return candidate.content;
    if (Array.isArray(candidate.parts)) return textFromUnknown(candidate.parts);
  }
  return "";
}

export function toIsoOrUndefined(value: unknown): string | undefined {
  if (typeof value === "number") {
    const millis = value > 1e12 ? value : value * 1000;
    return new Date(millis).toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const asNum = Number(value);
    if (!Number.isNaN(asNum) && value.trim().match(/^\d+(\.\d+)?$/)) {
      const millis = asNum > 1e12 ? asNum : asNum * 1000;
      return new Date(millis).toISOString();
    }
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return undefined;
}

export function getObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function getArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
