import { prisma } from "../lib/db/prisma";

// Verbatim taxonomy from PROJECT_SPEC.md §6. Never renumber or reuse slugs — add new rows instead.
const CATEGORIES = [
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

async function main() {
  for (const [index, category] of CATEGORIES.entries()) {
    await prisma.category.upsert({
      where: { id: category.id },
      create: { ...category, sortOrder: index },
      update: { name: category.name, emoji: category.emoji, sortOrder: index },
    });
  }
  console.log(`Seeded ${CATEGORIES.length} categories.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
