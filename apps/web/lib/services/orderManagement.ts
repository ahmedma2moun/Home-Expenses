import { prisma, Prisma } from "@/lib/db/prisma";
import { AppError, type ValidationDetails } from "@/lib/api/envelope";
import { parseMonthLabel } from "@/lib/services/period";
import { recomputeMonthlySummary, invalidateMonthComparisons } from "@/lib/services/monthlySummary";
import { UNKNOWN_MERCHANT } from "@/lib/services/orders";
import {
  toOrderDto,
  toOrderSummary,
  type OrderDto,
  type OrderListPage,
} from "@/lib/services/orderDtos";
import type { OrderItemInput, OrderListQuery, OrderUpdateRequest } from "@/lib/api/schemas/orders";

/**
 * Reading and maintaining orders that already exist (BR-4: list a month, move an order to another
 * month, correct it, delete it). Creating one from a confirmed receipt lives in `orders.ts`.
 */

type Tx = Prisma.TransactionClient;

/** A 200-item replace plus two summary recomputes outruns Prisma's 5s interactive default. */
const WRITE_TRANSACTION_OPTIONS = { timeout: 15_000, maxWait: 5_000 };

export async function listOrders(userId: string, query: OrderListQuery): Promise<OrderListPage> {
  const after = query.cursor ? await keysetAfter(userId, query.cursor) : null;

  const rows = await prisma.order.findMany({
    where: {
      userId,
      ...(query.month && { periodMonth: parseMonthLabel(query.month) }),
      ...(after && { OR: after }),
    },
    // Newest purchase first is what the user is looking for; orders with no readable receipt date
    // sink to the bottom rather than jumping the list. `id` breaks ties so paging is deterministic.
    orderBy: [{ purchasedAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
    take: query.limit + 1,
    include: { _count: { select: { items: true } } },
  });

  const page = rows.slice(0, query.limit);
  return {
    orders: page.map(toOrderSummary),
    nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
  };
}

/**
 * The keyset predicate for "everything after the cursor row" in the list's sort order.
 *
 * Prisma's own `cursor` option is deliberately not used: it looks the anchor row up by primary key
 * with no `userId` predicate (so another user's id would position this user's page), and it
 * compares against the row's `orderBy` values — where `purchasedAt IS NULL` every comparison is
 * unknown, silently truncating the list exactly at the date-less orders `nulls: "last"` exists for.
 */
async function keysetAfter(userId: string, cursor: string): Promise<Prisma.OrderWhereInput[]> {
  const anchor = await prisma.order.findFirst({
    where: { id: cursor, userId },
    select: { id: true, purchasedAt: true },
  });
  if (!anchor) {
    throw new AppError("VALIDATION_ERROR", "Unknown cursor.", 400);
  }

  if (!anchor.purchasedAt) {
    // The date-less block sorts last, so everything after it is another date-less row.
    return [{ purchasedAt: null, id: { lt: anchor.id } }];
  }
  return [
    { purchasedAt: { lt: anchor.purchasedAt } },
    { purchasedAt: null },
    { purchasedAt: anchor.purchasedAt, id: { lt: anchor.id } },
  ];
}

export async function getOrder(userId: string, orderId: string): Promise<OrderDto> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    include: { items: { orderBy: { position: "asc" } } },
  });
  if (!order) {
    throw orderNotFound();
  }
  return toOrderDto(order);
}

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

/** 404 rather than 403 for another user's order — never leak that the id exists (docs/api.md). */
function orderNotFound(): AppError {
  return new AppError("NOT_FOUND", "Order not found.", 404);
}

function monthsToRecompute(current: Date, next: Date | null): Date[] {
  if (!next || next.getTime() === current.getTime()) {
    return [current];
  }
  return [current, next];
}

/**
 * `OrderItem.categoryId` is a foreign key, so an unknown slug would surface as an opaque 500.
 * Checking it up front turns that into a field-level 400 the client can point at. Retired
 * categories are rejected too — `GET /categories` stopped offering them, so nothing legitimate
 * still sends one, and accepting it would file spend under a category the app won't render.
 */
async function assertCategoriesExist(tx: Tx, items: OrderItemInput[]): Promise<void> {
  const requested = [...new Set(items.map((item) => item.categoryId))];
  const known = await tx.category.findMany({
    where: { id: { in: requested }, isActive: true },
    select: { id: true },
  });
  const knownIds = new Set(known.map((category) => category.id));

  const issues = items.flatMap((item, index) =>
    knownIds.has(item.categoryId)
      ? []
      : [{ path: `items.${index}.categoryId`, message: `Unknown category "${item.categoryId}".` }],
  );
  if (issues.length > 0) {
    const details: ValidationDetails = { issues };
    throw new AppError("VALIDATION_ERROR", "Request failed validation.", 400, details);
  }
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
    ...(input.purchasedAt !== undefined && {
      purchasedAt: input.purchasedAt ? new Date(input.purchasedAt) : null,
    }),
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
    normalizedName: item.name.trim().toLowerCase(),
    quantity: item.quantity,
    unit: item.unit ?? null,
    unitPrice: item.unitPrice ?? null,
    lineTotal: item.lineTotal,
    category: { connect: { id: item.categoryId } },
    aiCategoryId: item.aiCategoryId ?? null,
    position: item.position,
  };
}
