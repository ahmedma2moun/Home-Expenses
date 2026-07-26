export type ProviderName = "gemini" | "anthropic";

const PROVIDER_NAMES: readonly ProviderName[] = ["gemini", "anthropic"];

function readProviderName(envVar: "EXTRACTION_PROVIDER" | "ANALYSIS_PROVIDER"): ProviderName {
  const value = process.env[envVar] ?? "gemini";
  if (!isProviderName(value)) {
    throw new Error(`Unknown ${envVar} "${value}" — expected one of ${PROVIDER_NAMES.join(", ")}.`);
  }
  return value;
}

function isProviderName(value: string): value is ProviderName {
  return (PROVIDER_NAMES as readonly string[]).includes(value);
}

/** Extraction (vision) and analysis (text) are configured independently (AI_PROVIDER.md §2). */
export function getExtractionProviderName(): ProviderName {
  return readProviderName("EXTRACTION_PROVIDER");
}

export function getAnalysisProviderName(): ProviderName {
  return readProviderName("ANALYSIS_PROVIDER");
}

export function getExtractionModel(): string {
  return process.env.EXTRACTION_MODEL ?? "gemini-3.5-flash";
}

export function getAnalysisModel(): string {
  return process.env.ANALYSIS_MODEL ?? "gemini-3.5-flash";
}

export function getGeminiApiKey(): string {
  return requireEnv("GEMINI_API_KEY");
}

export function getAnthropicApiKey(): string {
  return requireEnv("ANTHROPIC_API_KEY");
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var ${name}`);
  }
  return value;
}
