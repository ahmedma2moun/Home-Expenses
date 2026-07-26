import { afterEach, describe, expect, it } from "vitest";
import {
  getAnalysisModel,
  getAnalysisProviderName,
  getAnthropicApiKey,
  getExtractionModel,
  getExtractionProviderName,
  getGeminiApiKey,
} from "./config";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("provider selection", () => {
  it("defaults both extraction and analysis to gemini", () => {
    delete process.env.EXTRACTION_PROVIDER;
    delete process.env.ANALYSIS_PROVIDER;

    expect(getExtractionProviderName()).toBe("gemini");
    expect(getAnalysisProviderName()).toBe("gemini");
  });

  it("lets extraction and analysis use different providers", () => {
    process.env.EXTRACTION_PROVIDER = "anthropic";
    process.env.ANALYSIS_PROVIDER = "gemini";

    expect(getExtractionProviderName()).toBe("anthropic");
    expect(getAnalysisProviderName()).toBe("gemini");
  });

  it("rejects an unknown provider name", () => {
    process.env.EXTRACTION_PROVIDER = "openai";

    expect(() => getExtractionProviderName()).toThrow(/Unknown EXTRACTION_PROVIDER/);
  });
});

describe("model selection", () => {
  it("defaults both models to gemini-3.5-flash", () => {
    delete process.env.EXTRACTION_MODEL;
    delete process.env.ANALYSIS_MODEL;

    expect(getExtractionModel()).toBe("gemini-3.5-flash");
    expect(getAnalysisModel()).toBe("gemini-3.5-flash");
  });

  it("uses the env override when set", () => {
    process.env.EXTRACTION_MODEL = "gemini-3.5-flash-lite";
    process.env.ANALYSIS_MODEL = "claude-haiku-4-5";

    expect(getExtractionModel()).toBe("gemini-3.5-flash-lite");
    expect(getAnalysisModel()).toBe("claude-haiku-4-5");
  });
});

describe("credentials", () => {
  it("throws a clear error when a required key is missing", () => {
    delete process.env.GEMINI_API_KEY;
    expect(() => getGeminiApiKey()).toThrow(/Missing required env var GEMINI_API_KEY/);
  });

  it("returns the key when set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    expect(getAnthropicApiKey()).toBe("sk-ant-test");
  });
});
