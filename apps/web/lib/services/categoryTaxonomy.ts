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
