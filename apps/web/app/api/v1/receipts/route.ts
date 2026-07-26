import { after } from "next/server";
import { withApi } from "@/lib/api/withApi";
import { ReceiptCreateRequestSchema } from "@/lib/api/schemas/receipts";
import { createReceipt, runExtraction } from "@/lib/services/receipts";

export const runtime = "nodejs";
// Extraction runs in `after()` within this same invocation — must cover a vision call plus one
// correction retry (each with its own timeout, see lib/ai/retry.ts). Confirm against your Vercel
// plan's function-duration ceiling (PROJECT_SPEC.md §9).
export const maxDuration = 120;

export async function POST(req: Request) {
  return withApi(req, async ({ body, userId, setStatus }) => {
    const input = ReceiptCreateRequestSchema.parse(body);
    const receipt = await createReceipt(userId, input);

    if (receipt.status === "PARSING") {
      after(() => runExtraction(receipt.id));
    }

    setStatus(202);
    return receipt;
  });
}
