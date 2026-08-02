import { afterEach, describe, expect, it, vi } from "vitest";

interface FakeContentBlock {
  type: string;
  text?: string;
  source?: { data: string };
}

interface FakeCreateParams {
  messages: { role: string; content: FakeContentBlock[] }[];
}

interface FakeMessageResult {
  content: { type: string; text: string }[];
  usage: { input_tokens: number; output_tokens: number };
}

const create =
  vi.fn<(params: FakeCreateParams, options?: { timeout?: number }) => Promise<FakeMessageResult>>();

vi.mock("@anthropic-ai/sdk", () => {
  class FakeAPIError extends Error {
    status: number;
    constructor(status: number, _error: unknown, message: string) {
      super(message);
      this.status = status;
    }
  }
  class FakeAPIConnectionError extends FakeAPIError {
    constructor({ message = "Connection error." }: { message?: string; cause?: Error } = {}) {
      super(undefined as unknown as number, undefined, message);
    }
  }
  class FakeAPIConnectionTimeoutError extends FakeAPIConnectionError {
    constructor() {
      super({ message: "Request timed out." });
    }
  }
  class FakeAnthropic {
    messages = { create };
    constructor(public options: { apiKey: string; maxRetries?: number }) {}
  }
  return {
    default: FakeAnthropic,
    APIError: FakeAPIError,
    APIConnectionError: FakeAPIConnectionError,
    APIConnectionTimeoutError: FakeAPIConnectionTimeoutError,
  };
});

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

function fakeMessage(text: string): FakeMessageResult {
  return {
    content: [{ type: "text", text }],
    usage: { input_tokens: 12, output_tokens: 6 },
  };
}

describe("AnthropicProvider", () => {
  it("extract() sends images in position order followed by the prompt, and maps the result", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    create.mockResolvedValue(fakeMessage("parsed json"));
    const { AnthropicProvider } = await import("./provider");
    const provider = new AnthropicProvider("claude-sonnet-5");

    const result = await provider.extract({
      images: [
        { base64: "b64-second", mediaType: "image/jpeg", position: 2 },
        { base64: "b64-first", mediaType: "image/jpeg", position: 1 },
      ],
      systemPrompt: "extract this",
    });

    expect(typeof result.latencyMs).toBe("number");
    expect(result).toMatchObject({
      model: "claude-sonnet-5",
      inputTokens: 12,
      outputTokens: 6,
      text: "parsed json",
    });

    const call = create.mock.calls[0];
    if (!call) throw new Error("expected messages.create to have been called");
    const sentContent = call[0].messages[0]?.content ?? [];
    expect(sentContent[0]?.source?.data).toBe("b64-first");
    expect(sentContent[1]?.source?.data).toBe("b64-second");
    expect(sentContent[2]).toEqual({ type: "text", text: "extract this" });
  });

  it("compare() sends a text-only prompt plus the diff JSON", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    create.mockResolvedValue(fakeMessage("narrative"));
    const { AnthropicProvider } = await import("./provider");
    const provider = new AnthropicProvider("claude-sonnet-5");

    const result = await provider.compare({
      diffJson: '{"total":"1.00"}',
      systemPrompt: "compare this",
    });

    expect(result.text).toBe("narrative");
    const call = create.mock.calls[0];
    if (!call) throw new Error("expected messages.create to have been called");
    expect(call[0].messages[0]?.content).toEqual([
      { type: "text", text: 'compare this\n\n{"total":"1.00"}' },
    ]);
  });

  it("retries a dropped connection (no HTTP status) and succeeds on the next attempt", async () => {
    vi.useFakeTimers();
    try {
      process.env.ANTHROPIC_API_KEY = "sk-ant-test";
      const { APIConnectionError } = await import("@anthropic-ai/sdk");
      create
        .mockRejectedValueOnce(new APIConnectionError({}))
        .mockResolvedValueOnce(fakeMessage("ok"));
      const { AnthropicProvider } = await import("./provider");
      const provider = new AnthropicProvider("claude-sonnet-5");

      const promise = provider.extract({
        images: [{ base64: "b64", mediaType: "image/jpeg", position: 0 }],
        systemPrompt: "extract this",
      });
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.text).toBe("ok");
      expect(create).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
