import { afterEach, describe, expect, it } from "vitest";
import { AppError } from "@/lib/api/envelope";
import { requireDebugToken } from "@/lib/api/debugToken";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function requestWithToken(token: string | undefined): Request {
  const headers = new Headers();
  if (token !== undefined) headers.set("x-debug-token", token);
  return new Request("https://example.com/api/v1/echo", { headers });
}

describe("requireDebugToken", () => {
  it("throws NOT_IMPLEMENTED when DEBUG_API_TOKEN is not configured", () => {
    delete process.env.DEBUG_API_TOKEN;
    expect(() => {
      requireDebugToken(requestWithToken("anything"));
    }).toThrow(AppError);
    try {
      requireDebugToken(requestWithToken("anything"));
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("NOT_IMPLEMENTED");
    }
  });

  it("throws UNAUTHENTICATED when the header is missing", () => {
    process.env.DEBUG_API_TOKEN = "secret";
    expect(() => {
      requireDebugToken(requestWithToken(undefined));
    }).toThrow(AppError);
  });

  it("throws UNAUTHENTICATED when the header doesn't match", () => {
    process.env.DEBUG_API_TOKEN = "secret";
    expect(() => {
      requireDebugToken(requestWithToken("wrong"));
    }).toThrow(AppError);
  });

  it("passes when the header matches", () => {
    process.env.DEBUG_API_TOKEN = "secret";
    expect(() => {
      requireDebugToken(requestWithToken("secret"));
    }).not.toThrow();
  });
});
