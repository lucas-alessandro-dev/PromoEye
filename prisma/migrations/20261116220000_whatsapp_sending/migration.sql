-- AlterEnum
ALTER TYPE "MessageStatus" ADD VALUE 'QUEUED';
ALTER TYPE "MessageStatus" ADD VALUE 'SENDING';

-- AlterTable
ALTER TABLE "OutboundMessage" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "providerId" TEXT,
ADD COLUMN     "queuedAt" TIMESTAMP(3);
