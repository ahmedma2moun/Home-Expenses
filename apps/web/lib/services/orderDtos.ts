import { Prisma } from "@/lib/db/prisma";
import { formatMonthLabel } from "@/lib/services/period";

/**
 * The wire shape of an order and its items, and the mapping from Prisma rows to it. Money is
 * serialized as a two-decimal string (CLAUDE.md rule 1); `quantity` is a count or weight, not an
 * amount, so it stays a JSON number.
 */

export interface OrderItemDto {
  id: string;
  name: string;
  quantity: number;
  unit: string | null;
  unitPrice: string | null;
  lineTotal: string;
  categoryId: string;
  aiCategoryId: string | null;
  position: number;
}

export interface OrderSummaryDto {
  id: string;
  merchant: string;
  purchasedAt: string | null;
  periodMonth: string;
  currency: string;
  total: string;
  itemCount: number;
  source: string;
  createdAt: string;
}

export interface OrderDto extends OrderSummaryDto {
  receiptId: string | null;
  subtotal: string;
  tax: string;
  discount: string;
  notes: string | null;
  updatedAt: string;
  items: OrderItemDto[];
}

export interface OrderListPage {
  orders: OrderSummaryDto[];
  /** Pass back as `?cursor=` for the next page; `null` on the last page. */
  nextCursor: string | null;
}

export type OrderWithItems = Prisma.OrderGetPayload<{ include: { items: true } }>;
export type OrderWithItemCount = Prisma.OrderGetPayload<{
  include: { _count: { select: { items: true } } };
}>;

export function toOrderSummary(order: OrderWithItemCount): OrderSummaryDto {
  return {
    id: order.id,
    merchant: order.merchant,
    purchasedAt: order.purchasedAt?.toISOString() ?? null,
    periodMonth: formatMonthLabel(order.periodMonth),
    currency: order.currency,
    total: order.total.toFixed(2),
    itemCount: order._count.items,
    source: order.source,
    createdAt: order.createdAt.toISOString(),
  };
}

export function toOrderDto(order: OrderWithItems): OrderDto {
  return {
    id: order.id,
    receiptId: order.receiptId,
    merchant: order.merchant,
    purchasedAt: order.purchasedAt?.toISOString() ?? null,
    periodMonth: formatMonthLabel(order.periodMonth),
    currency: order.currency,
    subtotal: order.subtotal.toFixed(2),
    tax: order.tax.toFixed(2),
    discount: order.discount.toFixed(2),
    total: order.total.toFixed(2),
    notes: order.notes,
    source: order.source,
    itemCount: order.items.length,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    items: order.items.map(toOrderItemDto),
  };
}

function toOrderItemDto(item: OrderWithItems["items"][number]): OrderItemDto {
  return {
    id: item.id,
    name: item.name,
    quantity: item.quantity.toNumber(),
    unit: item.unit,
    unitPrice: item.unitPrice?.toFixed(2) ?? null,
    lineTotal: item.lineTotal.toFixed(2),
    categoryId: item.categoryId,
    aiCategoryId: item.aiCategoryId,
    position: item.position,
  };
}
