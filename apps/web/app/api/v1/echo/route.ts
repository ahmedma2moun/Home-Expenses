import { withApi } from "@/lib/api/withApi";
import { requireDebugToken } from "@/lib/api/debugToken";
import { EchoRequestSchema } from "@/lib/api/schemas/echo";
import { askEcho } from "@/lib/services/echo";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Deploy smoke test — not part of the product API. Sends a question to the configured AI
 * provider and returns the answer, so you can confirm the deployed backend can actually reach
 * Gemini/Claude (not just that the env var is set, which /health only checks). Gated by
 * DEBUG_API_TOKEN, not user auth, since /auth/apple may not be wired up yet when you need this.
 */
export async function POST(req: Request) {
  return withApi(
    req,
    async ({ body }) => {
      requireDebugToken(req);
      const input = EchoRequestSchema.parse(body);
      return askEcho(input.question);
    },
    { auth: false },
  );
}
