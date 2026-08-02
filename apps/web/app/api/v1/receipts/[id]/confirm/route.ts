import { withApi } from "@/lib/api/withApi";
import { ConfirmReceiptRequestSchema, ReceiptIdParamSchema } from "@/lib/api/schemas/receipts";
import { confirmReceipt } from "@/lib/services/orders";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, { params }: RouteParams) {
  const raw = await params;
  return withApi(req, async ({ body, userId }) => {
    const { id } = ReceiptIdParamSchema.parse(raw);
    const input = ConfirmReceiptRequestSchema.parse(body);
    return confirmReceipt(userId, id, input);
  });
}
