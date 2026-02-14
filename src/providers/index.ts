import { Provider, ProviderParseResult } from "../types/schema";
import { parseChatGPT } from "./chatgpt";
import { parseClaude } from "./claude";
import { parseCursor } from "./cursor";
import { parseGemini } from "./gemini";

export async function parseProviderExport(
  provider: Provider,
  extractedRoot: string,
  sourceRelRoot: string,
  jobId: string
): Promise<ProviderParseResult> {
  switch (provider) {
    case "chatgpt":
      return parseChatGPT(extractedRoot, sourceRelRoot, jobId);
    case "claude":
      return parseClaude(extractedRoot, sourceRelRoot, jobId);
    case "gemini":
      return parseGemini(extractedRoot, sourceRelRoot, jobId);
    case "cursor":
      return parseCursor(extractedRoot, sourceRelRoot, jobId);
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}
