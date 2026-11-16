-- AlterTable
ALTER TABLE "CollectorRun" ADD COLUMN     "rejects" JSONB NOT NULL DEFAULT '[]';
