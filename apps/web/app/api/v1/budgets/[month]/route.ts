import { withApi } from "@/lib/api/withApi";
import { monthLabelSchema } from "@/lib/api/schemas/common";
import { BudgetUpdateRequestSchema } from "@/lib/api/schemas/budgets";
import { parseMonthLabel } from "@/lib/services/period";
import { getBudgetSummary, upsertBudgets } from "@/lib/services/budgets";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ month: string }>;
}

/** Prefill for the Budgets screen — same shape as `GET /analytics/month/:month`'s `budget` field. */
export async function GET(req: Request, { params }: RouteParams) {
  const { month } = await params;
  return withApi(req, ({ userId }) => {
    const periodMonth = parseMonthLabel(monthLabelSchema.parse(month));
    return getBudgetSummary(userId, periodMonth);
  });
}

/** Sets some or all of a month's weekly budgets plus its protein budget, then returns the updated
 *  summary so the client sees the new remaining figures without a second round trip. */
export async function PUT(req: Request, { params }: RouteParams) {
  const { month } = await params;
  return withApi(req, async ({ body, userId }) => {
    const periodMonth = parseMonthLabel(monthLabelSchema.parse(month));
    const input = BudgetUpdateRequestSchema.parse(body);
    await upsertBudgets(userId, periodMonth, input);
    return getBudgetSummary(userId, periodMonth);
  });
}
