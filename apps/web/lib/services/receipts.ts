import { prisma, isUniqueConstraintViolation, type ReceiptStatus } from "@/lib/db/prisma";
import { AppError } from "@/lib/api/envelope";
import { extractReceipt, type ExtractionOutcome, type ParsedReceipt } from "@/lib/services/extraction";
import { coerceCategorySlug } from "@/lib/services/categoryTaxonomy";
import { DEFAULT_ON_DEVICE_MODEL } from "@/lib/api/schemas/receipts";
import type {
  ClientParsedReceipt,
  ReceiptCreateRequest,
  ReceiptImageInput,
} from "@/lib/api/schemas/receipts";

export interface ReceiptSummary {
  id: string;
  status: ReceiptStatus;
}

export interface CreateReceiptResult extends ReceiptSummary {
  /** False when `clientRef` already existed — the caller must not trigger extraction again: it
   *  either already ran or is already running, and a second run would be a second billable AI
   *  call racing the first one's writes. */
  created: boolean;
}

/** Unknown category slugs are coerced to `other` regardless of which path produced the payload —
 *  the cloud provider and the iOS on-device model (AI_PROVIDER.md §10) share this normalization.
 *  `ParsedReceipt` (cloud, lib/services/extraction.ts) and `ClientParsedReceipt` (on-device, this
 *  file's caller) are validated by different Zod schemas but produce the exact same TS shape, so a
 *  `ClientParsedReceipt` satisfies this parameter structurally — no cast needed. */
function normalizeParsedPayload(payload: ParsedReceipt): ParsedReceipt {
  return {
    ...payload,
    items: payload.items.map((item) => ({
      ...item,
      category: coerceCategorySlug(item.category),
    })),
  };
}

/** `null` when this is an ordinary cloud request — no vision call has run yet, so there's nothing
 *  to validate or store other than "PARSING". Throws if on_device mode is missing its payload: a
 *  belt-and-suspenders check, since `ReceiptCreateRequestSchema`'s `superRefine` already rejects
 *  this combination at the route boundary (rule 3) — this only guards a direct service call. */
function resolveOnDevicePayload(input: ReceiptCreateRequest): ClientParsedReceipt | null {
  if (input.extractionMode !== "on_device") {
    return null;
  }
  if (!input.clientParsedPayload) {
    throw new AppError(
      "VALIDATION_ERROR",
      "clientParsedPayload is required for on_device extraction.",
      400,
    );
  }
  return normalizeParsedPayload(input.clientParsedPayload);
}

/** The `Receipt.create` data fragment specific to an already-parsed on-device receipt — status,
 *  bookkeeping, and either `parsedPayload` or `parseError` depending on `isReceipt`, mirroring what
 *  `runExtraction` does for the cloud path once its vision call returns. */
function onDeviceCreateFields(input: ReceiptCreateRequest, payload: ClientParsedReceipt) {
  return {
    // `as const` on both branches, not just `satisfies` — otherwise the sibling `{ status:
    // "PARSING" }` branch at the call site widens the union back to plain `string` on merge.
    status: payload.isReceipt ? ("PARSED" as const) : ("FAILED" as const),
    parseAttempts: 1,
    model: input.clientModel ?? DEFAULT_ON_DEVICE_MODEL,
    latencyMs: input.clientLatencyMs ?? null,
    // Key omitted entirely (not set to `undefined`) when not a receipt — Prisma's `Json?` input
    // type rejects an explicit `undefined` under this project's `exactOptionalPropertyTypes`.
    ...(payload.isReceipt
      ? { parsedPayload: payload, parseError: null }
      : { parseError: "These images don't look like a receipt." }),
  };
}

export async function createReceipt(
  requestId: string,
  userId: string,
  input: ReceiptCreateRequest,
): Promise<CreateReceiptResult> {
  const positions = new Set(input.images.map((image) => image.position));
  if (positions.size !== input.images.length) {
    throw new AppError("VALIDATION_ERROR", "Image positions must be unique.", 400);
  }

  // On-device (AI_PROVIDER.md §10): the phone already ran extraction locally — there is no vision
  // call to schedule, so the receipt is created already in its final parsed state.
  const onDevicePayload = resolveOnDevicePayload(input);

  // Optimistic create + fall back to a read on conflict, rather than check-then-create: a retried
  // request (same `clientRef`, poor connectivity) racing the original isn't a query-then-write gap
  // away from creating two receipts and firing two vision calls for one upload.
  try {
    const receipt = await prisma.receipt.create({
      data: {
        userId,
        clientRef: input.clientRef,
        images: {
          create: input.images.map((image) => ({
            position: image.position,
            mimeType: image.mimeType,
            bytes: Math.floor((image.base64.length * 3) / 4),
          })),
        },
        // Key omitted entirely in the cloud branch (not set to `undefined`) — same
        // `exactOptionalPropertyTypes` reason as inside `onDeviceCreateFields` above.
        ...(onDevicePayload
          ? onDeviceCreateFields(input, onDevicePayload)
          : { status: "PARSING" as const }),
      },
    });
    if (onDevicePayload) {
      logExtractionUsage(requestId, userId, receipt.id, {
        model: input.clientModel ?? DEFAULT_ON_DEVICE_MODEL,
        latencyMs: input.clientLatencyMs ?? null,
        attempts: 1,
      });
    }
    return { id: receipt.id, status: receipt.status, created: true };
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      const existing = await prisma.receipt.findUnique({
        where: { userId_clientRef: { userId, clientRef: input.clientRef } },
      });
      if (existing) {
        return { id: existing.id, status: existing.status, created: false };
      }
    }
    throw error;
  }
}

