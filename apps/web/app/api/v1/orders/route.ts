import { stubRoute } from "@/lib/api/stub";

export const runtime = "nodejs";

export const GET = stubRoute("GET /api/v1/orders");
export const POST = stubRoute("POST /api/v1/orders");
