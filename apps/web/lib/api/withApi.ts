import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { AppError, dataEnvelope, errorEnvelope, type ValidationDetails } from "@/lib/api/envelope";
import { DEV_USER_ID } from "@/lib/api/devUser";

interface HandlerContext {
  userId: string;
  requestId: string;
  req: Request;
  body: unknown;
  /** Override the default 200 response status, e.g. 202 for an async-parse receipt creation. */
  setStatus: (status: number) => void;
}

type Handler<T> = (ctx: HandlerContext) => Promise<T>;

const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);

export async function withApi<T>(req: Request, handler: Handler<T>): Promise<NextResponse> {
  const requestId = randomUUID();
  let status = 200;

  try {
    const body = BODY_METHODS.has(req.method) ? await parseJsonBody(req) : undefined;

    const data = await handler({
      userId: DEV_USER_ID,
      requestId,
      req,
      body,
      setStatus: (next) => {
        status = next;
      },
    });
    return NextResponse.json(dataEnvelope(data), { status });
  } catch (error) {
    return mapError(error, requestId);
  }
}

async function parseJsonBody(req: Request): Promise<unknown> {
  const text = await req.text();
  if (text.trim() === "") {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AppError("VALIDATION_ERROR", "Request body must be valid JSON.", 400);
  }
}

function mapError(error: unknown, requestId: string): NextResponse {
  const appError = toAppError(error);

  // The underlying error message/stack is operational detail (never receipt PII — that's covered
  // by CLAUDE.md rule 6 and enforced by never logging parsedPayload/item/merchant fields anywhere)
  // and is essential for diagnosing a 500 from the Vercel runtime logs.
  console.error("api_error", {
    requestId,
    code: appError.code,
    httpStatus: appError.httpStatus,
    cause:
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : error,
  });

  return NextResponse.json(errorEnvelope(appError), { status: appError.httpStatus });
}

function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }
  if (error instanceof ZodError) {
    const details: ValidationDetails = {
      issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    };
    return new AppError("VALIDATION_ERROR", "Request failed validation.", 400, details);
  }
  return new AppError("INTERNAL_ERROR", "Something went wrong.", 500);
}
