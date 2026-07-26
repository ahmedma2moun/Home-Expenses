import { prisma } from "../lib/db/prisma";
import { CATEGORIES } from "../lib/services/categoryTaxonomy";
import { DEV_USER_ID } from "../lib/api/devUser";

async function main() {
  for (const [index, category] of CATEGORIES.entries()) {
    await prisma.category.upsert({
      where: { id: category.id },
      create: { ...category, sortOrder: index },
      update: { name: category.name, emoji: category.emoji, sortOrder: index },
    });
  }
  console.log(`Seeded ${CATEGORIES.length} categories.`);

  // No auth flow yet — every request resolves to this single user (lib/api/devUser.ts).
  await prisma.user.upsert({
    where: { id: DEV_USER_ID },
    create: { id: DEV_USER_ID, appleUserId: "dev-local-user", displayName: "Dev User" },
    update: {},
  });
  console.log(`Seeded dev user (${DEV_USER_ID}).`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
