import { withApi } from "@/lib/api/withApi";
import { UploadTokenRequestSchema } from "@/lib/api/schemas/uploads";
import { createUploadTargets } from "@/lib/services/blob";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return withApi(req, async ({ body, userId }) => {
    const input = UploadTokenRequestSchema.parse(body);
    return { targets: await createUploadTargets(userId, input) };
  });
}
