import { ApiError, GoogleGenAI, type Part } from "@google/genai";
import type {
  AnalysisInput,
  AnalysisProvider,
  AnalysisResult,
  ExtractionInput,
  ExtractionProvider,
  ExtractionResult,
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
  return error instanceof ApiError && (error.status === 429 || error.status >= 500);
}

export class GeminiProvider implements ExtractionProvider, AnalysisProvider {
  constructor(private readonly model: string) {}

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
    return this.generate(contents, { responseMimeType: "application/json" });
  }

  async compare(input: AnalysisInput): Promise<AnalysisResult> {
    const contents: Part[] = [{ text: `${input.systemPrompt}\n\n${input.diffJson}` }];
    return this.generate(contents, {});
  }

  private async generate(
    contents: Part[],
    extraConfig: { responseMimeType?: string },
  ): Promise<ExtractionResult & AnalysisResult> {
    const outcome = await withRetry(
      (timeoutMs) =>
        getClient().models.generateContent({
          model: this.model,
          contents,
          config: {
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            httpOptions: { timeout: timeoutMs },
            ...extraConfig,
          },
        }),
      { isRetryable },
    );

    const { result: response, latencyMs } = outcome;
    const inputTokens = response.usageMetadata?.promptTokenCount;
    const outputTokens = response.usageMetadata?.candidatesTokenCount;
    return {
      model: this.model,
      ...(inputTokens !== undefined && { inputTokens }),
      ...(outputTokens !== undefined && { outputTokens }),
      latencyMs,
      text: response.text ?? "",
    };
  }
}
