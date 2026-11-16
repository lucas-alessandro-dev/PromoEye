-- CreateEnum
CREATE TYPE "StoreAdapter" AS ENUM ('VTEX', 'KABUM', 'AMAZON', 'MANUAL');

-- CreateEnum
CREATE TYPE "SellerPolicy" AS ENUM ('OFFICIAL_ONLY', 'ALL');

-- CreateEnum
CREATE TYPE "OfferSource" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('RUNNING', 'OK', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('DRAFT', 'SENT', 'DISCARDED', 'FAILED');

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "userAgent" TEXT,

    CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "adapter" "StoreAdapter" NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sellerPolicy" "SellerPolicy" NOT NULL DEFAULT 'OFFICIAL_ONLY',
    "affiliateTemplate" TEXT,
    "trustNote" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "lastOkAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchItem" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "mustInclude" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mustExclude" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "minPrice" DECIMAL(12,2),
    "targetPrice" DECIMAL(12,2),
    "minDiscountPct" INTEGER,
    "storeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "category" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "notes" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WatchItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "watchItemId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "source" "OfferSource" NOT NULL DEFAULT 'AUTO',
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "imageUrl" TEXT,
    "sellerName" TEXT,
    "soldByStore" BOOLEAN,
    "price" DECIMAL(12,2) NOT NULL,
    "listPrice" DECIMAL(12,2),
    "cardPrice" DECIMAL(12,2),
    "installments" TEXT,
    "promoLabel" TEXT,
    "available" BOOLEAN NOT NULL DEFAULT true,
    "missingSince" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastChangeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lowestPrice" DECIMAL(12,2) NOT NULL,
    "lowestPriceAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "highestPrice" DECIMAL(12,2) NOT NULL,
    "affiliateUrl" TEXT,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "realDiscountPct" DOUBLE PRECISION,
    "isDeal" BOOLEAN NOT NULL DEFAULT false,
    "dealSince" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricePoint" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "listPrice" DECIMAL(12,2),
    "available" BOOLEAN NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PricePoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemSnapshot" (
    "id" TEXT NOT NULL,
    "watchItemId" TEXT NOT NULL,
    "runId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "minPrice" DECIMAL(12,2),
    "minOfferId" TEXT,
    "minStoreId" TEXT,
    "offerCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ItemSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectorRun" (
    "id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "itemsChecked" INTEGER NOT NULL DEFAULT 0,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "offersSeen" INTEGER NOT NULL DEFAULT 0,
    "offersNew" INTEGER NOT NULL DEFAULT 0,
    "priceChanges" INTEGER NOT NULL DEFAULT 0,
    "newDeals" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "CollectorRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Click" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "referrer" TEXT,
    "channel" TEXT,

    CONSTRAINT "Click_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundMessage" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'whatsapp',
    "offerId" TEXT,
    "price" DECIMAL(12,2),
    "reason" TEXT,
    "body" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'DRAFT',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "OutboundMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");

-- CreateIndex
CREATE INDEX "AdminSession_userId_idx" ON "AdminSession"("userId");

-- CreateIndex
CREATE INDEX "AdminSession_expiresAt_idx" ON "AdminSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "WatchItem_slug_key" ON "WatchItem"("slug");

-- CreateIndex
CREATE INDEX "Offer_watchItemId_isDeal_idx" ON "Offer"("watchItemId", "isDeal");

-- CreateIndex
CREATE INDEX "Offer_isDeal_score_idx" ON "Offer"("isDeal", "score");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_watchItemId_storeId_externalId_key" ON "Offer"("watchItemId", "storeId", "externalId");

-- CreateIndex
CREATE INDEX "PricePoint_offerId_at_idx" ON "PricePoint"("offerId", "at");

-- CreateIndex
CREATE INDEX "ItemSnapshot_watchItemId_at_idx" ON "ItemSnapshot"("watchItemId", "at");

-- CreateIndex
CREATE INDEX "CollectorRun_startedAt_idx" ON "CollectorRun"("startedAt");

-- CreateIndex
CREATE INDEX "Click_offerId_at_idx" ON "Click"("offerId", "at");

-- CreateIndex
CREATE INDEX "OutboundMessage_status_createdAt_idx" ON "OutboundMessage"("status", "createdAt");

-- CreateIndex
CREATE INDEX "OutboundMessage_offerId_idx" ON "OutboundMessage"("offerId");

-- AddForeignKey
ALTER TABLE "AdminSession" ADD CONSTRAINT "AdminSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_watchItemId_fkey" FOREIGN KEY ("watchItemId") REFERENCES "WatchItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricePoint" ADD CONSTRAINT "PricePoint_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemSnapshot" ADD CONSTRAINT "ItemSnapshot_watchItemId_fkey" FOREIGN KEY ("watchItemId") REFERENCES "WatchItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Click" ADD CONSTRAINT "Click_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
