import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Prisma } from "@/lib/db/prisma";
import { withApi } from "./withApi";
import { AppError } from "./envelope";
import { DEV_USER_ID } from "./devUser";

function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("simulated", { code, clientVersion: "test" });
}

function jsonRequest(body: unknown, init: RequestInit = {}): Request {
  return new Request("https://example.com/api/v1/thing", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    ...init,
  });
}

describe("withApi", () => {
  it("wraps a successful handler result in the data envelope", async () => {
    const req = jsonRequest({ ok: true });
    const res = await withApi(req, async () => ({ hello: "world" }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ data: { hello: "world" } });
  });

  it("resolves userId to the seeded dev user (no auth flow yet)", async () => {
    const req = jsonRequest({});
    const res = await withApi(req, async ({ userId }) => ({ userId }));

    await expect(res.json()).resolves.toEqual({ data: { userId: DEV_USER_ID } });
  });

  it("maps an AppError to its own code and status", async () => {
    const req = jsonRequest({});
    const res = await withApi(req, async () => {
      throw new AppError("NOT_FOUND", "nope", 404);
    });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: { code: "NOT_FOUND", message: "nope" } });
  });

  it("maps a ZodError to a 400 VALIDATION_ERROR with issue details", async () => {
    const schema = z.object({ question: z.string().min(1) });
    const req = jsonRequest({ question: "" });

    const res = await withApi(req, async ({ body }) => schema.parse(body));

    expect(res.status).toBe(400);
    const payload = (await res.json()) as {
      error: { code: string; details?: { issues: { path: string; message: string }[] } };
    };
    expect(payload.error.code).toBe("VALIDATION_ERROR");
    const issues = payload.error.details?.issues ?? [];
    expect(issues).toEqual([{ path: "question", message: issues[0]?.message }]);
    expect(typeof issues[0]?.message).toBe("string");
  });

  it("maps an unknown thrown value to a generic 500 INTERNAL_ERROR", async () => {
    const req = jsonRequest({});
    const res = await withApi(req, async () => {
      throw new Error("boom");
    });

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: { code: "INTERNAL_ERROR", message: "Something went wrong." },
    });
  });

  it("maps a Prisma unique-constraint violation (P2002) to a 400 VALIDATION_ERROR", async () => {
    const req = jsonRequest({});
    const res = await withApi(req, async () => {
      throw prismaError("P2002");
    });

    expect(res.status).toBe(400);
    const payload = (await res.json()) as { error: { code: string } };
    expect(payload.error.code).toBe("VALIDATION_ERROR");
  });

  it("maps a Prisma foreign-key violation (P2003) to a 400 VALIDATION_ERROR", async () => {
    const req = jsonRequest({});
    const res = await withApi(req, async () => {
      throw prismaError("P2003");
    });

    expect(res.status).toBe(400);
  });

  it("maps a Prisma record-not-found error (P2025) to a 404 NOT_FOUND", async () => {
    const req = jsonRequest({});
    const res = await withApi(req, async () => {
      throw prismaError("P2025");
    });

    expect(res.status).toBe(404);
    const payload = (await res.json()) as { error: { code: string } };
    expect(payload.error.code).toBe("NOT_FOUND");
  });

  it("maps an unrecognized Prisma error code to a generic 500", async () => {
    const req = jsonRequest({});
    const res = await withApi(req, async () => {
      throw prismaError("P9999");
    });

    expect(res.status).toBe(500);
  });

  it("returns 400 when the body isn't valid JSON", async () => {
    const req = new Request("https://example.com/api/v1/thing", {
      method: "POST",
      body: "not json",
    });
    const res = await withApi(req, async () => ({ never: true }));

    expect(res.status).toBe(400);
  });
});
