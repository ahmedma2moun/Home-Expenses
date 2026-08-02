import { withApi } from "@/lib/api/withApi";
import { PriceCheckRequestSchema } from "@/lib/api/schemas/items";
import { checkDraftItemPrices } from "@/lib/services/priceHistory";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return withApi(req, ({ body, userId }) => {
    const input = PriceCheckRequestSchema.parse(body);
    return checkDraftItemPrices(userId, input.merchant, input.items);
  });
}
