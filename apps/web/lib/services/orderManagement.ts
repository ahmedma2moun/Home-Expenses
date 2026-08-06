import { prisma, Prisma } from "@/lib/db/prisma";
import { assertCategoriesExist } from "@/lib/services/categoryTaxonomy";
import { getUserCurrency, assertCurrencyMatches } from "@/lib/services/users";
import { parseMonthLabel } from "@/lib/services/period";
import { recomputeMonthlySummary, invalidateMonthComparisons } from "@/lib/services/monthlySummary";
import { orderNotFound } from "@/lib/services/orderQueries";
import { UNKNOWN_MERCHANT } from "@/lib/services/orders";
import { normalizeItemName } from "@/lib/services/itemNormalization";
import { toOrderDto, type OrderDto } from "@/lib/services/orderDtos";
import type { OrderItemInput, OrderUpdateRequest } from "@/lib/api/schemas/orders";

/**
 * Editing and deleting orders that already exist (BR-4: move an order to another month, correct
 * it, delete it). Creating one from a confirmed receipt lives in `orders.ts`; reading them lives in
 * `orderQueries.ts` — this file is the write half, split out to stay under CLAUDE.md's file-size rule.
 */

type Tx = Prisma.TransactionClient;

/** A 200-item replace plus two summary recomputes outruns Prisma's 5s interactive default. */
const WRITE_TRANSACTION_OPTIONS = { timeout: 15_000, maxWait: 5_000 };

/**
 * Applies the user's edits. Moving an order between months recomputes **both** months' summaries
 * and drops any cached AI comparison touching either one (PROJECT_SPEC.md §12) — all inside the
 * write's own transaction (CLAUDE.md rule 8), which is also where ownership is established so a
 * concurrent move can't leave the month it came from stale.
 */
export async function updateOrder(
  userId: string,
  orderId: string,
  input: OrderUpdateRequest,
): Promise<OrderDto> {
  if (input.currency !== undefined) {
    assertCurrencyMatches(await getUserCurrency(userId), input.currency);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const existing = await tx.order.findFirst({
      where: { id: orderId, userId },
      select: { periodMonth: true },
    });
    if (!existing) {
      throw orderNotFound();
    }

    const nextPeriodMonth = input.periodMonth ? parseMonthLabel(input.periodMonth) : null;
    const affectedMonths = monthsToRecompute(existing.periodMonth, nextPeriodMonth);
    const order = await applyEdit(tx, userId, orderId, input, nextPeriodMonth);

    for (const month of affectedMonths) {
      await recomputeMonthlySummary(tx, userId, month);
    }
    // Not gated on the amounts changing: the comparison prompt is fed merchant shifts and order
    // counts too (PROJECT_SPEC.md §7.3), so a rename dates the narrative just as a total does.
    await invalidateMonthComparisons(tx, userId, affectedMonths);

    return order;
  }, WRITE_TRANSACTION_OPTIONS);

  return toOrderDto(updated);
}

async function applyEdit(
  tx: Tx,
  userId: string,
  orderId: string,
  input: OrderUpdateRequest,
  periodMonth: Date | null,
) {
  if (!input.items) {
    return tx.order.update({
      where: { id: orderId, userId },
      data: scalarUpdates(input, periodMonth),
      include: { items: { orderBy: { position: "asc" } } },
    });
  }

  await assertCategoriesExist(tx, input.items);
  const previous = await tx.orderItem.findMany({
    where: { orderId, order: { userId } },
    select: { position: true, categoryId: true },
  });
  await tx.orderItem.deleteMany({ where: { orderId, order: { userId } } });

  const order = await tx.order.update({
    where: { id: orderId, userId },
    data: {
      ...scalarUpdates(input, periodMonth),
      items: { create: input.items.map(toItemCreate) },
    },
    include: { items: { orderBy: { position: "asc" } } },
  });

  await recordCategoryCorrections(tx, userId, order.merchant, input.items, previous);
  return order;
}

export async function deleteOrder(userId: string, orderId: string): Promise<{ id: string }> {
  await prisma.$transaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: orderId, userId },
      select: { periodMonth: true, receiptId: true },
    });
    if (!order) {
      throw orderNotFound();
    }

    await tx.order.delete({ where: { id: orderId, userId } });

    if (order.receiptId) {
      // `Order.receiptId` is unique, so a receipt left at CONFIRMED with its order gone could
      // never produce one again. Releasing it back to PARSED keeps the parse recoverable —
      // `parsedPayload` is still on the row, so the review screen can re-confirm it.
      await tx.receipt.updateMany({
        where: { id: order.receiptId, userId },
        data: { status: "PARSED" },
      });
    }

    await recomputeMonthlySummary(tx, userId, order.periodMonth);
    await invalidateMonthComparisons(tx, userId, [order.periodMonth]);
  }, WRITE_TRANSACTION_OPTIONS);

  return { id: orderId };
}

function monthsToRecompute(current: Date, next: Date | null): Date[] {
  if (!next || next.getTime() === current.getTime()) {
    return [current];
  }
  return [current, next];
}

/**
 * The edit screen is the same correction signal as the review screen, so a re-categorization here
 * feeds the learning loop too (BR-3, PROJECT_SPEC.md §11). Only categories that actually moved in
 * *this* edit are recorded — re-saving an order would otherwise file the same correction again on
 * every PATCH and skew the dataset.
 */
async function recordCategoryCorrections(
  tx: Tx,
  userId: string,
  merchant: string,
  items: OrderItemInput[],
  previous: { position: number; categoryId: string }[],
): Promise<void> {
  const previousByPosition = new Map(previous.map((item) => [item.position, item.categoryId]));

  const corrections = items
    .filter(
      (item): item is OrderItemInput & { aiCategoryId: string } =>
        !!item.aiCategoryId &&
        item.aiCategoryId !== item.categoryId &&
        previousByPosition.get(item.position) !== item.categoryId,
    )
    .map((item) => ({
      userId,
      merchant,
      itemName: item.name,
      aiCategoryId: item.aiCategoryId,
      finalCategoryId: item.categoryId,
    }));

  if (corrections.length > 0) {
    await tx.itemCategoryOverride.createMany({ data: corrections });
  }
}

function scalarUpdates(
  input: OrderUpdateRequest,
  periodMonth: Date | null,
): Prisma.OrderUpdateInput {
  return {
    ...(input.merchant !== undefined && { merchant: input.merchant.trim() || UNKNOWN_MERCHANT }),
    ...(periodMonth && { periodMonth }),
    ...(input.currency !== undefined && { currency: input.currency }),
    ...(input.subtotal !== undefined && { subtotal: input.subtotal }),
    ...(input.tax !== undefined && { tax: input.tax }),
    ...(input.discount !== undefined && { discount: input.discount }),
    ...(input.total !== undefined && { total: input.total }),
    ...(input.notes !== undefined && { notes: input.notes }),
  };
}

function toItemCreate(item: OrderItemInput): Prisma.OrderItemCreateWithoutOrderInput {
  return {
    name: item.name,
    brand: item.brand ?? null,
    normalizedName: normalizeItemName(item.name),
    quantity: item.quantity,
    unit: item.unit ?? null,
    unitPrice: item.unitPrice ?? null,
    lineTotal: item.lineTotal,
    category: { connect: { id: item.categoryId } },
    aiCategoryId: item.aiCategoryId ?? null,
    position: item.position,
  };
}
