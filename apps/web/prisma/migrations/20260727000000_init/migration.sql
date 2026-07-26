-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('UPLOADED', 'PARSING', 'PARSED', 'FAILED', 'CONFIRMED', 'DISCARDED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "appleUserId" TEXT NOT NULL,
    "email" TEXT,
    "displayName" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'UPLOADED',
    "parsedPayload" JSONB,
    "parseError" TEXT,
    "model" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "latencyMs" INTEGER,
    "parseAttempts" INTEGER NOT NULL DEFAULT 0,
    "clientRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptImage" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "blobKey" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "bytes" INTEGER,
    "mimeType" TEXT NOT NULL,

    CONSTRAINT "ReceiptImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "receiptId" TEXT,
    "merchant" TEXT NOT NULL,
    "purchasedAt" TIMESTAMP(3),
    "periodMonth" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "tax" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'receipt',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT,
    "quantity" DECIMAL(10,3) NOT NULL DEFAULT 1,
    "unit" TEXT,
    "unitPrice" DECIMAL(12,2),
    "lineTotal" DECIMAL(12,2) NOT NULL,
    "categoryId" TEXT NOT NULL,
    "aiCategoryId" TEXT,
    "confidence" DOUBLE PRECISION,
    "position" INTEGER NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlySummary" (
    "userId" TEXT NOT NULL,
    "periodMonth" TIMESTAMP(3) NOT NULL,
    "categoryId" TEXT NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "itemCount" INTEGER NOT NULL,
    "orderCount" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlySummary_pkey" PRIMARY KEY ("userId","periodMonth","categoryId")
);

-- CreateTable
CREATE TABLE "MonthComparison" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "monthA" TIMESTAMP(3) NOT NULL,
    "monthB" TIMESTAMP(3) NOT NULL,
    "dataVersion" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonthComparison_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemCategoryOverride" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "merchant" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "aiCategoryId" TEXT,
    "finalCategoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemCategoryOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_appleUserId_key" ON "User"("appleUserId");

-- CreateIndex
CREATE INDEX "Receipt_userId_status_idx" ON "Receipt"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_userId_clientRef_key" ON "Receipt"("userId", "clientRef");

-- CreateIndex
CREATE UNIQUE INDEX "ReceiptImage_receiptId_position_key" ON "ReceiptImage"("receiptId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Order_receiptId_key" ON "Order"("receiptId");

-- CreateIndex
CREATE INDEX "Order_userId_periodMonth_idx" ON "Order"("userId", "periodMonth");

-- CreateIndex
CREATE INDEX "Order_userId_merchant_idx" ON "Order"("userId", "merchant");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_categoryId_idx" ON "OrderItem"("categoryId");

-- CreateIndex
CREATE INDEX "MonthlySummary_userId_periodMonth_idx" ON "MonthlySummary"("userId", "periodMonth");

-- CreateIndex
CREATE UNIQUE INDEX "MonthComparison_userId_monthA_monthB_dataVersion_key" ON "MonthComparison"("userId", "monthA", "monthB", "dataVersion");

-- CreateIndex
CREATE INDEX "ItemCategoryOverride_userId_merchant_itemName_idx" ON "ItemCategoryOverride"("userId", "merchant", "itemName");

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptImage" ADD CONSTRAINT "ReceiptImage_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

