import { afterEach, describe, expect, it, vi } from "vitest";
import { DEV_USER_ID } from "@/lib/api/devUser";
import { GET, POST } from "./route";

const listOrders = vi.fn<(...args: unknown[]) => Promise<unknown>>();
vi.mock("@/lib/services/orderManagement", () => ({
  listOrders: (...args: unknown[]) => listOrders(...args),
}));

function request(query: string): Request {
  return new Request(`https://example.com/api/v1/orders${query}`);
}

const emptyPage = { orders: [], nextCursor: null };

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/v1/orders", () => {
  it("passes the query string through to the service and envelopes the page", async () => {
    listOrders.mockResolvedValue(emptyPage);

    const res = await GET(request("?month=2026-07&cursor=order-1&limit=10"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ data: emptyPage });
    expect(listOrders).toHaveBeenCalledWith(DEV_USER_ID, {
      month: "2026-07",
      cursor: "order-1",
      limit: 10,
    });
  });

  it("defaults the page size and leaves the month unfiltered", async () => {
    listOrders.mockResolvedValue(emptyPage);

    await GET(request(""));

    expect(listOrders).toHaveBeenCalledWith(DEV_USER_ID, {
      month: undefined,
      cursor: undefined,
      limit: 50,
    });
  });

  it("rejects a malformed month with a 400 rather than querying", async () => {
    const res = await GET(request("?month=july"));

    expect(res.status).toBe(400);
    expect(listOrders).not.toHaveBeenCalled();
  });
});

// Manual order entry is still a stub — the screen this milestone adds only edits what a confirmed
// receipt already created.
describe("POST /api/v1/orders", () => {
  it("is still not implemented", async () => {
    const res = await POST(
      new Request("https://example.com/api/v1/orders", { method: "POST", body: "{}" }),
    );

    expect(res.status).toBe(501);
  });
});
