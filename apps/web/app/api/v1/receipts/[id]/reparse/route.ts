import { after } from "next/server";
import { withApi } from "@/lib/api/withApi";
import { reparseReceipt, runExtraction } from "@/lib/services/receipts";

export const runtime = "nodejs";
export const maxDuration = 120;

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, { params }: RouteParams) {
  const { id } = await params;
  return withApi(req, async ({ userId, setStatus }) => {
    const receipt = await reparseReceipt(userId, id);
    after(() => runExtraction(receipt.id));
    setStatus(202);
    return receipt;
  });
}
