-- AlterEnum
ALTER TYPE "EvidenceAuditAction" ADD VALUE 'HIDDEN_FROM_USER';

-- AlterTable
ALTER TABLE "EvidenceRecord" ADD COLUMN     "hiddenFromUserAt" TIMESTAMP(3),
ADD COLUMN     "retentionUntil" TIMESTAMP(3),
ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "EvidenceRecord_userId_hiddenFromUserAt_idx" ON "EvidenceRecord"("userId", "hiddenFromUserAt");

-- CreateIndex
CREATE INDEX "EvidenceRecord_retentionUntil_idx" ON "EvidenceRecord"("retentionUntil");

-- CreateIndex
CREATE INDEX "EvidenceRecord_deletedAt_idx" ON "EvidenceRecord"("deletedAt");
