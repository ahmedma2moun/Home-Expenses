import { AppError } from "@/lib/api/envelope";

const HEADER = "x-debug-token";

/**
 * Gate for diagnostic-only endpoints (e.g. /echo) that make a real, billable AI provider call.
 * Fails closed: if DEBUG_API_TOKEN isn't configured, the endpoint is unreachable, not open.
 */
export function requireDebugToken(req: Request): void {
  const configured = process.env.DEBUG_API_TOKEN;
  if (!configured) {
    throw new AppError("NOT_IMPLEMENTED", "DEBUG_API_TOKEN is not configured.", 501);
  }
  if (req.headers.get(HEADER) !== configured) {
    throw new AppError("UNAUTHENTICATED", `Missing or invalid ${HEADER} header.`, 401);
  }
}
