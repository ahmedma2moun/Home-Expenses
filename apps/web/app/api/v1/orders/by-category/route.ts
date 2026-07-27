import { withApi } from "@/lib/api/withApi";
import { OrderItemsByCategoryQuerySchema } from "@/lib/api/schemas/orders";
import { listOrderItemsByCategory } from "@/lib/services/orderManagement";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return withApi(req, ({ userId }) => {
    const params = new URL(req.url).searchParams;
    const query = OrderItemsByCategoryQuerySchema.parse({
      month: params.get("month") ?? undefined,
      categoryId: params.get("categoryId") ?? undefined,
    });
    return listOrderItemsByCategory(userId, query);
  });
}
