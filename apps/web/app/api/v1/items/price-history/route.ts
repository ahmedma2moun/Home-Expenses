import { withApi } from "@/lib/api/withApi";
import { ItemPriceHistoryQuerySchema } from "@/lib/api/schemas/items";
import { getItemPriceHistory } from "@/lib/services/priceHistory";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return withApi(req, ({ userId }) => {
    const url = new URL(req.url);
    const query = ItemPriceHistoryQuerySchema.parse({ name: url.searchParams.get("name") ?? "" });
    return getItemPriceHistory(userId, query.name);
  });
}
