/** Shared telemetry every provider reports (AI_PROVIDER.md §4). Local models omit token counts. */
export interface AiResult {
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
  /** How many `withRetry` attempts this one call took (§7.1's cost/latency tracking). */
  attempts: number;
}

export interface ReceiptImageInput {
  base64: string;
  mediaType: string;
  position: number;
}

export interface ExtractionInput {
  images: ReceiptImageInput[];
  systemPrompt: string;
  /** Shared `withRetry` deadline (`Date.now()`-scale) — see `lib/ai/retry.ts`'s `RetryOptions`. */
  deadlineMs?: number;
}

export interface ExtractionResult extends AiResult {
  text: string;
}

export interface AnalysisInput {
  /** Compact aggregate JSON — never raw items (PROJECT_SPEC.md §7.3). */
  diffJson: string;
  systemPrompt: string;
  /** Shared `withRetry` deadline (`Date.now()`-scale) — see `lib/ai/retry.ts`'s `RetryOptions`. */
  deadlineMs?: number;
}

export interface AnalysisResult extends AiResult {
  text: string;
}

/** Vision: read receipt images, return the raw model text (parsed + Zod-validated by the caller). */
export interface ExtractionProvider {
  extract(input: ExtractionInput): Promise<ExtractionResult>;
}

/** Text: month-vs-month narrative from aggregates. */
export interface AnalysisProvider {
  compare(input: AnalysisInput): Promise<AnalysisResult>;
}

/**
 * A bare single-turn text prompt with no domain shape — only `POST /echo`'s deploy smoke test uses
 * this (docs/api.md). Kept separate from `AnalysisProvider.compare` on purpose: `compare` is the
 * real month-vs-month contract (`diffJson` isn't optional there), and overloading it with an empty
 * `diffJson` for a smoke test would make that contract's own type lie about what's required.
 */
export interface PromptProvider {
  respond(prompt: string): Promise<AiResult & { text: string }>;
}
