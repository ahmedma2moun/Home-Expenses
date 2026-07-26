import { prisma } from "@/lib/db/prisma";

export interface CategoryDto {
  id: string;
  name: string;
  emoji: string;
  sortOrder: number;
}

export async function listCategories(): Promise<CategoryDto[]> {
  return prisma.category.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true, emoji: true, sortOrder: true },
  });
}
