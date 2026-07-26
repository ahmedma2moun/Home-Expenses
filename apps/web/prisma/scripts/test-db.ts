import { prisma } from "../../lib/db/prisma";

// Smoke-checks a freshly migrated + seeded database. Run in CI after
// `prisma migrate deploy` and `npm run seed`, against a throwaway database.

async function main() {
  const categoryCount = await prisma.category.count();
  if (categoryCount === 0) {
    throw new Error("Expected seeded categories, found none. Run `npm run seed` first.");
  }

  await prisma.$queryRaw`SELECT 1`;

  console.log(`test:db ok — ${categoryCount} categories, connection healthy.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
