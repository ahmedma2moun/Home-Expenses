import { stubRoute } from "@/lib/api/stub";

export const runtime = "nodejs";

export const POST = stubRoute("POST /api/v1/receipts/:id/reparse");
