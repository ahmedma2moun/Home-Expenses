import { withApi } from "@/lib/api/withApi";
import { stubRoute } from "@/lib/api/stub";
import { OrderListQuerySchema } from "@/lib/api/schemas/orders";
import { listOrders } from "@/lib/services/orderQueries";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return withApi(req, ({ userId }) => {
    const params = new URL(req.url).searchParams;
    const query = OrderListQuerySchema.parse({
      month: params.get("month") ?? undefined,
      cursor: params.get("cursor") ?? undefined,
      limit: params.get("limit") ?? undefined,
    });
    return listOrders(userId, query);
  });
}

export const POST = stubRoute("POST /api/v1/orders");
