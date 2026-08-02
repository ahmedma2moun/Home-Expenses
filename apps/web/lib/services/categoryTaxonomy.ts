import type { Prisma } from "@/lib/db/prisma";
import { AppError, type ValidationDetails } from "@/lib/api/envelope";

/**
 * Verbatim taxonomy from PROJECT_SPEC.md §6 — single source of truth, seeded into `Category` and
 * used verbatim in the extraction prompt/schema. Never renumber or reuse slugs; add new rows only.
 */
export const CATEGORIES = [
  { id: "meat_seafood", name: "Meat & Seafood", emoji: "🥩" },
  { id: "produce", name: "Produce", emoji: "🥦" },
  { id: "dairy_eggs", name: "Dairy & Eggs", emoji: "🥛" },
  { id: "bakery", name: "Bakery & Bread", emoji: "🍞" },
  { id: "pantry", name: "Pantry & Dry Goods", emoji: "🥫" },
  { id: "beverages", name: "Beverages", emoji: "🧃" },
  { id: "snacks_sweets", name: "Snacks & Sweets", emoji: "🍫" },
  { id: "frozen", name: "Frozen Foods", emoji: "🧊" },
  { id: "prepared_deli", name: "Prepared & Deli", emoji: "🍔" },
  { id: "household_cleaning", name: "Household & Cleaning", emoji: "🧹" },
  { id: "personal_care", name: "Personal Care", emoji: "🧴" },
  { id: "health_medicine", name: "Health & Medicine", emoji: "💊" },
  { id: "pet_supplies", name: "Pet Supplies", emoji: "🐾" },
  { id: "electronics", name: "Electronics", emoji: "📱" },
  { id: "clothing", name: "Clothing", emoji: "👕" },
  { id: "hardware_tools", name: "Hardware & Tools", emoji: "🔧" },
  { id: "books_stationery", name: "Books & Stationery", emoji: "📚" },
  { id: "dining", name: "Restaurants & Dining", emoji: "🍽️" },
  { id: "other", name: "Other / Miscellaneous", emoji: "💼" },
] as const;

export const CATEGORY_SLUGS = CATEGORIES.map((category) => category.id) as [string, ...string[]];

export type CategorySlug = (typeof CATEGORIES)[number]["id"];

export const OTHER_CATEGORY_SLUG: CategorySlug = "other";

export function isCategorySlug(value: string): value is CategorySlug {
  return (CATEGORY_SLUGS as readonly string[]).includes(value);
}

/** Unknown category slugs from the model are coerced to `other` server-side (PROJECT_SPEC.md §7.2). */
export function coerceCategorySlug(value: string): CategorySlug {
  return isCategorySlug(value) ? value : OTHER_CATEGORY_SLUG;
}

/**
 * `OrderItem.categoryId` is a foreign key, so an unknown slug would surface as an opaque 500.
 * Checking it up front turns that into a field-level 400 the client can point at. Retired
 * categories are rejected too — `GET /categories` stopped offering them, so nothing legitimate
 * still sends one, and accepting it would file spend under a category the app won't render.
 *
 * Shared by `confirmReceipt` and `updateOrder` (`orders.ts` / `orderManagement.ts`) — lives here,
 * not in either of those, so importing it doesn't create a cycle between the two.
 */
export async function assertCategoriesExist(
  tx: Prisma.TransactionClient,
  items: { categoryId: string }[],
): Promise<void> {
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
