import { withApi } from "@/lib/api/withApi";
import { listCategories } from "@/lib/services/categories";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return withApi(req, () => listCategories());
}
