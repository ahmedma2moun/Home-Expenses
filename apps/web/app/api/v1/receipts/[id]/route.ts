import { withApi } from "@/lib/api/withApi";
import { discardReceipt, getReceipt } from "@/lib/services/receipts";

export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(req: Request, { params }: RouteParams) {
  const { id } = await params;
  return withApi(req, ({ userId }) => getReceipt(userId, id));
}

export async function DELETE(req: Request, { params }: RouteParams) {
  const { id } = await params;
  return withApi(req, async ({ userId }) => {
    await discardReceipt(userId, id);
    return { id, discarded: true };
  });
}
