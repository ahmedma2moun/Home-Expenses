import { AppError } from "@/lib/api/envelope";
import { verifyAccessToken } from "@/lib/auth/jwt";

export async function getUserId(req: Request): Promise<string> {
  const header = req.headers.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  if (!token) {
    throw new AppError("UNAUTHENTICATED", "Missing bearer token.", 401);
  }

  try {
    const { userId } = await verifyAccessToken(token);
    return userId;
  } catch {
    throw new AppError("UNAUTHENTICATED", "Invalid or expired token.", 401);
  }
}
