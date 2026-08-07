import Anthropic, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
} from "@anthropic-ai/sdk";
import type {
  AiResult,
  AnalysisInput,
  AnalysisProvider,
  AnalysisResult,
  ExtractionInput,
  ExtractionProvider,
  ExtractionResult,
  PromptProvider,
} from "@/lib/ai/types";
import { withRetry } from "@/lib/ai/retry";
import { getAnthropicApiKey } from "@/lib/ai/config";

type AnthropicMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

const ANTHROPIC_MEDIA_TYPE_BY_INPUT: Record<string, AnthropicMediaType> = {
  "image/jpeg": "image/jpeg",
  "image/png": "image/png",
  "image/gif": "image/gif",
  "image/webp": "image/webp",
};

/** `ReceiptImageInput.mediaType` is already restricted to jpeg/png/webp by the upload Zod schema
 *  (`ReceiptImageInputSchema`) — this is a narrowing lookup, not new validation, so the SDK's image
 *  block type is satisfied without an unchecked `as` cast. */
function toAnthropicMediaType(mediaType: string): AnthropicMediaType {
  const mapped = ANTHROPIC_MEDIA_TYPE_BY_INPUT[mediaType];
  if (!mapped) {
    throw new Error(`Unsupported image media type for Anthropic: ${mediaType}`);
  }
  return mapped;
}

let cachedClient: Anthropic | undefined;

function getClient(): Anthropic {
  // The SDK's own retries would run *underneath* withRetry's, each one holding a full attemptTimeout
  // slice with no visibility into the shared deadline below — disabled so withRetry is the only
  // retry loop in play and its deadline budgeting (lib/ai/retry.ts) means what it says.
  cachedClient ??= new Anthropic({ apiKey: getAnthropicApiKey(), maxRetries: 0 });
  return cachedClient;
}

function isRetryable(error: unknown): boolean {
  // A timeout or dropped connection carries no HTTP status — the previous status-only check
  // treated both as non-retryable, so a single network blip failed the whole receipt (no blob
  // storage means the user has to re-shoot and re-upload rather than the backend quietly retrying).
  if (error instanceof APIConnectionError || error instanceof APIConnectionTimeoutError) {
    return true;
  }
  if (error instanceof APIError) {
    return error.status === 429 || (error.status !== undefined && error.status >= 500);
  }
  return false;
}

export class AnthropicProvider implements ExtractionProvider, AnalysisProvider, PromptProvider {
  constructor(private readonly model: string) {}

  async respond(prompt: string): Promise<AiResult & { text: string }> {
    const outcome = await withRetry(
      (timeoutMs) =>
        getClient().messages.create(
          {
            model: this.model,
            max_tokens: 2048,
            messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
          },
          { timeout: timeoutMs },
        ),
      { isRetryable },
    );

    return toResult(this.model, outcome);
  }

  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    const content: Anthropic.MessageParam["content"] = [
      ...input.images
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((image): Anthropic.ImageBlockParam => ({
          type: "image",
          source: {
            type: "base64",
            media_type: toAnthropicMediaType(image.mediaType),
            data: image.base64,
          },
        })),
      { type: "text", text: input.systemPrompt },
    ];

    const outcome = await withRetry(
      (timeoutMs) =>
        getClient().messages.create(
          { model: this.model, max_tokens: 16384, messages: [{ role: "user", content }] },
          { timeout: timeoutMs },
        ),
      { isRetryable, ...(input.deadlineMs !== undefined && { deadlineMs: input.deadlineMs }) },
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
      { isRetryable, ...(input.deadlineMs !== undefined && { deadlineMs: input.deadlineMs }) },
    );

    return toResult(this.model, outcome);
  }
}

function toResult(
  model: string,
  outcome: { result: Anthropic.Message; latencyMs: number; attempts: number },
): ExtractionResult & AnalysisResult {
  const { result: message, latencyMs, attempts } = outcome;
  return {
    model,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    latencyMs,
    attempts,
    text: message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join(""),
  };
}
