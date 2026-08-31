import { afterEach, describe, expect, it, vi } from "vitest";
import { DEV_USER_ID } from "@/lib/api/devUser";
import { GET, PUT } from "./route";

const getBudgetSummary = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const upsertBudgets = vi.fn<(...args: unknown[]) => Promise<unknown>>();
vi.mock("@/lib/services/budgets", () => ({
  getBudgetSummary: (...args: unknown[]) => getBudgetSummary(...args),
  upsertBudgets: (...args: unknown[]) => upsertBudgets(...args),
}));

const routeParams = { params: Promise.resolve({ month: "2026-07" }) };
const JULY = new Date(Date.UTC(2026, 6, 1));
const emptyBudget = {
  weeks: [],
  protein: { budgetAmount: null, spentAmount: "0.00", remaining: null },
  month: { budgetAmount: null, spentAmount: "0.00", remaining: null },
};

function plainRequest(): Request {
  return new Request("https://example.com/api/v1/budgets/2026-07", { method: "GET" });
}

function putRequest(body: unknown): Request {
  return new Request("https://example.com/api/v1/budgets/2026-07", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/v1/budgets/:month", () => {
  it("envelopes the budget summary for the parsed month", async () => {
    getBudgetSummary.mockResolvedValue(emptyBudget);

    const res = await GET(plainRequest(), routeParams);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ data: emptyBudget });
    expect(getBudgetSummary).toHaveBeenCalledWith(DEV_USER_ID, JULY);
  });

  it("rejects a malformed month with a 400 rather than querying", async () => {
    const res = await GET(plainRequest(), { params: Promise.resolve({ month: "july" }) });

    expect(res.status).toBe(400);
    expect(getBudgetSummary).not.toHaveBeenCalled();
  });
});

describe("PUT /api/v1/budgets/:month", () => {
  it("hands the validated body to the service and returns the refreshed summary", async () => {
    upsertBudgets.mockResolvedValue(undefined);
    getBudgetSummary.mockResolvedValue(emptyBudget);

    const body = { weeks: [{ week: 1, amount: "600.00" }], protein: "350.00" };
    const res = await PUT(putRequest(body), routeParams);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ data: emptyBudget });
    expect(upsertBudgets).toHaveBeenCalledWith(DEV_USER_ID, JULY, body);
    expect(getBudgetSummary).toHaveBeenCalledWith(DEV_USER_ID, JULY);
  });

  it("rejects a body with neither weeks nor protein", async () => {
    const res = await PUT(putRequest({}), routeParams);

    expect(res.status).toBe(400);
    expect(upsertBudgets).not.toHaveBeenCalled();
  });

  it("rejects a week number outside 1-5", async () => {
    const res = await PUT(putRequest({ weeks: [{ week: 6, amount: "100.00" }] }), routeParams);

    expect(res.status).toBe(400);
    expect(upsertBudgets).not.toHaveBeenCalled();
  });
});
