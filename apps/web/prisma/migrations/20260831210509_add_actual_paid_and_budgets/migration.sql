-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "actualPaid" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "WeeklyBudget" (
    "userId" TEXT NOT NULL,
    "periodMonth" TIMESTAMP(3) NOT NULL,
    "periodWeek" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyBudget_pkey" PRIMARY KEY ("userId","periodMonth","periodWeek")
);

-- CreateTable
CREATE TABLE "ProteinBudget" (
    "userId" TEXT NOT NULL,
    "periodMonth" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProteinBudget_pkey" PRIMARY KEY ("userId","periodMonth")
);
