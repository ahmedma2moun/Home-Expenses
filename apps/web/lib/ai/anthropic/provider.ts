import Anthropic, { APIError } from "@anthropic-ai/sdk";
import type {
  AnalysisInput,
  AnalysisProvider,
  AnalysisResult,
  ExtractionInput,
  ExtractionProvider,
  ExtractionResult,
} from "@/lib/ai/types";
import { withRetry } from "@/lib/ai/retry";
import { getAnthropicApiKey } from "@/lib/ai/config";

type AnthropicMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

let cachedClient: Anthropic | undefined;

function getClient(): Anthropic {
  cachedClient ??= new Anthropic({ apiKey: getAnthropicApiKey() });
  return cachedClient;
}

function isRetryable(error: unknown): boolean {
  if (!(error instanceof APIError)) {
    return false;
  }
  return error.status === 429 || (error.status !== undefined && error.status >= 500);
}

export class AnthropicProvider implements ExtractionProvider, AnalysisProvider {
  constructor(private readonly model: string) {}

  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    const content: Anthropic.MessageParam["content"] = [
      ...input.images
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((image): Anthropic.ImageBlockParam => ({
          type: "image",
          source: {
            type: "base64",
            media_type: image.mediaType as AnthropicMediaType,
            data: image.base64,
          },
        })),
      { type: "text", text: input.systemPrompt },
    ];

    const outcome = await withRetry(
      (timeoutMs) =>
        getClient().messages.create(
          { model: this.model, max_tokens: 4096, messages: [{ role: "user", content }] },
          { timeout: timeoutMs },
        ),
      { isRetryable },
    );

    return toResult(this.model, outcome);
  }

  async compare(input: AnalysisInput): Promise<AnalysisResult> {
    const content: Anthropic.MessageParam["content"] = [
      { type: "text", text: `${input.systemPrompt}\n\n${input.diffJson}` },
    ];

    const outcome = await withRetry(
      (timeoutMs) =>
        getClient().messages.create(
          { model: this.model, max_tokens: 2048, messages: [{ role: "user", content }] },
          { timeout: timeoutMs },
        ),
      { isRetryable },
    );

    return toResult(this.model, outcome);
  }
}

function toResult(
  model: string,
  outcome: { result: Anthropic.Message; latencyMs: number },
): ExtractionResult & AnalysisResult {
  const { result: message, latencyMs } = outcome;
  return {
    model,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    latencyMs,
    text: message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join(""),
  };
}
