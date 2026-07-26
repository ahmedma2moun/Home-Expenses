import { afterEach, describe, expect, it, vi } from "vitest";

interface FakePart {
  text?: string;
  inlineData?: { data: string; mimeType: string };
}

interface FakeGenerateParams {
  contents: FakePart[];
}

interface FakeGenerateResponse {
  text: string | undefined;
  usageMetadata: { promptTokenCount: number; candidatesTokenCount: number } | undefined;
}

const generateContent = vi.fn<(params: FakeGenerateParams) => Promise<FakeGenerateResponse>>();

vi.mock("@google/genai", () => {
  class FakeApiError extends Error {
    status: number;
    constructor(status: number) {
      super("gemini error");
      this.status = status;
    }
  }
  class FakeGoogleGenAI {
    models = { generateContent };
  }
  return { GoogleGenAI: FakeGoogleGenAI, ApiError: FakeApiError };
});

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

function fakeResponse(text: string): FakeGenerateResponse {
  return { text, usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 8 } };
}

describe("GeminiProvider", () => {
  it("extract() sends images in position order followed by the prompt, and maps the result", async () => {
    process.env.GEMINI_API_KEY = "AIza-test";
    generateContent.mockResolvedValue(fakeResponse("parsed json"));
    const { GeminiProvider } = await import("./provider");
    const provider = new GeminiProvider("gemini-3.5-flash");

    const result = await provider.extract({
      images: [
        { base64: "b64-second", mediaType: "image/jpeg", position: 2 },
        { base64: "b64-first", mediaType: "image/jpeg", position: 1 },
      ],
      systemPrompt: "extract this",
    });

    expect(typeof result.latencyMs).toBe("number");
    expect(result).toMatchObject({
      model: "gemini-3.5-flash",
      inputTokens: 20,
      outputTokens: 8,
      text: "parsed json",
    });

    const call = generateContent.mock.calls[0];
    if (!call) throw new Error("expected generateContent to have been called");
    const sentContents = call[0].contents;
    expect(sentContents[0]?.inlineData?.data).toBe("b64-first");
    expect(sentContents[1]?.inlineData?.data).toBe("b64-second");
    expect(sentContents[2]).toEqual({ text: "extract this" });
  });

  it("compare() sends a text-only prompt plus the diff JSON", async () => {
    process.env.GEMINI_API_KEY = "AIza-test";
    generateContent.mockResolvedValue(fakeResponse("narrative"));
    const { GeminiProvider } = await import("./provider");
    const provider = new GeminiProvider("gemini-3.5-flash");

    const result = await provider.compare({
      diffJson: '{"total":"1.00"}',
      systemPrompt: "compare this",
    });

    expect(result.text).toBe("narrative");
    const call = generateContent.mock.calls[0];
    if (!call) throw new Error("expected generateContent to have been called");
    expect(call[0].contents).toEqual([{ text: 'compare this\n\n{"total":"1.00"}' }]);
  });

  it("falls back to empty text and omits token counts when usage metadata is absent", async () => {
    process.env.GEMINI_API_KEY = "AIza-test";
    generateContent.mockResolvedValue({ text: undefined, usageMetadata: undefined });
    const { GeminiProvider } = await import("./provider");
    const provider = new GeminiProvider("gemini-3.5-flash");

    const result = await provider.compare({ diffJson: "{}", systemPrompt: "x" });

    expect(result.text).toBe("");
    expect(result).not.toHaveProperty("inputTokens");
    expect(result).not.toHaveProperty("outputTokens");
  });
});
