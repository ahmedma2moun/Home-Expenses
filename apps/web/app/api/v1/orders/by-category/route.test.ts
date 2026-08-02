import { afterEach, describe, expect, it, vi } from "vitest";
import { DEV_USER_ID } from "@/lib/api/devUser";
import { GET } from "./route";

const listOrderItemsByCategory = vi.fn<(...args: unknown[]) => Promise<unknown>>();
vi.mock("@/lib/services/orderQueries", () => ({
  listOrderItemsByCategory: (...args: unknown[]) => listOrderItemsByCategory(...args),
}));

function request(query: string): Request {
  return new Request(`https://example.com/api/v1/orders/by-category${query}`);
}

const emptyPage = { month: "2026-07", categoryId: "dairy_eggs", orders: [] };

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/v1/orders/by-category", () => {
  it("passes the query string through to the service and envelopes the page", async () => {
    listOrderItemsByCategory.mockResolvedValue(emptyPage);

    const res = await GET(request("?month=2026-07&categoryId=dairy_eggs"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ data: emptyPage });
    expect(listOrderItemsByCategory).toHaveBeenCalledWith(DEV_USER_ID, {
      month: "2026-07",
      categoryId: "dairy_eggs",
    });
  });

  it("rejects a missing month with a 400 rather than querying", async () => {
    const res = await GET(request("?categoryId=dairy_eggs"));

    expect(res.status).toBe(400);
    expect(listOrderItemsByCategory).not.toHaveBeenCalled();
  });

  it("rejects an unknown category slug with a 400 rather than querying", async () => {
    const res = await GET(request("?month=2026-07&categoryId=not-a-category"));

    expect(res.status).toBe(400);
    expect(listOrderItemsByCategory).not.toHaveBeenCalled();
  });
});
