import { describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/api/envelope";

const compare = vi.fn();

vi.mock("@/lib/ai", () => ({
  getAnalysisProvider: () => ({ compare }),
}));

vi.mock("@/lib/ai/config", () => ({
  getAnalysisProviderName: () => "gemini",
}));

describe("askEcho", () => {
  it("round-trips the question through the configured provider and maps the result", async () => {
    compare.mockResolvedValue({
      text: "4",
      model: "gemini-2.5-flash",
      latencyMs: 123,
      inputTokens: 5,
      outputTokens: 1,
    });
    const { askEcho } = await import("./echo");

    const result = await askEcho("What is 2+2?");

    expect(result).toEqual({
      answer: "4",
      provider: "gemini",
      model: "gemini-2.5-flash",
      latencyMs: 123,
      inputTokens: 5,
      outputTokens: 1,
    });
    expect(compare).toHaveBeenCalledWith({ systemPrompt: "What is 2+2?", diffJson: "" });
  });

  it("omits token counts when the provider doesn't report them", async () => {
    compare.mockResolvedValue({ text: "ok", model: "local-model", latencyMs: 50 });
    const { askEcho } = await import("./echo");

    const result = await askEcho("ping");

    expect(result).not.toHaveProperty("inputTokens");
    expect(result).not.toHaveProperty("outputTokens");
  });

  it("wraps a provider failure in a 502 AppError with the real message", async () => {
    compare.mockRejectedValue(new Error("API key not valid"));
    const { askEcho } = await import("./echo");

    await expect(askEcho("hi")).rejects.toMatchObject({
      httpStatus: 502,
      message: "AI provider call failed: API key not valid",
    });
  });

  it("wraps a non-Error rejection with a generic message", async () => {
    compare.mockRejectedValue("some string throw");
    const { askEcho } = await import("./echo");

    await expect(askEcho("hi")).rejects.toBeInstanceOf(AppError);
    await expect(askEcho("hi")).rejects.toMatchObject({
      message: "AI provider call failed: Unknown provider error.",
    });
  });
});
