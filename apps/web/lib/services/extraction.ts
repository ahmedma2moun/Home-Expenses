import { z } from "zod";
import { getExtractionProvider } from "@/lib/ai";
import type { ReceiptImageInput } from "@/lib/ai/types";
import { moneySchema } from "@/lib/api/schemas/common";
import { EXTRACTION_SYSTEM_PROMPT_V1, buildCorrectionPrompt } from "@/lib/services/prompts";

/** Models sometimes return a bare number for money fields despite the prompt — normalize before
 * the strict "12.34" check so a merely-unformatted (but otherwise correct) answer isn't bounced
 * into a wasted retry. */
const moneyFromModelSchema = z.preprocess((value) => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toFixed(2);
  }
  if (typeof value === "string" && value.trim() !== "") {
    const num = Number(value);
    if (Number.isFinite(num)) {
      return num.toFixed(2);
    }
  }
  return value;
}, moneySchema.nullable());

const confidenceSchema = z.coerce.number().min(0).max(1).nullable().optional();

const ParsedReceiptItemSchema = z.object({
  name: z.string().min(1),
  quantity: z.coerce.number().positive().nullable().default(1),
  unit: z.string().nullable().optional(),
  unitPrice: moneyFromModelSchema,
  lineTotal: moneyFromModelSchema,
  category: z.string().min(1),
  confidence: confidenceSchema,
});

export const ParsedReceiptSchema = z.object({
  isReceipt: z.boolean(),
  merchant: z.string().nullable().optional(),
  purchasedAt: z.string().nullable().optional(),
  currency: z.string().nullable().optional(),
  items: z.array(ParsedReceiptItemSchema).default([]),
  subtotal: moneyFromModelSchema,
  tax: moneyFromModelSchema,
  discount: moneyFromModelSchema,
  total: moneyFromModelSchema,
  warnings: z.array(z.string()).default([]),
  overallConfidence: confidenceSchema,
});
export type ParsedReceipt = z.infer<typeof ParsedReceiptSchema>;
export type ParsedReceiptItem = z.infer<typeof ParsedReceiptItemSchema>;

export interface ExtractionOutcome {
  result: ParsedReceipt;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
}

function extractJson(text: string): unknown {
  // Models sometimes wrap JSON in prose or fences despite instructions — grab the outermost object.
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Response did not contain a JSON object.");
  }
  return JSON.parse(text.slice(start, end + 1)) as unknown;
}

type ParseAttempt = { success: true; data: ParsedReceipt } | { success: false; error: string };

function tryParse(text: string): ParseAttempt {
  try {
    const data = ParsedReceiptSchema.parse(extractJson(text));
    return { success: true, data };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown validation error.";
    return { success: false, error: message };
  }
}

/** Vision call + Zod validation with one correction retry (PROJECT_SPEC.md §7.2). */
export async function extractReceipt(images: ReceiptImageInput[]): Promise<ExtractionOutcome> {
  const provider = getExtractionProvider();

  const first = await provider.extract({ images, systemPrompt: EXTRACTION_SYSTEM_PROMPT_V1 });
  const firstAttempt = tryParse(first.text);
  if (firstAttempt.success) {
    return {
      result: firstAttempt.data,
      model: first.model,
      ...(first.inputTokens !== undefined && { inputTokens: first.inputTokens }),
      ...(first.outputTokens !== undefined && { outputTokens: first.outputTokens }),
      latencyMs: first.latencyMs,
    };
  }

  const retry = await provider.extract({
    images,
    systemPrompt: buildCorrectionPrompt(first.text, firstAttempt.error),
  });
  const retryAttempt = tryParse(retry.text);
  if (!retryAttempt.success) {
    throw new Error(`Extraction failed validation twice: ${retryAttempt.error}`);
  }

  return {
    result: retryAttempt.data,
    model: retry.model,
    ...(retry.inputTokens !== undefined && { inputTokens: retry.inputTokens }),
    ...(retry.outputTokens !== undefined && { outputTokens: retry.outputTokens }),
    latencyMs: first.latencyMs + retry.latencyMs,
  };
}
