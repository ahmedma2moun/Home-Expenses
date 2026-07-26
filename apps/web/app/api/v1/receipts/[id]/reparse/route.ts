import { after } from "next/server";
import { withApi } from "@/lib/api/withApi";
import { ReparseRequestSchema } from "@/lib/api/schemas/receipts";
import { reparseReceipt, runExtraction } from "@/lib/services/receipts";

export const runtime = "nodejs";
export const maxDuration = 120;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, { params }: RouteParams) {
  const { id } = await params;
  return withApi(req, async ({ body, userId, setStatus }) => {
    // No blob storage — the server never retained the original images, so a retry needs them
    // resent, same as the initial POST /receipts call.
    const input = ReparseRequestSchema.parse(body);
    const receipt = await reparseReceipt(userId, id);
    after(() => runExtraction(receipt.id, input.images));
    setStatus(202);
    return receipt;
  });
}
