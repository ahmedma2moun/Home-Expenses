import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/api/envelope";
import { DEV_USER_ID } from "@/lib/api/devUser";
import { DELETE, GET, PATCH } from "./route";

const getOrder = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const updateOrder = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const deleteOrder = vi.fn<(...args: unknown[]) => Promise<unknown>>();
vi.mock("@/lib/services/orderManagement", () => ({
  getOrder: (...args: unknown[]) => getOrder(...args),
  updateOrder: (...args: unknown[]) => updateOrder(...args),
  deleteOrder: (...args: unknown[]) => deleteOrder(...args),
}));

const routeParams = { params: Promise.resolve({ id: "order-1" }) };

function patchRequest(body: unknown): Request {
  return new Request("https://example.com/api/v1/orders/order-1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function plainRequest(method: string): Request {
  return new Request("https://example.com/api/v1/orders/order-1", { method });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/v1/orders/:id", () => {
  it("envelopes the order", async () => {
    getOrder.mockResolvedValue({ id: "order-1" });

    const res = await GET(plainRequest("GET"), routeParams);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ data: { id: "order-1" } });
    expect(getOrder).toHaveBeenCalledWith(DEV_USER_ID, "order-1");
  });

  // Another user's order must be indistinguishable from one that never existed.
  it("passes the service's 404 through as NOT_FOUND", async () => {
    getOrder.mockRejectedValue(new AppError("NOT_FOUND", "Order not found.", 404));

    const res = await GET(plainRequest("GET"), routeParams);

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: { code: "NOT_FOUND", message: "Order not found." },
    });
  });
});

describe("PATCH /api/v1/orders/:id", () => {
  it("hands the validated body to the service", async () => {
    updateOrder.mockResolvedValue({ id: "order-1" });

    const res = await PATCH(patchRequest({ merchant: "Metro" }), routeParams);

    expect(res.status).toBe(200);
    expect(updateOrder).toHaveBeenCalledWith(DEV_USER_ID, "order-1", { merchant: "Metro" });
  });

  it("rejects an empty edit with a 400", async () => {
    const res = await PATCH(patchRequest({}), routeParams);

    expect(res.status).toBe(400);
    expect(updateOrder).not.toHaveBeenCalled();
  });

  // Money is a string on the wire (CLAUDE.md rule 1) — a number must never reach the service.
  it("rejects a numeric total with a field-level 400", async () => {
    const res = await PATCH(patchRequest({ total: 120 }), routeParams);

    expect(res.status).toBe(400);
    const payload = (await res.json()) as { error: { details?: { issues: { path: string }[] } } };
    expect(payload.error.details?.issues[0]?.path).toBe("total");
    expect(updateOrder).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/v1/orders/:id", () => {
  it("returns the deleted id", async () => {
    deleteOrder.mockResolvedValue({ id: "order-1" });

    const res = await DELETE(plainRequest("DELETE"), routeParams);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ data: { id: "order-1" } });
    expect(deleteOrder).toHaveBeenCalledWith(DEV_USER_ID, "order-1");
  });
});