/**
 * Debug-level only, and deliberately shaped to exclude `parsedPayload`/item/merchant text (CLAUDE.md
 * rule 6 — receipts are PII). Token/latency/attempt counts tied to `requestId` are what §7.1's cost
 * tracking asks for; nothing here identifies what was actually on the receipt.
 */
function logExtractionUsage(
  requestId: string,
  userId: string,
  receiptId: string,
  outcome: Pick<ExtractionOutcome, "model" | "inputTokens" | "outputTokens" | "attempts"> & {
    // Widened vs. `ExtractionOutcome.latencyMs` (always a real measured duration for the cloud
    // path): the on-device caller passes `null` when the client never reported one, rather than a
    // made-up `0` that would misread as "instant" in the usage log.
    latencyMs: number | null;
  },
): void {
  console.debug("extraction_usage", {
    requestId,
    userId,
    receiptId,
    model: outcome.model,
    inputTokens: outcome.inputTokens,
    outputTokens: outcome.outputTokens,
    latencyMs: outcome.latencyMs,
    attempts: outcome.attempts,
  });
}

/**
 * Runs after the 202 response is sent (see the route's `after()` call) — never throws. The images
 * are passed in directly from the request that triggered this run (no blob storage to fetch from).
 */
export async function runExtraction(
  requestId: string,
  userId: string,
  receiptId: string,
  images: ReceiptImageInput[],
): Promise<void> {
  const receipt = await prisma.receipt.findFirst({ where: { id: receiptId, userId } });
  if (!receipt) {
    return;
  }

  try {
    const outcome = await extractReceipt(
      images.map((image) => ({
        base64: image.base64,
        mediaType: image.mimeType,
        position: image.position,
      })),
    );
    logExtractionUsage(requestId, userId, receiptId, outcome);

    if (!outcome.result.isReceipt) {
      await prisma.receipt.updateMany({
        where: { id: receiptId, userId },
        data: {
          status: "FAILED",
          parseError: "These images don't look like a receipt.",
          parseAttempts: { increment: 1 },
          model: outcome.model,
          ...(outcome.inputTokens !== undefined && { inputTokens: outcome.inputTokens }),
          ...(outcome.outputTokens !== undefined && { outputTokens: outcome.outputTokens }),
          latencyMs: outcome.latencyMs,
        },
      });
      return;
    }

    const normalizedPayload = normalizeParsedPayload(outcome.result);

    await prisma.receipt.updateMany({
      where: { id: receiptId, userId },
      data: {
        status: "PARSED",
        parsedPayload: normalizedPayload,
        parseError: null,
        parseAttempts: { increment: 1 },
        model: outcome.model,
        ...(outcome.inputTokens !== undefined && { inputTokens: outcome.inputTokens }),
        ...(outcome.outputTokens !== undefined && { outputTokens: outcome.outputTokens }),
        latencyMs: outcome.latencyMs,
      },
    });
  } catch (error) {
    await prisma.receipt.updateMany({
      where: { id: receiptId, userId },
      data: {
        status: "FAILED",
        parseError: error instanceof Error ? error.message : "Unknown parse error.",
        parseAttempts: { increment: 1 },
      },
    });
  }
}

export interface ReceiptDetail {
  id: string;
  status: ReceiptStatus;
  parsedPayload: unknown;
  parseError: string | null;
  images: { position: number; mimeType: string }[];
}

export async function getReceipt(userId: string, receiptId: string): Promise<ReceiptDetail> {
  const receipt = await prisma.receipt.findFirst({
    where: { id: receiptId, userId },
    include: { images: { orderBy: { position: "asc" } } },
  });
  if (!receipt) {
    throw new AppError("NOT_FOUND", "Receipt not found.", 404);
  }

  return {
    id: receipt.id,
    status: receipt.status,
    parsedPayload: receipt.parsedPayload,
    parseError: receipt.parseError,
    images: receipt.images.map((image) => ({ position: image.position, mimeType: image.mimeType })),
  };
}

/**
 * Retries a FAILED parse. No blob storage means the server never retained the original images —
 * the client must resend them, exactly like the initial `POST /receipts` call.
 */
export async function reparseReceipt(userId: string, receiptId: string): Promise<ReceiptSummary> {
  const receipt = await prisma.receipt.findFirst({ where: { id: receiptId, userId } });
  if (!receipt) {
    throw new AppError("NOT_FOUND", "Receipt not found.", 404);
  }
  if (receipt.status !== "FAILED") {
    throw new AppError("VALIDATION_ERROR", "Only a FAILED receipt can be reparsed.", 400);
  }

  await prisma.receipt.updateMany({
    where: { id: receiptId, userId },
    data: { status: "PARSING", parseError: null },
  });

  return { id: receipt.id, status: "PARSING" };
}

export async function discardReceipt(userId: string, receiptId: string): Promise<void> {
  const receipt = await prisma.receipt.findFirst({ where: { id: receiptId, userId } });
  if (!receipt) {
    throw new AppError("NOT_FOUND", "Receipt not found.", 404);
  }
  if (receipt.status === "CONFIRMED") {
    throw new AppError("VALIDATION_ERROR", "A confirmed receipt cannot be discarded.", 400);
  }

  await prisma.receipt.updateMany({
    where: { id: receiptId, userId },
    data: { status: "DISCARDED" },
  });
}
