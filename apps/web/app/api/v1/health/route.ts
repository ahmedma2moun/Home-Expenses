import { withApi } from "@/lib/api/withApi";
import { getHealthReport } from "@/lib/services/health";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return withApi(req, async ({ setStatus }) => {
    const report = await getHealthReport();
    if (report.status !== "ok") {
      setStatus(503);
    }
    return report;
  });
}
