import { withApi } from "@/lib/api/withApi";
import { TrendsQuerySchema, type TrendsQuery } from "@/lib/api/schemas/analytics";
import { getTrends } from "@/lib/services/analytics";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return withApi(req, ({ userId }) => {
    const url = new URL(req.url);
    const query: TrendsQuery = TrendsQuerySchema.parse({
      months: url.searchParams.get("months") ?? undefined,
    });
    return getTrends(userId, query.months);
  });
}
