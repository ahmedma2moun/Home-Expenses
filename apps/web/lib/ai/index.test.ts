import { afterEach, describe, expect, it } from "vitest";
import { getAnalysisProvider, getExtractionProvider } from "./index";
import { AnthropicProvider } from "./anthropic/provider";
import { GeminiProvider } from "./gemini/provider";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("getExtractionProvider", () => {
  it("returns a GeminiProvider by default", () => {
    delete process.env.EXTRACTION_PROVIDER;
    expect(getExtractionProvider()).toBeInstanceOf(GeminiProvider);
  });

  it("returns an AnthropicProvider when configured", () => {
    process.env.EXTRACTION_PROVIDER = "anthropic";
    expect(getExtractionProvider()).toBeInstanceOf(AnthropicProvider);
  });
});

describe("getAnalysisProvider", () => {
  it("returns a GeminiProvider by default", () => {
    delete process.env.ANALYSIS_PROVIDER;
    expect(getAnalysisProvider()).toBeInstanceOf(GeminiProvider);
  });

  it("returns an AnthropicProvider when configured", () => {
    process.env.ANALYSIS_PROVIDER = "anthropic";
    expect(getAnalysisProvider()).toBeInstanceOf(AnthropicProvider);
  });
});
