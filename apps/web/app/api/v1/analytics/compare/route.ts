import { withApi } from "@/lib/api/withApi";
import { CompareRequestSchema } from "@/lib/api/schemas/analytics";
import { compareMonths } from "@/lib/services/monthComparison";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  return withApi(req, async ({ userId, body, requestId }) => {
    const input = CompareRequestSchema.parse(body);
    return compareMonths(userId, input, requestId);
  });
}
