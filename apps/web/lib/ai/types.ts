/** Shared telemetry every provider reports (AI_PROVIDER.md §4). Local models omit token counts. */
export interface AiResult {
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
}

export interface ReceiptImageInput {
  base64: string;
  mediaType: string;
  position: number;
}

export interface ExtractionInput {
  images: ReceiptImageInput[];
  systemPrompt: string;
}

export interface ExtractionResult extends AiResult {
  text: string;
}

export interface AnalysisInput {
  /** Compact aggregate JSON — never raw items (PROJECT_SPEC.md §7.3). */
  diffJson: string;
  systemPrompt: string;
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
