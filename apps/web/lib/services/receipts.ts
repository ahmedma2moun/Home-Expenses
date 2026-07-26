import { prisma, type ReceiptStatus } from "@/lib/db/prisma";
import { AppError } from "@/lib/api/envelope";
import { extractReceipt } from "@/lib/services/extraction";
import { coerceCategorySlug } from "@/lib/services/categoryTaxonomy";
import type { ReceiptCreateRequest, ReceiptImageInput } from "@/lib/api/schemas/receipts";

export interface ReceiptSummary {
  id: string;
  status: ReceiptStatus;
}

export async function createReceipt(
  userId: string,
  input: ReceiptCreateRequest,
): Promise<ReceiptSummary> {
  const existing = await prisma.receipt.findUnique({
    where: { userId_clientRef: { userId, clientRef: input.clientRef } },
  });
  if (existing) {
    return { id: existing.id, status: existing.status };
  }

  const positions = new Set(input.images.map((image) => image.position));
  if (positions.size !== input.images.length) {
    throw new AppError("VALIDATION_ERROR", "Image positions must be unique.", 400);
  }

  const receipt = await prisma.receipt.create({
    data: {
      userId,
      clientRef: input.clientRef,
      status: "PARSING",
      images: {
        create: input.images.map((image) => ({
          position: image.position,
          mimeType: image.mimeType,
          bytes: Math.floor((image.base64.length * 3) / 4),
        })),
      },
    },
  });

  return { id: receipt.id, status: receipt.status };
}

/**
 * Runs after the 202 response is sent (see the route's `after()` call) — never throws. The images
 * are passed in directly from the request that triggered this run (no blob storage to fetch from).
 */
export async function runExtraction(receiptId: string, images: ReceiptImageInput[]): Promise<void> {
  const receipt = await prisma.receipt.findUnique({ where: { id: receiptId } });
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

    if (!outcome.result.isReceipt) {
      await prisma.receipt.update({
        where: { id: receiptId },
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

    const normalizedPayload = {
      ...outcome.result,
      items: outcome.result.items.map((item) => ({
        ...item,
        category: coerceCategorySlug(item.category),
      })),
    };

    await prisma.receipt.update({
      where: { id: receiptId },
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
    await prisma.receipt.update({
      where: { id: receiptId },
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

  const updated = await prisma.receipt.update({
    where: { id: receiptId },
    data: { status: "PARSING", parseError: null },
  });

  return { id: updated.id, status: updated.status };
}

export async function discardReceipt(userId: string, receiptId: string): Promise<void> {
  const receipt = await prisma.receipt.findFirst({ where: { id: receiptId, userId } });
  if (!receipt) {
    throw new AppError("NOT_FOUND", "Receipt not found.", 404);
  }
  if (receipt.status === "CONFIRMED") {
    throw new AppError("VALIDATION_ERROR", "A confirmed receipt cannot be discarded.", 400);
  }

  await prisma.receipt.update({ where: { id: receiptId }, data: { status: "DISCARDED" } });
}
