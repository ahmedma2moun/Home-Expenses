import { stubRoute } from "@/lib/api/stub";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = stubRoute("POST /api/v1/receipts/:id/reparse");
