import { withApi } from "@/lib/api/withApi";
import { ReceiptIdParamSchema } from "@/lib/api/schemas/receipts";
import { discardReceipt, getReceipt } from "@/lib/services/receipts";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(req: Request, { params }: RouteParams) {
  const raw = await params;
  return withApi(req, ({ userId }) => {
    const { id } = ReceiptIdParamSchema.parse(raw);
    return getReceipt(userId, id);
  });
}

export async function DELETE(req: Request, { params }: RouteParams) {
  const raw = await params;
  return withApi(req, async ({ userId }) => {
    const { id } = ReceiptIdParamSchema.parse(raw);
    await discardReceipt(userId, id);
    return { id, discarded: true };
  });
}
