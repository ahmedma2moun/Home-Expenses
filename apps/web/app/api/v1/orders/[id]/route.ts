import { withApi } from "@/lib/api/withApi";
import { OrderIdParamSchema, OrderUpdateRequestSchema } from "@/lib/api/schemas/orders";
import { getOrder } from "@/lib/services/orderQueries";
import { deleteOrder, updateOrder } from "@/lib/services/orderManagement";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(req: Request, { params }: RouteParams) {
  const raw = await params;
  return withApi(req, ({ userId }) => {
    const { id } = OrderIdParamSchema.parse(raw);
    return getOrder(userId, id);
  });
}

export async function PATCH(req: Request, { params }: RouteParams) {
  const raw = await params;
  return withApi(req, ({ body, userId }) => {
    const { id } = OrderIdParamSchema.parse(raw);
    const input = OrderUpdateRequestSchema.parse(body);
    return updateOrder(userId, id, input);
  });
}

export async function DELETE(req: Request, { params }: RouteParams) {
  const raw = await params;
  return withApi(req, ({ userId }) => {
    const { id } = OrderIdParamSchema.parse(raw);
    return deleteOrder(userId, id);
  });
}
