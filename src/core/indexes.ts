import path from "node:path";
import { promises as fs } from "node:fs";
import { CanonicalMessage, Provider } from "../types/schema";
import { ensureDir, writeNdjson } from "../lib/fsx";
import { Layout } from "./layout";

export async function rebuildMessageIndexes(layout: Layout, messages: CanonicalMessage[]): Promise<void> {
  const byProviderRoot = path.join(layout.indexesRoot, "by-provider");
  const byDateRoot = path.join(layout.indexesRoot, "by-date");

  await ensureDir(byProviderRoot);
  await ensureDir(byDateRoot);

  const providers = [...new Set(messages.map((m) => m.provider))] as Provider[];
  for (const provider of providers) {
    const rows = messages.filter((m) => m.provider === provider);
    const outPath = path.join(byProviderRoot, provider, "messages.ndjson");
    await writeNdjson(outPath, rows);
  }

  const dayMap = new Map<string, CanonicalMessage[]>();
  for (const row of messages) {
    const datePart = row.created_at ? row.created_at.slice(0, 10) : "unknown";
    if (!dayMap.has(datePart)) dayMap.set(datePart, []);
    dayMap.get(datePart)!.push(row);
  }

  for (const [datePart, rows] of dayMap.entries()) {
    if (datePart === "unknown") {
      const outPath = path.join(byDateRoot, "unknown", "messages.ndjson");
      await writeNdjson(outPath, rows);
      continue;
    }

    const [y, m, d] = datePart.split("-");
    const outPath = path.join(byDateRoot, y, m, d, "messages.ndjson");
    await writeNdjson(outPath, rows);
  }
}

export async function writeCatalog(layout: Layout): Promise<void> {
  const catalogPath = path.join(layout.mingleRoot, "catalog.json");
  const payload = {
    schema: "mingle-filesystem",
    updated_at: new Date().toISOString(),
    roots: {
      raw: path.relative(layout.root, layout.rawRoot) || "raw",
      provider: path.relative(layout.root, layout.providerRoot) || "provider",
      canonical: path.relative(layout.root, layout.canonicalRoot) || "canonical",
      blobs: path.relative(layout.root, layout.blobsRoot) || "blobs",
      indexes: path.relative(layout.root, layout.indexesRoot) || "indexes",
      jobs: path.relative(layout.root, layout.jobsRoot) || "jobs",
      errors: path.relative(layout.root, layout.errorsRoot) || "errors"
    }
  };

  await ensureDir(path.dirname(catalogPath));
  await fs.writeFile(catalogPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
}
