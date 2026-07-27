import { withApi } from "@/lib/api/withApi";
import { OrderUpdateRequestSchema } from "@/lib/api/schemas/orders";
import { deleteOrder, getOrder, updateOrder } from "@/lib/services/orderManagement";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(req: Request, { params }: RouteParams) {
  const { id } = await params;
  return withApi(req, ({ userId }) => getOrder(userId, id));
}

export async function PATCH(req: Request, { params }: RouteParams) {
  const { id } = await params;
  return withApi(req, ({ body, userId }) => {
    const input = OrderUpdateRequestSchema.parse(body);
    return updateOrder(userId, id, input);
  });
}

export async function DELETE(req: Request, { params }: RouteParams) {
  const { id } = await params;
  return withApi(req, ({ userId }) => deleteOrder(userId, id));
}
