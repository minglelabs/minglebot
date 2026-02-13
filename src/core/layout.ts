import path from "node:path";
import { ensureDir, writeJsonFile } from "../lib/fsx";

export interface Layout {
  root: string;
  mingleRoot: string;
  rawRoot: string;
  providerRoot: string;
  canonicalRoot: string;
  blobsRoot: string;
  indexesRoot: string;
  jobsRoot: string;
  errorsRoot: string;
}

export function resolveLayout(root?: string): Layout {
  const dataRoot = root || process.env.MINGLE_DATA_ROOT || path.join(process.cwd(), "data");
  return {
    root: dataRoot,
    mingleRoot: path.join(dataRoot, "_mingle"),
    rawRoot: path.join(dataRoot, "raw"),
    providerRoot: path.join(dataRoot, "provider"),
    canonicalRoot: path.join(dataRoot, "canonical"),
    blobsRoot: path.join(dataRoot, "blobs"),
    indexesRoot: path.join(dataRoot, "indexes"),
    jobsRoot: path.join(dataRoot, "jobs"),
    errorsRoot: path.join(dataRoot, "errors")
  };
}

export async function ensureLayout(layout: Layout): Promise<void> {
  await Promise.all([
    ensureDir(layout.root),
    ensureDir(layout.mingleRoot),
    ensureDir(layout.rawRoot),
    ensureDir(layout.providerRoot),
    ensureDir(layout.canonicalRoot),
    ensureDir(layout.blobsRoot),
    ensureDir(layout.indexesRoot),
    ensureDir(layout.jobsRoot),
    ensureDir(layout.errorsRoot)
  ]);

  await writeJsonFile(path.join(layout.mingleRoot, "schema-version.json"), {
    schema: "mingle-filesystem",
    version: "1.0.0",
    updated_at: new Date().toISOString()
  });
}
