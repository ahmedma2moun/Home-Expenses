import { withApi } from "@/lib/api/withApi";
import { ConfirmReceiptRequestSchema } from "@/lib/api/schemas/receipts";
import { confirmReceipt } from "@/lib/services/orders";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, { params }: RouteParams) {
  const { id } = await params;
  return withApi(req, async ({ body, userId }) => {
    const input = ConfirmReceiptRequestSchema.parse(body);
    return confirmReceipt(userId, id, input);
  });
}
