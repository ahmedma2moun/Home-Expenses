import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { AppError, dataEnvelope, errorEnvelope } from "@/lib/api/envelope";
import { getUserId } from "@/lib/auth/session";

interface HandlerContext {
  userId: string;
  requestId: string;
  req: Request;
  body: unknown;
}

type Handler<T> = (ctx: HandlerContext) => Promise<T>;

interface WithApiOptions {
  /** Set false for public routes (auth exchange, health). Defaults to true. */
  auth?: boolean;
}

const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);

export async function withApi<T>(
  req: Request,
  handler: Handler<T>,
  options: WithApiOptions = {},
): Promise<NextResponse> {
  const requestId = randomUUID();
  const requireAuth = options.auth ?? true;

  try {
    const userId = requireAuth ? await getUserId(req) : "";
    const body = BODY_METHODS.has(req.method) ? await parseJsonBody(req) : undefined;

    const data = await handler({ userId, requestId, req, body });
    return NextResponse.json(dataEnvelope(data), { status: 200 });
  } catch (error) {
    return mapError(error, requestId);
  }
}

async function parseJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new AppError("VALIDATION_ERROR", "Request body must be valid JSON.", 400);
  }
}

function mapError(error: unknown, requestId: string): NextResponse {
  const appError =
    error instanceof AppError
      ? error
      : new AppError("INTERNAL_ERROR", "Something went wrong.", 500);

  console.error("api_error", { requestId, code: appError.code, httpStatus: appError.httpStatus });

  return NextResponse.json(errorEnvelope(appError), { status: appError.httpStatus });
}
