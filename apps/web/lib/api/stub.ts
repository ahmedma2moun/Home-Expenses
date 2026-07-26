import { withApi } from "@/lib/api/withApi";
import { notImplemented } from "@/lib/api/envelope";

/** M0 placeholder: every /api/v1 handler is wired (envelope) but returns 501 until its milestone. */
export function stubRoute(label: string) {
  return (req: Request) =>
    withApi(req, () => {
      throw notImplemented(`${label} is not implemented yet.`);
    });
}
