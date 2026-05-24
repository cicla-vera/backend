-- CreateEnum
CREATE TYPE "AlertLevel" AS ENUM ('NORMAL', 'CRITICAL');

-- AlterEnum
ALTER TYPE "AlertEventType" ADD VALUE 'ALERT_ESCALATED';

-- AlterTable
ALTER TABLE "AlertSession" ADD COLUMN     "criticalEscalatedAt" TIMESTAMP(3),
ADD COLUMN     "level" "AlertLevel" NOT NULL DEFAULT 'NORMAL';

-- CreateIndex
CREATE INDEX "AlertSession_userId_level_idx" ON "AlertSession"("userId", "level");
