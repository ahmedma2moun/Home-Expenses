import { z } from "zod";

export const EchoRequestSchema = z.object({
  question: z.string().min(1).max(2000),
});
export type EchoRequest = z.infer<typeof EchoRequestSchema>;
