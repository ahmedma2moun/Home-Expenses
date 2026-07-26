import { stubRoute } from "@/lib/api/stub";

export const runtime = "nodejs";

export const GET = stubRoute("GET /api/v1/receipts/:id");
export const DELETE = stubRoute("DELETE /api/v1/receipts/:id");
