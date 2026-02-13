import { Provider, ProviderParseResult } from "../types/schema";
import { parseChatGPT } from "./chatgpt";
import { parseClaude } from "./claude";

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
      throw new Error("Gemini parser is not implemented yet in v1. Please use ChatGPT or Claude imports.");
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}
