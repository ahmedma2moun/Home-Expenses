-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "periodWeek" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "isProtein" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "WeeklySummary" (
    "userId" TEXT NOT NULL,
    "periodMonth" TIMESTAMP(3) NOT NULL,
    "periodWeek" INTEGER NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "itemCount" INTEGER NOT NULL,
    "orderCount" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklySummary_pkey" PRIMARY KEY ("userId","periodMonth","periodWeek")
);

-- CreateTable
CREATE TABLE "ProteinMonthlySummary" (
    "userId" TEXT NOT NULL,
    "periodMonth" TIMESTAMP(3) NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "itemCount" INTEGER NOT NULL,
    "orderCount" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProteinMonthlySummary_pkey" PRIMARY KEY ("userId","periodMonth")
);

-- CreateIndex
CREATE INDEX "WeeklySummary_userId_periodMonth_idx" ON "WeeklySummary"("userId", "periodMonth");
