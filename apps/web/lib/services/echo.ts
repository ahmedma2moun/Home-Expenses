import { AppError } from "@/lib/api/envelope";
import { getAnalysisProvider } from "@/lib/ai";
import { getAnalysisProviderName } from "@/lib/ai/config";

export interface EchoResult {
  answer: string;
  provider: string;
  model: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * Deploy smoke test: round-trips a question through the configured analysis provider.
 * Unlike normal endpoints, the real provider error message is surfaced (not swallowed into a
 * generic 500) — this route exists specifically to tell you *why* a deploy can't reach the model,
 * and it's gated by DEBUG_API_TOKEN, not exposed to end users.
 */
export async function askEcho(question: string): Promise<EchoResult> {
  const provider = getAnalysisProvider();

  let result;
  try {
    result = await provider.compare({ systemPrompt: question, diffJson: "" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown provider error.";
    throw new AppError("INTERNAL_ERROR", `AI provider call failed: ${message}`, 502);
  }

  return {
    answer: result.text,
    provider: getAnalysisProviderName(),
    model: result.model,
    latencyMs: result.latencyMs,
    ...(result.inputTokens !== undefined && { inputTokens: result.inputTokens }),
    ...(result.outputTokens !== undefined && { outputTokens: result.outputTokens }),
  };
}
