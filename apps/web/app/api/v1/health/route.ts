import { NextResponse } from "next/server";
import { getHealthReport } from "@/lib/services/health";

export const runtime = "nodejs";

export async function GET() {
  const report = await getHealthReport();
  return NextResponse.json({ data: report }, { status: report.status === "ok" ? 200 : 503 });
}
