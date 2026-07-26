import { stubRoute } from "@/lib/api/stub";

export const runtime = "nodejs";
export const maxDuration = 30;

export const POST = stubRoute("POST /api/v1/analytics/compare");
