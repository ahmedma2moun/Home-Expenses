import { withApi } from "@/lib/api/withApi";
import { PriceWatchQuerySchema } from "@/lib/api/schemas/analytics";
import { parseMonthLabel } from "@/lib/services/period";
import { getPriceWatchItems } from "@/lib/services/priceHistory";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return withApi(req, ({ userId }) => {
    const url = new URL(req.url);
    const query = PriceWatchQuerySchema.parse({ month: url.searchParams.get("month") ?? "" });
    return getPriceWatchItems(userId, parseMonthLabel(query.month));
  });
}
