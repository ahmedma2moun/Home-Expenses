import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
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
  const appError = toAppError(error);

  console.error("api_error", { requestId, code: appError.code, httpStatus: appError.httpStatus });

  return NextResponse.json(errorEnvelope(appError), { status: appError.httpStatus });
}

function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }
  if (error instanceof ZodError) {
    return new AppError("VALIDATION_ERROR", "Request body failed validation.", 400, {
      issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    });
  }
  return new AppError("INTERNAL_ERROR", "Something went wrong.", 500);
}
