import { ApiError, GoogleGenAI, type Part } from "@google/genai";
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
import { getGeminiApiKey } from "@/lib/ai/config";

const MAX_OUTPUT_TOKENS = 16384;

let cachedClient: GoogleGenAI | undefined;

function getClient(): GoogleGenAI {
  cachedClient ??= new GoogleGenAI({ apiKey: getGeminiApiKey() });
  return cachedClient;
}

function isRetryable(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.status === 429 || error.status >= 500;
  }
  // A timeout or dropped connection never reaches the point of building an ApiError (there's no
  // HTTP response to build one from) — the SDK surfaces those as a plain Error/TypeError instead.
  // Without this branch, a single network blip fails the whole receipt, since there's no blob
  // storage to fall back on re-reading — the user has to re-shoot and re-upload.
  return error instanceof Error && ["AbortError", "TimeoutError", "TypeError"].includes(error.name);
}

export class GeminiProvider implements ExtractionProvider, AnalysisProvider, PromptProvider {
  constructor(private readonly model: string) {}

  async respond(prompt: string): Promise<AiResult & { text: string }> {
    return this.generate([{ text: prompt }], {});
  }

  async extract(input: ExtractionInput): Promise<ExtractionResult> {
    const contents: Part[] = [
      ...input.images
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((image): Part => ({ inlineData: { data: image.base64, mimeType: image.mediaType } })),
      { text: input.systemPrompt },
    ];

    // Force strict JSON output (AI_PROVIDER.md §4) — without this, newer Gemini models can spend
    // the whole output budget on hidden "thinking" tokens or wrap the answer in prose/fences,
    // leaving nothing (or unparseable text) for us to extract.
    return this.generate(contents, { responseMimeType: "application/json" }, input.deadlineMs);
  }

  async compare(input: AnalysisInput): Promise<AnalysisResult> {
    const contents: Part[] = [{ text: `${input.systemPrompt}\n\n${input.diffJson}` }];
    return this.generate(contents, {});
  }

  private async generate(
    contents: Part[],
    extraConfig: { responseMimeType?: string },
    deadlineMs?: number,
  ): Promise<ExtractionResult & AnalysisResult> {
    const outcome = await withRetry(
      (timeoutMs) =>
        getClient().models.generateContent({
          model: this.model,
          contents,
          config: {
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            // `attempts: 1` = no SDK-internal retries (per HttpRetryOptions' own doc, default is
            // 5) — withRetry is meant to be the only retry loop, since it's the one with the
            // shared deadline (lib/ai/retry.ts); the SDK retrying underneath it defeats that budget.
            httpOptions: { timeout: timeoutMs, retryOptions: { attempts: 1 } },
            ...extraConfig,
          },
        }),
      { isRetryable, ...(deadlineMs !== undefined && { deadlineMs }) },
    );

    const { result: response, latencyMs, attempts } = outcome;
    const inputTokens = response.usageMetadata?.promptTokenCount;
    const outputTokens = response.usageMetadata?.candidatesTokenCount;
    return {
      model: this.model,
      ...(inputTokens !== undefined && { inputTokens }),
      ...(outputTokens !== undefined && { outputTokens }),
      latencyMs,
      attempts,
      text: response.text ?? "",
    };
  }
}
