-- CreateTable
CREATE TABLE "MonthPeriodSettings" (
    "userId" TEXT NOT NULL,
    "periodMonth" TIMESTAMP(3) NOT NULL,
    "periodCount" INTEGER NOT NULL DEFAULT 5,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthPeriodSettings_pkey" PRIMARY KEY ("userId","periodMonth")
);
