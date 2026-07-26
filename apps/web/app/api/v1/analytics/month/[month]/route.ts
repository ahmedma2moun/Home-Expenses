import { withApi } from "@/lib/api/withApi";
import { monthLabelSchema } from "@/lib/api/schemas/common";
import { parseMonthLabel } from "@/lib/services/period";
import { getMonthSummary } from "@/lib/services/analytics";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ month: string }>;
}

export async function GET(req: Request, { params }: RouteParams) {
  const { month } = await params;
  return withApi(req, ({ userId }) => {
    const periodMonth = parseMonthLabel(monthLabelSchema.parse(month));
    return getMonthSummary(userId, periodMonth);
  });
}
